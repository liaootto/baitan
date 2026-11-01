/* 数据层逻辑冒烟测试（内存 IndexedDB 桩，Node 直接跑） */
'use strict';

// ---------- 内存 IndexedDB 桩 ----------
const stores = {};
const keyPathOf = { products: 'id', purchases: 'id', sales: 'id', consumptions: 'id', settlements: 'date', adjustments: 'id', funds: 'id', settings: 'key' };

function makeReq(result) {
  const r = { result: result, error: null, onsuccess: null, onerror: null };
  queueMicrotask(function () { if (r.onsuccess) r.onsuccess(); });
  return r;
}
function storeFacade(name) {
  const m = stores[name];
  const kp = keyPathOf[name];
  return {
    get: function (key) { return makeReq(m.get(key)); },
    getAll: function () { return makeReq(Array.from(m.values())); },
    put: function (v) { m.set(v[kp], v); return makeReq(v); },
    delete: function (key) { m.delete(key); return makeReq(undefined); },
    clear: function () { m.clear(); return makeReq(undefined); },
    createIndex: function () {},
  };
}
function makeTx(names) {
  const tx = { error: null, onabort: null, onerror: null };
  tx.objectStore = storeFacade;
  Object.defineProperty(tx, 'oncomplete', {
    set: function (fn) { queueMicrotask(fn); },
    get: function () { return undefined; },
  });
  return tx;
}
function makeDB() {
  ['products', 'purchases', 'sales', 'consumptions', 'settlements', 'adjustments', 'funds', 'settings'].forEach(function (n) { stores[n] = new Map(); });
  return {
    objectStoreNames: { contains: function (n) { return !!stores[n]; } },
    createObjectStore: function (name) { stores[name] = new Map(); return { createIndex: function () {} }; },
    transaction: function (names) { return makeTx(names); },
  };
}
global.indexedDB = {
  open: function () {
    const req = { result: makeDB(), onsuccess: null, onerror: null, onupgradeneeded: null };
    queueMicrotask(function () { if (req.onsuccess) req.onsuccess({ target: req }); });
    return req;
  },
};

global.window = globalThis;
require('../db.js');
const DB = global.DB;

// ---------- 断言 ----------
let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  PASS  ' + msg);
  else { console.error('  FAIL  ' + msg); failures++; }
}

(async function () {
  console.log('== 商品类型 / 进货 / 卖货 / 库存 ==');
  const kc = await DB.saveProduct({ name: '烤肠', type: 'sellable', costPrice: 5, sellPrice: 8, unit: '根', alertThreshold: 10 });
  const cheese = await DB.saveProduct({ name: '芝士', type: 'material', costPrice: 30, unit: '斤', alertThreshold: 10 });
  assert(kc.type === 'sellable' && cheese.type === 'material', '类型字段正确');
  assert(cheese.sellPrice === 0, '原材料售价为 0');

  await DB.addPurchase({ productId: kc.id, quantity: 20, totalCost: 100, note: '首批' });
  await DB.addPurchase({ productId: cheese.id, quantity: 5, totalCost: 150, note: '首批' });
  let kcP = await DB.getProduct(kc.id);
  let chP = await DB.getProduct(cheese.id);
  assert(kcP.stock === 20 && chP.stock === 5, '进货后库存正确（20 / 5）');

  await DB.addSale({ productId: kc.id, quantity: 3, unitPrice: 8 });
  kcP = await DB.getProduct(kc.id);
  assert(kcP.stock === 17, '卖货后库存扣减（17）');

  const sales = await DB.listSales();
  assert(sales.length === 1 && sales[0].totalAmount === 24, '卖货金额正确（3×8=24）');

  // 原材料不能被卖（这里验证：addSale 不区分类型，由 UI 过滤；但至少验证预测不受影响）
  const preds = await DB.computePredictions(14);
  const kcPred = preds.find(function (p) { return p.product.id === kc.id; });
  const chPred = preds.find(function (p) { return p.product.id === cheese.id; });
  assert(kcPred.windowQty === 3 && kcPred.avgPerDay > 0, '成品有销量、有预测');
  assert(chPred.windowQty === 0 && chPred.daysLeft === null, '原材料无消耗、无预测');
  assert(chPred.status === 'low', '原材料低于警戒线触发提醒（5<=10）');
  assert(kcPred.status === 'ok', '成品库存充足（17>10）');

  // 原材料消耗：扣库存 + 按进价自动算成本
  const cons = await DB.addConsumption({ productId: cheese.id, quantity: 2, note: '做了8份' });
  chP = await DB.getProduct(cheese.id);
  assert(chP.stock === 3, '消耗后原材料库存扣减（5-2=3）');
  assert(cons.cost === 60, '消耗成本按进价自动算（2×30=60）');
  const consumptions = await DB.listConsumptions();
  assert(consumptions.length === 1 && consumptions[0].unitCost === 30, '消耗记录含进价快照');
  const preds2 = await DB.computePredictions(14);
  const chPred2 = preds2.find(function (p) { return p.product.id === cheese.id; });
  assert(chPred2.windowQty === 2 && chPred2.avgPerDay > 0, '原材料有消耗后有预测');
  const kcConsume = await DB.addConsumption({ productId: kc.id, quantity: 2 });
  assert(kcConsume.cost === 10 && kcConsume.productType === 'sellable', '成品也可记消耗（2×5=10，类型 sellable）');

  console.log('== 备份 / 导入 / 撤销 ==');
  const backup = await DB.exportBackup();
  assert(backup.app === 'baitan-jizhang' && backup.data.products.length === 2, '导出结构正确');

  await DB.addSale({ productId: kc.id, quantity: 2 });
  const beforeImport = (await DB.listSales()).length;
  assert(beforeImport === 2, '导入前有 2 条卖货');
  await DB.importBackup(backup); // 会先快照
  const afterImport = (await DB.listSales()).length;
  assert(afterImport === 1, '导入后回退到 1 条卖货');
  assert(await DB.hasUndo(), '导入后存在可撤销快照');

  const ok = await DB.undoImport();
  assert(ok === true, '撤销成功');
  assert((await DB.listSales()).length === 2, '撤销后恢复到 2 条卖货');

  console.log('== 单位 / 密码 ==');
  await DB.saveProduct({ id: kc.id, name: '烤肠', type: 'sellable', costPrice: 5, sellPrice: 8, unit: '串', alertThreshold: 10, stock: 15 });
  const kc2 = await DB.getProduct(kc.id);
  assert(kc2.unit === '串' && kc2.type === 'sellable', '编辑后单位与类型保留');

  await DB.setPin('1234');
  assert(await DB.verifyPin('1234') === true, '正确密码通过');
  assert(await DB.verifyPin('9999') === false, '错误密码拒绝');

  console.log('== 规格 / 按克消耗 ==');
  const butter = await DB.saveProduct({ name: '黄油块', type: 'material', costPrice: 20, unit: '件', spec: 250, specUnit: '克' });
  assert(butter.spec === 250 && butter.specUnit === '克', '原材料保存规格（250克/件）');
  await DB.addPurchase({ productId: butter.id, quantity: 4, totalCost: 80, note: '首批' });
  const bc = await DB.addConsumption({ productId: butter.id, quantity: 100, mode: 'weight' });
  assert(bc.quantity === 0.4 && bc.cost === 8, '按克消耗自动换算（100克→0.4件→¥8）');
  const bP = await DB.getProduct(butter.id);
  assert(bP.stock === 3.6, '按克消耗后库存扣 0.4 件（剩 3.6）');
  const noSpec = await DB.addConsumption({ productId: cheese.id, quantity: 1 });
  assert(noSpec.weightQty == null, '无规格原材料按件消耗（weightQty 为空）');
  const kcS = await DB.saveProduct({ id: kc.id, name: '烤肠', type: 'sellable', costPrice: 5, sellPrice: 8, unit: '串', alertThreshold: 10, stock: 15, spec: 999, specUnit: '克' });
  assert(kcS.spec === null && kcS.specUnit === '', '成品不保存规格');

  console.log('== 每日核算 / 盘点校正 ==');
  await DB.saveSettlement({ date: '2026-11-01', cashOut: 100, cashBack: 600, wechat: 300, alipay: 200 });
  const st = await DB.getSettlement('2026-11-01');
  assert(st.cashBack === 600 && st.wechat === 300 && st.alipay === 200, '结算记录保存正确');
  const adj = await DB.adjustStock({ productId: butter.id, actualQty: 800, mode: 'weight', note: '称重校正' });
  const bAfter = await DB.getProduct(butter.id);
  assert(adj.after === 3.2 && adj.delta === -0.4 && bAfter.stock === 3.2, '盘点按克校正库存（3.6→3.2件，差-0.4）');

  // 删除消耗会加回库存
  const butterCons = (await DB.listConsumptions()).filter(function (c) { return c.productId === butter.id; })[0];
  await DB.deleteConsumption(butterCons.id);
  assert(DB.toNumber((await DB.getProduct(butter.id)).stock) === 3.6, '删除消耗会加回库存（3.2+0.4=3.6）');

  console.log('== 删除进货 / 卖货（流水撤销） ==');
  const kcBeforePur = DB.toNumber((await DB.getProduct(kc.id)).stock);
  const pur2 = await DB.addPurchase({ productId: kc.id, quantity: 5, totalCost: 25, note: '测试删进货' });
  assert(DB.toNumber((await DB.getProduct(kc.id)).stock) === kcBeforePur + 5, '进货后库存 +5');
  await DB.deletePurchase(pur2.id);
  assert(DB.toNumber((await DB.getProduct(kc.id)).stock) === kcBeforePur, '删除进货后库存减回');

  const kcBeforeSale = DB.toNumber((await DB.getProduct(kc.id)).stock);
  const sa2 = await DB.addSale({ productId: kc.id, quantity: 2, unitPrice: 8 });
  assert(DB.toNumber((await DB.getProduct(kc.id)).stock) === kcBeforeSale - 2, '卖货后库存 -2');
  await DB.deleteSale(sa2.id);
  assert(DB.toNumber((await DB.getProduct(kc.id)).stock) === kcBeforeSale, '删除卖货后库存加回');

  console.log('== 核算成本栏：设定当天消耗总量（加减微调） ==');
  const flour = await DB.saveProduct({ name: '面粉', type: 'material', costPrice: 10, unit: '件' });
  await DB.addPurchase({ productId: flour.id, quantity: 10, totalCost: 100, note: '测试' });
  const fl0 = DB.toNumber((await DB.getProduct(flour.id)).stock);
  await DB.setDailyConsumption({ productId: flour.id, quantity: 2, mode: 'piece', date: '2026-10-30' });
  assert(DB.toNumber((await DB.getProduct(flour.id)).stock) === fl0 - 2, '设总量2件：库存-2');
  await DB.setDailyConsumption({ productId: flour.id, quantity: 3, mode: 'piece', date: '2026-10-30' });
  assert(DB.toNumber((await DB.getProduct(flour.id)).stock) === fl0 - 3, '改成3件：库存只再减1');
  await DB.setDailyConsumption({ productId: flour.id, quantity: 0, mode: 'piece', date: '2026-10-30' });
  assert(DB.toNumber((await DB.getProduct(flour.id)).stock) === fl0, '归零：库存恢复');
  await DB.setDailyConsumption({ productId: butter.id, quantity: 200, mode: 'weight', date: '2026-10-30' });
  const bRec = (await DB.listConsumptions()).filter(function (c) { return c.productId === butter.id && c.date === '2026-10-30'; })[0];
  assert(bRec && bRec.quantity === 0.8 && bRec.cost === 16, '按克设总量：200克→0.8件→¥16');

  // ---------- 钱包 / 资金记录 ----------
  const bal0 = await (async function () {
    const fs = await DB.listFunds();
    const b = { cash: 0, wechat: 0, alipay: 0 };
    fs.forEach(function (f) { b[f.account] = DB.toNumber(b[f.account]) + DB.toNumber(f.amount); });
    return b;
  })();
  const px = await DB.addPurchase({ productId: kc.id, quantity: 2, totalCost: 60, account: 'wechat', date: '2026-11-01' });
  assert(px.account === 'wechat', '进货记录带账户');
  const fundsAfter = await DB.listFunds();
  const purFund = fundsAfter.find(function (f) { return f.category === 'purchase' && f.refId === px.id; });
  assert(purFund && purFund.account === 'wechat' && purFund.amount === -60, '进货从微信账户扣 60');
  await DB.saveSettlement({ date: '2026-11-01', cashOut: 100, cashBack: 600, wechat: 300, alipay: 200 });
  const settleFunds = (await DB.listFunds()).filter(function (f) { return f.category === 'settlement' && f.date === '2026-11-01'; });
  const settleByAcct = { cash: 0, wechat: 0, alipay: 0 };
  settleFunds.forEach(function (f) { settleByAcct[f.account] += DB.toNumber(f.amount); });
  assert(settleByAcct.cash === 500 && settleByAcct.wechat === 300 && settleByAcct.alipay === 200, '营业额同步到钱包（现金500/微信300/支付宝200）');
  await DB.saveSettlement({ date: '2026-11-01', cashOut: 100, cashBack: 600, wechat: 300, alipay: 200 });
  const settleCount = (await DB.listFunds()).filter(function (f) { return f.category === 'settlement' && f.date === '2026-11-01'; }).length;
  assert(settleCount === 3, '重复保存不会产生重复收入记录');
  await DB.deletePurchase(px.id);
  const purFundAfterDel = (await DB.listFunds()).find(function (f) { return f.category === 'purchase' && f.refId === px.id; });
  assert(!purFundAfterDel, '删进货会撤销钱包扣款');
  await DB.addFund({ account: 'cash', amount: 1000, note: '初始现金', date: '2026-11-01' });
  const manual = (await DB.listFunds()).find(function (f) { return f.category === 'adjust' && f.note === '初始现金'; });
  assert(manual && manual.amount === 1000, '手动记一笔');

  console.log('== 库存预警单位 / 3位小数 ==');
  const tea = await DB.saveProduct({ name: '茶叶', type: 'material', costPrice: 50, unit: '件', spec: 100, specUnit: '克', alertThreshold: 150, alertUnit: 'weight' });
  assert(tea.alertUnit === 'weight', '原材料按克设预警线（单位保存为 weight）');
  await DB.addPurchase({ productId: tea.id, quantity: 2, totalCost: 100 });
  let teaPred = (await DB.computePredictions(14)).find(function (p) { return p.product.id === tea.id; });
  assert(teaPred.status !== 'low', '按克预警线：库存2件>150克(=1.5件)不触发');
  await DB.addConsumption({ productId: tea.id, quantity: 1 });
  teaPred = (await DB.computePredictions(14)).find(function (p) { return p.product.id === tea.id; });
  assert(teaPred.status === 'low', '按克预警线：库存1件<=1.5件触发提醒');

  const fine = await DB.saveProduct({ name: '香精', type: 'material', costPrice: 100, unit: '件', spec: 250, specUnit: '克' });
  await DB.addPurchase({ productId: fine.id, quantity: 1, totalCost: 100 });
  const tiny = await DB.addConsumption({ productId: fine.id, quantity: 31.25, mode: 'weight' });
  assert(tiny.quantity === 0.125, '3位小数：31.25克→0.125件（不被四舍五入成0.13）');
  assert(DB.toNumber((await DB.getProduct(fine.id)).stock) === 0.875, '3位小数：库存 1−0.125=0.875');

  const sold = await DB.saveProduct({ name: '饰品', type: 'sellable', costPrice: 1, sellPrice: 2, unit: '个', alertThreshold: 5, alertUnit: 'weight' });
  assert(sold.alertUnit === 'piece', '成品强制按件设预警线（忽略 weight）');

  console.log('== 删除资金流水 ==');
  await DB.addFund({ account: 'cash', amount: 50, note: '临时记账', date: '2026-11-02' });
  const tmpFund = (await DB.listFunds()).find(function (f) { return f.note === '临时记账'; });
  await DB.deleteFund(tmpFund.id);
  assert(!(await DB.listFunds()).find(function (f) { return f.note === '临时记账'; }), '删除手动记账');

  const pDel = await DB.saveProduct({ name: '删除进货测试', type: 'material', costPrice: 3, unit: '件' });
  await DB.addPurchase({ productId: pDel.id, quantity: 7, totalCost: 21, account: 'alipay' });
  const pFund = (await DB.listFunds()).find(function (f) { return f.category === 'purchase' && (f.note || '').indexOf('删除进货测试') !== -1; });
  assert(pFund && DB.toNumber((await DB.getProduct(pDel.id)).stock) === 7, '准备：进货后库存7、有扣款记录');
  await DB.deleteFund(pFund.id);
  assert(DB.toNumber((await DB.getProduct(pDel.id)).stock) === 0, '删进货支出会恢复库存');
  assert(!(await DB.listFunds()).find(function (f) { return f.category === 'purchase' && f.refId === pFund.refId; }), '删进货支出会撤销扣款');
  assert(!(await DB.listPurchases()).find(function (p) { return p.id === pFund.refId; }), '删进货支出会删除进货记录');

  await DB.saveSettlement({ date: '2026-11-03', cashOut: 50, cashBack: 100, wechat: 80, alipay: 20 });
  const wxFund = (await DB.listFunds()).find(function (f) { return f.category === 'settlement' && f.date === '2026-11-03' && f.account === 'wechat'; });
  await DB.deleteFund(wxFund.id);
  assert(DB.toNumber((await DB.getSettlement('2026-11-03')).wechat) === 0, '删微信收款会清空当天微信营业额');
  assert(!(await DB.listFunds()).find(function (f) { return f.category === 'settlement' && f.date === '2026-11-03' && f.account === 'wechat'; }), '删微信收款后资金流水无微信收款');

  console.log(failures === 0 ? '\n✅ 全部通过' : '\n❌ 有 ' + failures + ' 个失败');
  process.exit(failures === 0 ? 0 : 1);
})();

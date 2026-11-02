/* ============================================================
 * 摆摊记账 —— 数据层（IndexedDB）
 * 所有数据只存在手机浏览器本地，不上传任何服务器。
 * ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'baitan-jizhang';
  const DB_VERSION = 4;
  const APP_ID = 'baitan-jizhang';

  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('purchases')) {
          const s = db.createObjectStore('purchases', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('productId', 'productId');
        }
        if (!db.objectStoreNames.contains('sales')) {
          const s = db.createObjectStore('sales', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('productId', 'productId');
        }
        if (!db.objectStoreNames.contains('consumptions')) {
          const s = db.createObjectStore('consumptions', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('productId', 'productId');
        }
        if (!db.objectStoreNames.contains('settlements')) {
          db.createObjectStore('settlements', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('adjustments')) {
          const s = db.createObjectStore('adjustments', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('productId', 'productId');
        }
        if (!db.objectStoreNames.contains('funds')) {
          const s = db.createObjectStore('funds', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('account', 'account');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function toNumber(v, def) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (def === undefined ? 0 : def);
  }

  function round2(n) {
    return Math.round(toNumber(n) * 100) / 100;
  }

  // 数量/克重/规格等允许三位小数（金额仍用 round2 保留两位）
  function round3(n) {
    return Math.round(toNumber(n) * 1000) / 1000;
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayStr() {
    return localDateStr(new Date());
  }

  function parseDateStr(s) {
    const parts = String(s || '').split('-').map(Number);
    if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function formatCnDate(d) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // ---------- 通用存取 ----------

  async function getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName).objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getOne(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName).objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(storeName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  async function removeOne(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- 设置 ----------

  async function getSetting(key) {
    const r = await getOne('settings', key);
    return r ? r.value : undefined;
  }

  async function setSetting(key, value) {
    await put('settings', { key: key, value: value });
  }

  async function removeSetting(key) {
    await removeOne('settings', key);
  }

  // ---------- 商品 ----------

  async function listProducts() {
    const all = await getAll('products');
    return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function getProduct(id) {
    return getOne('products', id);
  }

  async function saveProduct(p) {
    if (!p.id) {
      p.id = uid();
      p.createdAt = Date.now();
    }
    p.type = (p.type === 'material') ? 'material' : 'sellable';
    p.stock = toNumber(p.stock);
    p.costPrice = toNumber(p.costPrice);
    p.sellPrice = toNumber(p.sellPrice);
    p.unit = String(p.unit || '').trim();
    p.alertThreshold = (p.alertThreshold === '' || p.alertThreshold === null || p.alertThreshold === undefined)
      ? null : toNumber(p.alertThreshold);
    if (p.type === 'material') {
      p.spec = (p.spec === '' || p.spec === null || p.spec === undefined) ? null : toNumber(p.spec);
      p.specUnit = String(p.specUnit || '').trim();
    } else {
      p.spec = null;
      p.specUnit = '';
    }
    // 库存预警线单位：默认「件」；只有原材料且填了规格（每件克重）才能按重量设
    p.alertUnit = (p.alertUnit === 'weight' && p.type === 'material' && toNumber(p.spec) > 0) ? 'weight' : 'piece';
    p.updatedAt = Date.now();
    await put('products', p);
    return p;
  }

  async function deleteProduct(id) {
    await removeOne('products', id);
  }

  // ---------- 进货 ----------

  async function addPurchase(o) {
    const product = await getProduct(o.productId);
    if (!product) throw new Error('商品不存在');
    const quantity = toNumber(o.quantity);
    if (quantity <= 0) throw new Error('数量必须大于 0');
    const totalCost = round2(toNumber(o.totalCost));
    const unitCost = round2(totalCost / quantity);
    const account = o.account || 'cash';
    const rec = {
      id: uid(),
      productId: product.id,
      productName: product.name,
      productType: product.type,
      quantity: quantity,
      unit: String(product.unit || '件'),
      unitCost: unitCost,
      totalCost: totalCost,
      spec: (product.spec === null || product.spec === undefined) ? null : toNumber(product.spec),
      specUnit: String(product.specUnit || ''),
      account: account,
      date: o.date || todayStr(),
      note: String(o.note || ''),
      createdAt: Date.now(),
    };
    await put('purchases', rec);
    // 从对应账户扣钱（钱包）
    await put('funds', {
      id: uid(),
      account: account,
      amount: round2(-totalCost),
      category: 'purchase',
      refId: rec.id,
      date: rec.date,
      note: '进货 ' + product.name + ' ×' + quantity,
      createdAt: Date.now(),
    });
    product.stock = toNumber(product.stock) + quantity;
    product.costPrice = unitCost; // 进价自动跟最近一次进货走，核算成本才准
    product.updatedAt = Date.now();
    await put('products', product);
    return rec;
  }

  // ---------- 卖货 ----------

  async function addSale(o) {
    const product = await getProduct(o.productId);
    if (!product) throw new Error('商品不存在');
    const quantity = toNumber(o.quantity);
    if (quantity <= 0) throw new Error('数量必须大于 0');
    if (quantity > toNumber(product.stock)) {
      throw new Error('库存不足（当前库存 ' + product.stock + '）');
    }
    let unitPrice = (o.unitPrice === '' || o.unitPrice === null || o.unitPrice === undefined)
      ? toNumber(product.sellPrice) : toNumber(o.unitPrice);
    const unitCost = toNumber(product.costPrice);
    const totalAmount = round2(unitPrice * quantity);
    const rec = {
      id: uid(),
      productId: product.id,
      productName: product.name,
      productType: product.type,
      quantity: quantity,
      unit: String(product.unit || '件'),
      unitPrice: unitPrice,
      unitCost: unitCost,
      totalAmount: totalAmount,
      date: o.date || todayStr(),
      note: String(o.note || ''),
      createdAt: Date.now(),
    };
    await put('sales', rec);
    product.stock = toNumber(product.stock) - quantity;
    product.updatedAt = Date.now();
    await put('products', product);
    return rec;
  }

  async function listSales() {
    const all = await getAll('sales');
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function deleteSale(id) {
    const rec = await getOne('sales', id);
    if (!rec) return;
    await removeOne('sales', id);
    const product = await getProduct(rec.productId);
    if (product) {
      product.stock = round3(toNumber(product.stock) + toNumber(rec.quantity));
      product.updatedAt = Date.now();
      await put('products', product);
    }
  }

  async function listPurchases() {
    const all = await getAll('purchases');
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function deletePurchase(id) {
    const rec = await getOne('purchases', id);
    if (!rec) return;
    await removeOne('purchases', id);
    // 撤销钱包扣款
    const funds = await getAll('funds');
    for (const f of funds) {
      if (f.category === 'purchase' && f.refId === id) await removeOne('funds', f.id);
    }
    const product = await getProduct(rec.productId);
    if (product) {
      product.stock = round3(toNumber(product.stock) - toNumber(rec.quantity));
      // 若删的是最新一笔进货，进价回退到上一笔进货单价
      const remaining = (await getAll('purchases')).filter(function (p) { return p.productId === rec.productId && p.id !== id; });
      if (remaining.length) {
        const latest = remaining.reduce(function (a, b) { return (b.createdAt || 0) > (a.createdAt || 0) ? b : a; });
        product.costPrice = latest.unitCost;
      }
      product.updatedAt = Date.now();
      await put('products', product);
    }
  }

  // ---------- 消耗 / 领用（原材料 + 成品，按进价算成本） ----------

  async function addConsumption(o) {
    const product = await getProduct(o.productId);
    if (!product) throw new Error('商品不存在');
    const rawQty = toNumber(o.quantity);
    if (rawQty <= 0) throw new Error('数量必须大于 0');

    const unitCost = toNumber(product.costPrice); // 每件进价
    const spec = toNumber(product.spec);
    const useWeight = (o.mode === 'weight') && spec > 0;
    let quantity, weightQty = null, specUnit = '';
    if (useWeight) {
      specUnit = String(product.specUnit || '克');
      weightQty = rawQty;               // 用户填的克数
      quantity = round3(rawQty / spec); // 换算成件数
    } else {
      quantity = rawQty;
    }
    if (quantity > toNumber(product.stock)) {
      throw new Error('库存不足（当前库存 ' + product.stock + ' 件）');
    }
    const cost = round2(unitCost * quantity);

    const rec = {
      id: uid(),
      productId: product.id,
      productName: product.name,
      productType: product.type,
      quantity: quantity,
      weightQty: weightQty,
      specUnit: specUnit,
      spec: spec,
      unitCost: unitCost,
      cost: cost,
      date: o.date || todayStr(),
      note: String(o.note || ''),
      createdAt: Date.now(),
    };
    await put('consumptions', rec);
    product.stock = round3(toNumber(product.stock) - quantity);
    product.updatedAt = Date.now();
    await put('products', product);
    return rec;
  }

  async function listConsumptions() {
    const all = await getAll('consumptions');
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function deleteConsumption(id) {
    const rec = await getOne('consumptions', id);
    if (!rec) return;
    await removeOne('consumptions', id);
    const product = await getProduct(rec.productId);
    if (product) {
      product.stock = round3(toNumber(product.stock) + toNumber(rec.quantity));
      product.updatedAt = Date.now();
      await put('products', product);
    }
  }

  // 把某商品某天的消耗总量设为指定值（「核算」成本栏：填好数量后固定，加减微调）
  async function setDailyConsumption(o) {
    const product = await getProduct(o.productId);
    if (!product) throw new Error('商品不存在');
    const date = o.date || todayStr();
    const rawQty = toNumber(o.quantity);
    if (rawQty < 0) throw new Error('数量不能为负');

    const spec = toNumber(product.spec);
    const useWeight = (o.mode === 'weight') && spec > 0;
    let quantity, weightQty = null, specUnit = '';
    if (useWeight) {
      specUnit = String(product.specUnit || '克');
      weightQty = rawQty;
      quantity = round3(rawQty / spec);
    } else {
      quantity = rawQty;
    }

    // 本次用的进价：优先用用户选的进货批次单价，否则用商品当前进价
    let unitCost = toNumber(product.costPrice);
    let costPurchaseId = null;
    if (o.purchaseId) {
      const purchase = await getOne('purchases', o.purchaseId);
      if (purchase && purchase.productId === product.id) {
        unitCost = toNumber(purchase.unitCost);
        costPurchaseId = purchase.id;
      }
    }

    // 只撤销「同一批次」的当天旧记录：指定批次就只改该批，未指定就只改无批次的那条。
    // 这样不同进价的批次可以各自独立记用量、各自回补库存。
    const all = await getAll('consumptions');
    const todays = all.filter(function (c) { return c.productId === product.id && c.date === date; });
    const toRemove = todays.filter(function (c) {
      if (o.purchaseId) return c.costPurchaseId === o.purchaseId;
      return !c.costPurchaseId;
    });
    const removedSum = toRemove.reduce(function (s, c) { return s + toNumber(c.quantity); }, 0);

    const restoredStock = round3(toNumber(product.stock) + removedSum);
    if (quantity > restoredStock) {
      throw new Error('库存不足（当前库存 ' + restoredStock + ' 件）');
    }

    // 撤销该批的当天旧记录，再按新数量记一条（或归零）
    for (const c of toRemove) await removeOne('consumptions', c.id);

    let newStock = restoredStock;
    if (quantity > 0) {
      const cost = round2(unitCost * quantity);
      const rec = {
        id: uid(),
        productId: product.id,
        productName: product.name,
        productType: product.type,
        quantity: quantity,
        weightQty: weightQty,
        specUnit: specUnit,
        spec: spec,
        unitCost: unitCost,
        cost: cost,
        costPurchaseId: costPurchaseId,
        date: date,
        note: String(o.note || ''),
        createdAt: Date.now(),
      };
      await put('consumptions', rec);
      newStock = round3(newStock - quantity);
    }
    product.stock = newStock;
    product.updatedAt = Date.now();
    await put('products', product);
    return true;
  }

  // ---------- 每日核算（营业额结算） / 盘点校正 ----------

  async function getSettlement(date) {
    return getOne('settlements', date);
  }

  async function saveSettlement(s) {
    const date = s.date || todayStr();
    const rec = {
      date: date,
      cashOut: toNumber(s.cashOut),
      cashBack: toNumber(s.cashBack),
      wechat: toNumber(s.wechat),
      alipay: toNumber(s.alipay),
      note: String(s.note || ''),
      updatedAt: Date.now(),
    };
    await put('settlements', rec);
    // 同步到钱包：按日期整组重写当天的收入（带出现金也体现在这里）
    const funds = await getAll('funds');
    for (const f of funds) {
      if (f.category === 'settlement' && f.date === date) await removeOne('funds', f.id);
    }
    const entries = [
      { account: 'cash', amount: round2(toNumber(s.cashBack) - toNumber(s.cashOut)), note: '现金收入' },
      { account: 'wechat', amount: round2(toNumber(s.wechat)), note: '微信收款' },
      { account: 'alipay', amount: round2(toNumber(s.alipay)), note: '支付宝收款' },
    ];
    for (const e of entries) {
      if (e.amount === 0) continue;
      await put('funds', {
        id: uid(),
        account: e.account,
        amount: e.amount,
        category: 'settlement',
        date: date,
        note: e.note,
        createdAt: Date.now(),
      });
    }
    return rec;
  }

  async function listSettlements() {
    const all = await getAll('settlements');
    return all.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  async function adjustStock(o) {
    const product = await getProduct(o.productId);
    if (!product) throw new Error('商品不存在');
    const before = toNumber(product.stock);
    const spec = toNumber(product.spec);
    const useWeight = (o.mode === 'weight') && spec > 0;
    let after;
    if (useWeight) after = round3(toNumber(o.actualQty) / spec);
    else after = toNumber(o.actualQty);
    if (after < 0) throw new Error('数量不能为负');
    const delta = round3(after - before);
    const rec = {
      id: uid(),
      productId: product.id,
      productName: product.name,
      date: o.date || todayStr(),
      before: before,
      after: after,
      delta: delta,
      weightQty: useWeight ? toNumber(o.actualQty) : null,
      specUnit: useWeight ? String(product.specUnit || '克') : '',
      note: String(o.note || ''),
      createdAt: Date.now(),
    };
    await put('adjustments', rec);
    product.stock = after;
    product.updatedAt = Date.now();
    await put('products', product);
    return rec;
  }

  async function listAdjustments() {
    const all = await getAll('adjustments');
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  // ---------- 钱包 / 资金记录 ----------

  // 三个账户：cash 现金 / wechat 微信 / alipay 支付宝。金额正数=进账，负数=支出。
  async function listFunds() {
    const all = await getAll('funds');
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function addFund(o) {
    const amount = round2(toNumber(o.amount));
    if (amount === 0) throw new Error('金额不能为 0');
    const rec = {
      id: uid(),
      account: o.account || 'cash',
      amount: amount,
      category: o.category || 'adjust',
      date: o.date || todayStr(),
      note: String(o.note || ''),
      createdAt: Date.now(),
    };
    await put('funds', rec);
    return rec;
  }

  // 现金转出：把现金转到微信或支付宝（现金减少、目标账户增加，总额不变）。
  // 记两条流水并用同一个 refId 关联，方便整组一起撤销。
  async function transferCashOut(o) {
    const amount = round2(toNumber(o.amount));
    if (amount <= 0) throw new Error('金额必须大于 0');
    const to = o.to;
    if (to !== 'wechat' && to !== 'alipay') throw new Error('请选择转出到微信或支付宝');
    const date = o.date || todayStr();
    const refId = uid();
    const targetName = to === 'wechat' ? '微信' : '支付宝';
    await put('funds', {
      id: uid(), account: 'cash', amount: round2(-amount), category: 'transfer',
      refId: refId, date: date, note: '现金转出到' + targetName, createdAt: Date.now(),
    });
    await put('funds', {
      id: uid(), account: to, amount: amount, category: 'transfer',
      refId: refId, date: date, note: '现金转入', createdAt: Date.now(),
    });
    return refId;
  }

  // 删除一条资金流水：按来源分别处理，保证钱包和进货/营业额保持一致
  async function deleteFund(id) {
    const f = await getOne('funds', id);
    if (!f) return;
    if (f.category === 'purchase' && f.refId) {
      // 进货支出：撤销整条进货（库存加回、扣款撤销、进货记录一并删除）
      await deletePurchase(f.refId);
      return;
    }
    if (f.category === 'settlement' && f.date) {
      // 收款收入：清掉当天该账户的收款，并重写营业额（钱包和首页保持一致）
      const st = await getSettlement(f.date);
      if (st) {
        if (f.account === 'wechat') st.wechat = 0;
        else if (f.account === 'alipay') st.alipay = 0;
        else if (f.account === 'cash') { st.cashBack = st.cashOut; }
        await saveSettlement(st);
      } else {
        await removeOne('funds', id);
      }
      return;
    }
    if (f.category === 'transfer' && f.refId) {
      // 现金转出：把「现金减少」和「目标账户增加」两条一起删掉，恢复转账前余额
      const funds = await getAll('funds');
      for (const g of funds) {
        if (g.category === 'transfer' && g.refId === f.refId) await removeOne('funds', g.id);
      }
      return;
    }
    // 手动记账等：直接删除
    await removeOne('funds', id);
  }

  // 修改一条资金流水（只允许改安全字段）：保留 id、createdAt（时间不变）、category、refId。
  async function updateFund(id, changes) {
    const f = await getOne('funds', id);
    if (!f) throw new Error('记录不存在');
    if (changes.account !== undefined) f.account = changes.account;
    if (changes.amount !== undefined) f.amount = round2(toNumber(changes.amount));
    if (changes.date !== undefined) f.date = changes.date;
    if (changes.note !== undefined) f.note = String(changes.note || '');
    await put('funds', f);
    return f;
  }

  // 修改一笔进货的总金额：只改金额和进价，不动库存数量；若是最新一笔进货，商品当前进价跟着变。
  async function updatePurchaseAmount(id, newTotal) {
    const rec = await getOne('purchases', id);
    if (!rec) throw new Error('进货记录不存在');
    const total = round2(toNumber(newTotal));
    if (total < 0) throw new Error('金额不能为负');
    const quantity = toNumber(rec.quantity);
    rec.totalCost = total;
    rec.unitCost = quantity > 0 ? round2(total / quantity) : 0;
    await put('purchases', rec);
    const product = await getProduct(rec.productId);
    if (product) {
      const all = await getAll('purchases');
      const mine = all.filter(function (p) { return p.productId === rec.productId; });
      const latest = mine.length ? mine.reduce(function (a, b) { return (b.createdAt || 0) > (a.createdAt || 0) ? b : a; }) : null;
      if (latest && latest.id === rec.id) {
        product.costPrice = rec.unitCost;
        product.updatedAt = Date.now();
        await put('products', product);
      }
    }
    return rec;
  }

  // 修改一条资金流水的所有关键字段（账户/金额/日期/备注），并同步对应的源记录，
  // 保证钱包和进货 / 营业额 / 转账保持一致；id、createdAt（时间）不变。
  async function updateFundFull(id, o) {
    const f = await getOne('funds', id);
    if (!f) throw new Error('记录不存在');
    const account = (o.account !== undefined && o.account !== null) ? o.account : f.account;
    const amount = (o.amount !== undefined && o.amount !== null) ? round2(toNumber(o.amount)) : round2(toNumber(f.amount));
    const date = (o.date !== undefined && o.date !== null) ? o.date : f.date;
    const note = (o.note !== undefined) ? String(o.note || '') : String(f.note || '');

    // 进货支出：同步进货记录（账户、金额→进价、日期、数量→库存），库存跟着数量差一起调整
    if (f.category === 'purchase' && f.refId) {
      const pur = await getOne('purchases', f.refId);
      if (pur) {
        const oldQty = toNumber(pur.quantity);
        const newQty = (o.quantity !== undefined && o.quantity !== null) ? round3(toNumber(o.quantity)) : oldQty;
        if (!(newQty > 0)) throw new Error('数量必须大于 0');
        const total = round2(Math.abs(amount));
        pur.account = account;
        pur.date = date;
        pur.quantity = newQty;
        pur.totalCost = total;
        pur.unitCost = newQty > 0 ? round2(total / newQty) : 0;
        await put('purchases', pur);
        const product = await getProduct(pur.productId);
        if (product) {
          // 数量从旧值改成新值，库存把差额补/扣回去
          product.stock = round3(toNumber(product.stock) + newQty - oldQty);
          const all = await getAll('purchases');
          const mine = all.filter(function (p) { return p.productId === pur.productId; });
          const latest = mine.length ? mine.reduce(function (a, b) { return (b.createdAt || 0) > (a.createdAt || 0) ? b : a; }) : null;
          if (latest && latest.id === pur.id) {
            product.costPrice = pur.unitCost;
          }
          product.updatedAt = Date.now();
          await put('products', product);
        }
      }
      f.account = account;
      f.amount = round2(-Math.abs(amount));
      f.date = date;
      f.note = note;
      await put('funds', f);
      return f;
    }

    // 收款收入：账户/金额/日期都可改（把一笔收入从一个账户、一天挪到另一个账户或另一天）
    if (f.category === 'settlement') {
      const newAbs = round2(Math.abs(amount));
      // 旧日期旧账户：这一笔先从原账户的营业额里去掉（该账户当天归零）
      const oldSt = await getSettlement(f.date);
      if (oldSt) {
        if (f.account === 'wechat') oldSt.wechat = 0;
        else if (f.account === 'alipay') oldSt.alipay = 0;
        else if (f.account === 'cash') oldSt.cashBack = round2(toNumber(oldSt.cashOut)); // 现金收入归零
        oldSt.updatedAt = Date.now();
        await put('settlements', oldSt);
      }
      // 新日期新账户：把新金额加到目标账户上
      let newSt = await getSettlement(date);
      if (!newSt) newSt = { date: date, cashOut: 0, cashBack: 0, wechat: 0, alipay: 0, note: '' };
      if (account === 'wechat') newSt.wechat = round2(toNumber(newSt.wechat) + newAbs);
      else if (account === 'alipay') newSt.alipay = round2(toNumber(newSt.alipay) + newAbs);
      else if (account === 'cash') newSt.cashBack = round2(toNumber(newSt.cashBack) + newAbs);
      newSt.updatedAt = Date.now();
      await put('settlements', newSt);
      f.account = account;
      f.amount = newAbs;
      f.date = date;
      f.note = note;
      await put('funds', f);
      return f;
    }

    // 现金转出：两条流水（现金减少 / 目标账户增加）金额一起改、日期一起改，保持一对；
    // 转入方可在微信 / 支付宝之间切换（转出方始终是现金）
    if (f.category === 'transfer' && f.refId) {
      const abs = round2(Math.abs(amount));
      const funds = await getAll('funds');
      for (const g of funds) {
        if (g.category === 'transfer' && g.refId === f.refId) {
          const isOut = toNumber(g.amount) < 0;
          g.amount = isOut ? round2(-abs) : abs;
          g.date = date;
          if (!isOut && (account === 'wechat' || account === 'alipay')) g.account = account;
          g.note = note;
          await put('funds', g);
        }
      }
      // 返回库里已经写好的那条（id、createdAt 不变）
      return await getOne('funds', id);
    }

    // 手动记账等：直接改
    f.account = account;
    f.amount = amount;
    f.date = date;
    f.note = note;
    await put('funds', f);
    return f;
  }

  // ---------- 库存预警 / 预测 ----------

  // 预测每件商品“预计几天后卖完”。windowDays：用最近多少天的销量来算平均。
  async function computePredictions(windowDays) {
    const days = toNumber(windowDays, 14) || 14;
    const products = await listProducts();
    const sales = await getAll('sales');
    const consumptions = await getAll('consumptions');

    const today = startOfDay(new Date());
    const since = addDays(today, -(days - 1));

    // 按商品汇总窗口期内的销量 / 消耗量
    const qtyMap = {};
    for (const s of sales) {
      const d = parseDateStr(s.date);
      if (d && d >= since && d <= today) qtyMap[s.productId] = toNumber(qtyMap[s.productId]) + toNumber(s.quantity);
    }
    for (const c of consumptions) {
      const d = parseDateStr(c.date);
      if (d && d >= since && d <= today) qtyMap[c.productId] = toNumber(qtyMap[c.productId]) + toNumber(c.quantity);
    }

    return products.map((p) => {
      const stock = toNumber(p.stock);
      const windowQty = toNumber(qtyMap[p.id]);
      const avgPerDay = windowQty / days;
      let daysLeft = null;
      let runOutDate = null;
      if (avgPerDay > 0) {
        daysLeft = round2(stock / avgPerDay);
        runOutDate = addDays(today, Math.ceil(stock / avgPerDay));
      }

      // 状态判定：用完/售罄 > 低于警戒线 > 预计快用完
      let status = 'ok';
      const threshold = p.alertThreshold;
      // 预警线若按重量设，先换算成件数再比较
      const thresholdPieces = (p.alertUnit === 'weight' && toNumber(p.spec) > 0)
        ? round3(toNumber(threshold) / toNumber(p.spec))
        : toNumber(threshold);
      if (stock <= 0) status = 'out';
      else if (threshold !== null && threshold !== undefined && stock <= thresholdPieces) status = 'low';
      else if (daysLeft !== null && daysLeft <= 3) status = 'soon';

      return {
        product: p,
        windowQty: windowQty,
        avgPerDay: avgPerDay,
        daysLeft: daysLeft,
        runOutDate: runOutDate,
        status: status,
      };
    });
  }

  // ---------- 备份 / 导入 ----------

  async function exportBackup() {
    const [products, purchases, sales, consumptions, settlements, adjustments, funds] = await Promise.all([
      getAll('products'), getAll('purchases'), getAll('sales'), getAll('consumptions'),
      getAll('settlements'), getAll('adjustments'), getAll('funds'),
    ]);
    return {
      app: APP_ID,
      formatVersion: 4,
      exportedAt: new Date().toISOString(),
      data: {
        products: products, purchases: purchases, sales: sales,
        consumptions: consumptions, settlements: settlements, adjustments: adjustments,
        funds: funds,
      },
    };
  }

  async function replaceAllData(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'purchases', 'sales', 'consumptions', 'settlements', 'adjustments', 'funds'], 'readwrite');
      tx.objectStore('products').clear();
      tx.objectStore('purchases').clear();
      tx.objectStore('sales').clear();
      tx.objectStore('consumptions').clear();
      tx.objectStore('settlements').clear();
      tx.objectStore('adjustments').clear();
      tx.objectStore('funds').clear();
      (data.products || []).forEach((p) => tx.objectStore('products').put(p));
      (data.purchases || []).forEach((p) => tx.objectStore('purchases').put(p));
      (data.sales || []).forEach((s) => tx.objectStore('sales').put(s));
      (data.consumptions || []).forEach((c) => tx.objectStore('consumptions').put(c));
      (data.settlements || []).forEach((s) => tx.objectStore('settlements').put(s));
      (data.adjustments || []).forEach((a) => tx.objectStore('adjustments').put(a));
      (data.funds || []).forEach((f) => tx.objectStore('funds').put(f));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('写入失败'));
      tx.onabort = () => reject(tx.error || new Error('写入失败'));
    });
  }

  async function importBackup(json) {
    if (!json || json.app !== APP_ID || !json.data) {
      throw new Error('这不是本应用的备份文件，无法导入');
    }
    // 导入前自动留一份当前数据的快照，方便撤销
    const snapshot = await exportBackup();
    await setSetting('_undoSnapshot', snapshot);
    await replaceAllData(json.data);
  }

  async function hasUndo() {
    const s = await getSetting('_undoSnapshot');
    return !!s;
  }

  async function undoImport() {
    const snapshot = await getSetting('_undoSnapshot');
    if (!snapshot || !snapshot.data) return false;
    await replaceAllData(snapshot.data);
    await removeSetting('_undoSnapshot');
    return true;
  }

  // ---------- 密码 ----------

  function hashString(str) {
    // FNV-1a 32 位，仅作本机简单防护用（不是高强度加密）
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return 'h' + (h >>> 0).toString(16);
  }

  async function hashPin(pin) {
    return hashString('baitan-pin::' + String(pin));
  }

  async function hasPin() {
    return !!(await getSetting('pinHash'));
  }

  async function setPin(pin) {
    if (!pin || String(pin).length < 4) throw new Error('密码至少 4 位');
    await setSetting('pinHash', await hashPin(pin));
  }

  async function verifyPin(pin) {
    const hash = await getSetting('pinHash');
    if (!hash) return true; // 没设密码
    return (await hashPin(pin)) === hash;
  }

  async function clearPin() {
    await removeSetting('pinHash');
  }

  global.DB = {
    APP_ID: APP_ID,
    uid: uid,
    toNumber: toNumber,
    round2: round2,
    round3: round3,
    startOfDay: startOfDay,
    localDateStr: localDateStr,
    todayStr: todayStr,
    parseDateStr: parseDateStr,
    addDays: addDays,
    formatCnDate: formatCnDate,
    getSetting: getSetting,
    setSetting: setSetting,
    removeSetting: removeSetting,
    listProducts: listProducts,
    getProduct: getProduct,
    saveProduct: saveProduct,
    deleteProduct: deleteProduct,
    addPurchase: addPurchase,
    addSale: addSale,
    addConsumption: addConsumption,
    listSales: listSales,
    listPurchases: listPurchases,
    listConsumptions: listConsumptions,
    deleteSale: deleteSale,
    deletePurchase: deletePurchase,
    deleteConsumption: deleteConsumption,
    setDailyConsumption: setDailyConsumption,
    getSettlement: getSettlement,
    saveSettlement: saveSettlement,
    listSettlements: listSettlements,
    adjustStock: adjustStock,
    listAdjustments: listAdjustments,
    listFunds: listFunds,
    addFund: addFund,
    transferCashOut: transferCashOut,
    deleteFund: deleteFund,
    updateFund: updateFund,
    updateFundFull: updateFundFull,
    updatePurchaseAmount: updatePurchaseAmount,
    computePredictions: computePredictions,
    exportBackup: exportBackup,
    importBackup: importBackup,
    hasUndo: hasUndo,
    undoImport: undoImport,
    hasPin: hasPin,
    setPin: setPin,
    verifyPin: verifyPin,
    clearPin: clearPin,
  };
})(window);

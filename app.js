/* ============================================================
 * 摆摊记账 —— 界面逻辑
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 全局状态 ----------
  let currentTab = 'home';
  let unlocked = false;
  let productSearch = '';
  let statsPeriod = '7';
  let statsSelected = -1;
  let statsDays = [];
  let reconcileDate = '';
  let costRowModes = {}; // 商品id -> 'weight' | 'piece'（核算成本栏记住按克还是按件）
  let purchaseEditingId = null; // 商品页内联进货中：当前编辑的商品 id

  const UNITS = ['个', '件', '份', '串', '盒', '包', '袋', '瓶', '罐', '杯', '斤', '两', '克', '公斤', '毫升', '升', '箱', '捆', '把', '条', '只', '块', '根', '张', '双', '对', '套', '组', '米'];
  const SPEC_UNITS = ['克', '斤', '两', '公斤', '毫升', '升'];

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMoney(n) {
    n = DB.toNumber(n);
    const neg = n < 0;
    const abs = Math.abs(n);
    const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return (neg ? '-' : '') + s;
  }

  function fmtNum(n) {
    const r = Math.round(DB.toNumber(n) * 1000) / 1000;
    return String(r);
  }

  function fmtAxis(n) {
    if (n >= 10000) {
      const w = n / 10000;
      return (Number.isInteger(w) ? w : w.toFixed(1)) + '万';
    }
    return Math.round(n).toLocaleString('zh-CN');
  }

  // 钱包三个账户
  const ACCOUNTS = { cash: '现金', wechat: '微信', alipay: '支付宝' };
  function accountLabel(k) { return ACCOUNTS[k] || '现金'; }

  // 时间精确到秒
  function fmtDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast hidden';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2300);
  }

  // ---------- 弹窗 ----------
  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-backdrop" data-close></div><div class="modal">' + html + '</div>';
    root.classList.remove('hidden');
  }
  function closeModal() {
    const root = document.getElementById('modal-root');
    root.classList.add('hidden');
    root.innerHTML = '';
  }
  function showConfirm(message, onYes) {
    openModal(
      '<h3>确认</h3>' +
      '<p style="color:var(--ink-2);margin:0">' + esc(message) + '</p>' +
      '<div class="field-row" style="margin-top:18px">' +
      '<button class="btn btn-ghost btn-block" data-close>取消</button>' +
      '<button class="btn btn-danger btn-block" id="confirm-yes">确定</button>' +
      '</div>'
    );
    document.getElementById('confirm-yes').onclick = function () {
      closeModal();
      onYes();
    };
  }

  // ---------- 密码 ----------
  function unlock() {
    unlocked = true;
    const root = document.getElementById('pin-root');
    root.classList.add('hidden');
    root.innerHTML = '';
    showTab(currentTab);
  }

  function lock() {
    unlocked = false;
    showPinEnter();
  }

  function showPinEnter() {
    const root = document.getElementById('pin-root');
    root.classList.remove('hidden');
    root.innerHTML =
      '<div class="pin-box">' +
      '<div class="pin-logo">🔒</div>' +
      '<h2>输入密码</h2>' +
      '<p>进入摆摊记账</p>' +
      '<input class="pin-input" id="pin-enter" type="password" inputmode="numeric" maxlength="6" placeholder="密码" autocomplete="off">' +
      '<div class="pin-err" id="pin-enter-err"></div>' +
      '<button class="btn btn-primary btn-block" id="pin-enter-ok" style="margin-top:12px">进入</button>' +
      '</div>';
    const input = root.querySelector('#pin-enter');
    const err = root.querySelector('#pin-enter-err');
    setTimeout(function () { input.focus(); }, 50);
    function go() {
      DB.verifyPin(input.value.trim()).then(function (ok) {
        if (ok) unlock();
        else { err.textContent = '密码错误'; input.value = ''; input.focus(); }
      });
    }
    root.querySelector('#pin-enter-ok').onclick = go;
    input.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }

  function showPinSetup(isChange) {
    const root = document.getElementById('pin-root');
    root.classList.remove('hidden');
    let step = 1, first = '';
    function renderStep() {
      const isConfirm = step === 2;
      root.innerHTML =
        '<div class="pin-box">' +
        '<div class="pin-logo">🔑</div>' +
        '<h2>' + (isChange ? '修改密码' : '设置密码') + '</h2>' +
        '<p>' + (isConfirm ? '请再输一次确认' : '输入 4-6 位数字密码') + '</p>' +
        '<input class="pin-input" id="pin-set-input" type="password" inputmode="numeric" maxlength="6" placeholder="' + (isConfirm ? '再输一次' : '密码') + '" autocomplete="off">' +
        '<div class="pin-err" id="pin-set-err"></div>' +
        '<button class="btn btn-primary btn-block" id="pin-set-next" style="margin-top:12px">' + (isConfirm ? '确认' : '下一步') + '</button>' +
        (!isChange && !isConfirm ? '<button class="btn btn-ghost btn-block" id="pin-set-skip" style="margin-top:8px">暂不设置</button>' : '') +
        (isChange && !isConfirm ? '<button class="btn btn-ghost btn-block" id="pin-set-cancel" style="margin-top:8px">取消</button>' : '') +
        '</div>';
      const input = root.querySelector('#pin-set-input');
      const err = root.querySelector('#pin-set-err');
      setTimeout(function () { input.focus(); }, 50);
      function go() {
        const v = input.value.trim();
        if (step === 1) {
          if (v.length < 4) { err.textContent = '至少 4 位'; return; }
          first = v; step = 2; renderStep();
        } else {
          if (v !== first) { err.textContent = '两次输入不一致'; return; }
          DB.setPin(first).then(function () {
            toast(isChange ? '密码已修改' : '密码已设置');
            unlock();
          });
        }
      }
      root.querySelector('#pin-set-next').onclick = go;
      input.onkeydown = function (e) { if (e.key === 'Enter') go(); };
      const skip = root.querySelector('#pin-set-skip');
      if (skip) skip.onclick = function () { DB.setSetting('pinSkipped', true); unlock(); };
      const cancel = root.querySelector('#pin-set-cancel');
      if (cancel) cancel.onclick = function () { unlock(); };
    }
    renderStep();
  }

  // ---------- 导航 ----------
  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tabbar .tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-' + tab).classList.add('active');
    const titles = { home: '摆摊记账', products: '商品', wallet: '钱包', stats: '统计', settings: '设置' };
    document.getElementById('topbar-title').textContent = titles[tab];
    if (tab === 'home') renderHome();
    else if (tab === 'products') renderProducts();
    else if (tab === 'wallet') renderWallet();
    else if (tab === 'stats') renderStats();
    else if (tab === 'settings') renderSettings();
  }

  // ---------- 首页 ----------
  function rankStatus(s) { return s === 'out' ? 0 : (s === 'low' ? 1 : 2); }

  // 预警线换算成「件」：按重量设时除以每件规格
  function alertThresholdPieces(p) {
    const t = DB.toNumber(p.alertThreshold);
    if (p.alertUnit === 'weight' && DB.toNumber(p.spec) > 0) return DB.round3(t / DB.toNumber(p.spec));
    return t;
  }

  // 预警线按什么单位显示
  function alertThresholdText(p) {
    if (p.alertUnit === 'weight' && DB.toNumber(p.spec) > 0) {
      return fmtNum(DB.toNumber(p.alertThreshold)) + (p.specUnit || '克');
    }
    return fmtNum(DB.toNumber(p.alertThreshold)) + '件';
  }

  function alertText(a) {
    const isMat = a.product.type === 'material';
    if (a.status === 'out') return isMat ? '已用完，请补货' : '已售罄，请尽快补货';
    if (a.status === 'low') return '低于警戒线（警戒线 ' + alertThresholdText(a.product) + '）';
    if (a.status === 'soon') return '预计 ' + fmtNum(a.daysLeft) + ' 天后用完（约 ' + DB.formatCnDate(a.runOutDate) + '）';
    return '';
  }

  function alertRow(a) {
    const p = a.product;
    const outLabel = p.type === 'material' ? '已用完' : '已售罄';
    const label = a.status === 'out' ? outLabel : (a.status === 'low' ? '不足' : '快用完');
    const cls = a.status === 'out' ? 'out' : (a.status === 'low' ? 'low' : 'soon');
    return '<div class="list-item alert-row" data-alert-product="' + p.id + '">' +
      '<div class="main">' +
      '<div class="title">' + esc(p.name) + ' <span class="badge ' + cls + '">' + label + '</span></div>' +
      '<div class="alert-msg">剩 <strong>' + p.stock + '</strong> 件 · ' + alertText(a) + '</div>' +
      '</div></div>';
  }

  function recordRow(r) {
    const isSale = r.type === 'sale';
    const isConsume = r.type === 'consume';
    const isPurchase = r.type === 'purchase';
    const amount = isSale ? r.totalAmount : (isConsume ? r.cost : r.totalCost);
    const cls = isSale ? 'minus' : 'plus';
    const sign = isSale ? '+' : '-';
    let qtyLabel = String(r.quantity);
    if (isConsume) {
      if (r.weightQty != null && DB.toNumber(r.weightQty) > 0) qtyLabel = fmtNum(r.weightQty) + esc(r.specUnit || '克');
      else qtyLabel = String(r.quantity) + '件';
    }
    const action = isSale ? '卖出' : (isConsume ? '消耗' : '进货');
    let sub = action;
    if (isPurchase) sub += ' · ' + accountLabel(r.account);
    sub += ' · ' + esc(r.date);
    if (r.createdAt) sub += ' · ' + fmtDateTime(r.createdAt);
    if (r.note) sub += ' · ' + esc(r.note);
    return '<div class="list-item record-row">' +
      '<div class="main">' +
      '<div class="title">' + esc(r.productName) + ' ×' + qtyLabel + '</div>' +
      '<div class="sub">' + sub + '</div>' +
      '</div>' +
      '<div class="amount ' + cls + '">' + sign + '¥' + fmtMoney(amount) + '</div>' +
      '<button class="btn btn-danger" data-del-type="' + r.type + '" data-del-id="' + r.id + '" style="padding:6px 11px;font-size:13px">删</button>' +
      '</div>';
  }

  // 合并全部流水（卖货 / 进货 / 消耗），最新的在前
  async function getAllRecords() {
    const [sales, purchases, consumptions] = await Promise.all([DB.listSales(), DB.listPurchases(), DB.listConsumptions()]);
    return sales.map(function (s) { return Object.assign({}, s, { type: 'sale' }); })
      .concat(purchases.map(function (p) { return Object.assign({}, p, { type: 'purchase' }); }))
      .concat(consumptions.map(function (c) { return Object.assign({}, c, { type: 'consume' }); }))
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  // 给流水列表里的「删」按钮绑定撤销逻辑（删除记录 + 同步库存）
  function bindDeleteRecord(container, inModal) {
    container.querySelectorAll('[data-del-type]').forEach(function (b) {
      b.onclick = function () {
        const type = b.dataset.delType;
        const id = b.dataset.delId;
        const label = type === 'sale' ? '卖货' : (type === 'consume' ? '消耗' : '进货');
        const syncText = type === 'purchase' ? '进货会减回库存' : (type === 'sale' ? '卖货会加回库存' : '消耗会加回库存');
        showConfirm('删除这条「' + label + '」记录？' + syncText + '。', async function () {
          if (type === 'sale') await DB.deleteSale(id);
          else if (type === 'consume') await DB.deleteConsumption(id);
          else await DB.deletePurchase(id);
          toast('已删除');
          renderHome(); renderProducts(); renderStats();
          if (inModal) renderAllRecordsList();
        });
      };
    });
  }

  async function openAllRecords() {
    openModal(
      '<button class="modal-close" data-close>×</button>' +
      '<h3>全部流水</h3>' +
      '<div class="hint" style="margin-bottom:10px">点「删」可撤销该条（对应库存会自动同步）</div>' +
      '<div class="list" id="all-records-list"></div>'
    );
    await renderAllRecordsList();
  }

  async function renderAllRecordsList() {
    const listEl = document.getElementById('all-records-list');
    if (!listEl) return;
    const recs = await getAllRecords();
    listEl.innerHTML = recs.length ? recs.map(recordRow).join('') : '<div class="empty"><p>还没有流水</p></div>';
    bindDeleteRecord(listEl, true);
  }

  async function renderHome() {
    const el = document.getElementById('view-home');
    const date = reconcileDate || DB.todayStr();
    const [settlement, consumptions, adjustments, products] = await Promise.all([
      DB.getSettlement(date),
      DB.listConsumptions(),
      DB.listAdjustments(),
      DB.listProducts(),
    ]);
    const dayCons = consumptions.filter(function (c) { return c.date === date; });
    const usageByProduct = {};
    dayCons.forEach(function (c) {
      usageByProduct[c.productId] = DB.toNumber(usageByProduct[c.productId]) + DB.toNumber(c.quantity);
    });
    const dayAdj = adjustments.filter(function (a) { return a.date === date; });
    const hasMaterials = products.some(function (p) { return p.type === 'material'; });

    const cash = DB.toNumber(settlement && settlement.cashBack) - DB.toNumber(settlement && settlement.cashOut);
    const revenue = cash + DB.toNumber(settlement && settlement.wechat) + DB.toNumber(settlement && settlement.alipay);
    let cost = 0;
    dayCons.forEach(function (c) { cost += DB.toNumber(c.cost); });
    const profit = revenue - cost;

    el.innerHTML =
      '<div class="field" style="margin-bottom:12px"><label>核算日期</label><input type="date" id="rec-date" value="' + date + '"></div>' +

      '<div class="hero" style="margin-bottom:12px">' +
      '<div class="hero-label">' + date + ' · 利润核算</div>' +
      '<div class="hero-value">¥' + fmtMoney(profit) + '</div>' +
      '<div class="hero-sub">营业额 ¥' + fmtMoney(revenue) + ' − 成本 ¥' + fmtMoney(cost) + '</div>' +
      '</div>' +

      '<div class="card">' +
      '<div class="card-title">营业额（今天收了多少）</div>' +
      '<div class="field"><label>带出现金（出门带的钱）</label>' +
      '<div class="qty-toggle-row"><input id="rec-cashout" type="number" inputmode="decimal" step="0.01" min="0" value="' + valOrEmpty(settlement && settlement.cashOut) + '" placeholder="0">' +
      '<button class="btn btn-secondary" id="rec-save-cashout" type="button" style="flex:0 0 auto;padding:10px 14px">单独保存</button></div></div>' +
      '<div class="field-row">' +
      '<div class="field"><label>微信收款</label><input id="rec-wechat" type="number" inputmode="decimal" step="0.01" min="0" value="' + valOrEmpty(settlement && settlement.wechat) + '" placeholder="0"></div>' +
      '<div class="field"><label>支付宝收款</label><input id="rec-alipay" type="number" inputmode="decimal" step="0.01" min="0" value="' + valOrEmpty(settlement && settlement.alipay) + '" placeholder="0"></div>' +
      '</div>' +
      '<div class="field"><label>带回现金（收摊剩的钱）</label><input id="rec-cashback" type="number" inputmode="decimal" step="0.01" min="0" value="' + valOrEmpty(settlement && settlement.cashBack) + '" placeholder="0"></div>' +
      '<div class="field"><label>备注</label><input id="rec-note" value="' + esc(settlement ? settlement.note : '') + '" placeholder="选填"></div>' +
      '<button class="btn btn-primary btn-block" id="rec-save">保存营业额</button>' +
      '<div class="hint" style="margin-top:8px">现金收入 = 带回现金 − 带出现金</div>' +
      '<div id="rec-live-rev" style="margin-top:10px;padding:10px 12px;background:var(--brand-soft);border-radius:10px;font-size:14px;color:var(--ink-2)"></div>' +
      '</div>' +

      '<div class="card">' +
      '<div class="card-title">成本（今天用掉 / 卖掉的量）</div>' +
      '<div class="list" id="cost-fill-list">' +
      (products.length
        ? products.map(function (p) { return costFillRow(p, usageByProduct[p.id]); }).join('')
        : '<div class="empty"><p>还没有商品，先到「商品」添加</p></div>') +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="rec-save-cost" style="margin-top:10px">保存成本</button>' +
      '<div class="hint" style="margin-top:6px">填好数量点「保存」就固定住；之后要改直接点 − / ＋ 微调（会自动保存）。不填或填 0 表示今天没用。</div>' +
      (dayAdj.length
        ? '<div style="margin-top:8px"><div class="hint">盘点校正：</div>' + dayAdj.map(function (a) {
            const d = DB.toNumber(a.delta);
            const txt = (a.weightQty != null && DB.toNumber(a.weightQty) > 0) ? fmtNum(a.weightQty) + esc(a.specUnit || '克') : String(a.after) + '件';
            return '<div class="hint">' + esc(a.productName) + ' → 实际 ' + txt + '（' + (d >= 0 ? '+' : '') + fmtNum(d) + '件）</div>';
          }).join('') + '</div>'
        : '') +
      '<button class="btn btn-ghost btn-block" id="rec-adjust" style="margin-top:12px">⚖️ 盘点校正（改实际库存）</button>' +
      '</div>';

    el.querySelector('#rec-date').onchange = function (e) { reconcileDate = e.target.value; renderHome(); };

    function liveRev() {
      const cash = DB.toNumber(el.querySelector('#rec-cashback').value) - DB.toNumber(el.querySelector('#rec-cashout').value);
      const rev = cash + DB.toNumber(el.querySelector('#rec-wechat').value) + DB.toNumber(el.querySelector('#rec-alipay').value);
      el.querySelector('#rec-live-rev').textContent = '本日营业额：¥' + fmtMoney(rev) +
        '（微信 ¥' + fmtMoney(DB.toNumber(el.querySelector('#rec-wechat').value)) +
        ' · 支付宝 ¥' + fmtMoney(DB.toNumber(el.querySelector('#rec-alipay').value)) +
        ' · 现金 ¥' + fmtMoney(cash) + '）';
    }
    ['#rec-cashout', '#rec-cashback', '#rec-wechat', '#rec-alipay'].forEach(function (id) {
      el.querySelector(id).addEventListener('input', liveRev);
    });
    liveRev();

    el.querySelector('#rec-save').onclick = async function () {
      await DB.saveSettlement({
        date: date,
        cashOut: el.querySelector('#rec-cashout').value,
        cashBack: el.querySelector('#rec-cashback').value,
        wechat: el.querySelector('#rec-wechat').value,
        alipay: el.querySelector('#rec-alipay').value,
        note: el.querySelector('#rec-note').value,
      });
      toast('营业额已保存');
      renderHome();
    };

    // 带出现金可单独保存（早上先记带出，不用等其他几项）
    el.querySelector('#rec-save-cashout').onclick = async function () {
      await DB.saveSettlement({
        date: date,
        cashOut: el.querySelector('#rec-cashout').value,
        cashBack: settlement ? settlement.cashBack : '',
        wechat: settlement ? settlement.wechat : '',
        alipay: settlement ? settlement.alipay : '',
        note: settlement ? settlement.note : '',
      });
      toast('带出现金已保存');
      renderHome();
    };

    async function saveCostRow(row) {
      const val = DB.toNumber(row.querySelector('.cost-qty').value);
      await DB.setDailyConsumption({ productId: row.dataset.id, quantity: val, mode: row.dataset.mode, date: date });
    }
    async function rerenderKeepScroll() {
      const y = window.scrollY;
      await renderHome();
      window.scrollTo(0, y);
    }

    el.querySelector('#rec-save-cost').onclick = async function () {
      const rows = el.querySelectorAll('#cost-fill-list .cost-row');
      let errMsg = '';
      for (let i = 0; i < rows.length; i++) {
        try { await saveCostRow(rows[i]); } catch (err) { if (!errMsg) errMsg = err.message; }
      }
      if (errMsg) toast(errMsg);
      else toast('已保存成本');
      await rerenderKeepScroll();
    };

    el.querySelectorAll('#cost-fill-list .cost-row .cost-step').forEach(function (b) {
      b.onclick = async function () {
        const row = b.closest('.cost-row');
        const input = row.querySelector('.cost-qty');
        const step = parseInt(b.dataset.step, 10);
        const next = Math.max(0, DB.round2(DB.toNumber(input.value) + step));
        input.value = (next === 0 ? '' : String(next));
        try {
          await saveCostRow(row);
        } catch (err) { toast(err.message || '操作失败'); }
        await rerenderKeepScroll();
      };
    });

    el.querySelectorAll('#cost-fill-list .cost-row .mini-seg button').forEach(function (b) {
      b.onclick = function () {
        const row = b.closest('.cost-row');
        costRowModes[row.dataset.id] = b.dataset.u;
        rerenderKeepScroll();
      };
    });

    el.querySelectorAll('#cost-fill-list .cost-row .cost-qty').forEach(function (input) {
      input.addEventListener('input', function () { refreshCostRowView(input.closest('.cost-row')); });
    });

    el.querySelector('#rec-adjust').onclick = function () {
      if (!hasMaterials) { toast('请先添加原材料'); return; }
      openAdjustForm(null, date);
    };
  }

  // 成本栏：输入/加减后实时刷新该行的「金额」和「剩余库存」
  function refreshCostRowView(row) {
    const cost = DB.toNumber(row.dataset.cost);
    const spec = DB.toNumber(row.dataset.spec);
    const specUnit = row.dataset.specunit || '克';
    const remUnit = row.dataset.remunit || '件';
    const stock = DB.toNumber(row.dataset.stock);
    const savedUsed = DB.toNumber(row.dataset.used);
    const mode = row.dataset.mode;
    const raw = DB.toNumber(row.querySelector('.cost-qty').value);
    let pieces = (mode === 'weight' && spec > 0) ? raw / spec : raw;
    pieces = DB.round3(pieces);
    const amount = DB.round2(pieces * cost);
    const remaining = DB.round3(stock + savedUsed - pieces);
    const amtEl = row.querySelector('.cost-amt');
    if (amtEl) amtEl.textContent = raw > 0 ? '¥' + fmtMoney(amount) : '';
    const remEl = row.querySelector('.cost-remaining');
    if (remEl) {
      let txt = fmtNum(Math.max(0, remaining)) + ' ' + remUnit;
      if (spec > 0) txt += '（' + fmtNum(DB.round3(remaining * spec)) + specUnit + '）';
      remEl.textContent = txt;
    }
  }

  // ---------- 商品 ----------
  function stockBadge(p) {
    const emptyLabel = p.type === 'material' ? '已用完' : '已售罄';
    if (p.stock <= 0) return '<span class="badge out">' + emptyLabel + '</span>';
    if (p.alertThreshold !== null && p.alertThreshold !== undefined && p.stock <= alertThresholdPieces(p)) {
      return '<span class="badge low">不足</span>';
    }
    return '<span class="badge ok">正常</span>';
  }

  function productRow(p) {
    if (purchaseEditingId === p.id) return purchaseEditorRow(p);
    const isMaterial = p.type === 'material';
    const materialTag = isMaterial ? ' <span class="badge soon">原材料</span>' : '';
    const priceText = isMaterial
      ? '进¥' + fmtMoney(p.costPrice)
      : '进¥' + fmtMoney(p.costPrice) + ' 售¥' + fmtMoney(p.sellPrice);
    let stockText = '库存 <span class="stock-num">' + p.stock + '</span> ' + esc(p.unit || '件');
    if (isMaterial && DB.toNumber(p.spec) > 0) {
      stockText += ' · 共 ' + fmtNum(DB.toNumber(p.stock) * DB.toNumber(p.spec)) + esc(p.specUnit || '克');
    }
    const sellBtn = isMaterial ? '' : '<button class="btn btn-secondary" data-sale="' + p.id + '">卖</button>';
    const consumeBtn = isMaterial ? '<button class="btn btn-secondary" data-consume="' + p.id + '">用</button>' : '';
    return '<div class="list-item">' +
      '<div class="main" data-edit="' + p.id + '">' +
      '<div class="title">' + esc(p.name) + materialTag + ' ' + stockBadge(p) + '</div>' +
      '<div class="sub">' + stockText + ' · ' + priceText + '</div>' +
      '</div>' +
      '<div class="row-btns">' + sellBtn + consumeBtn +
      '<button class="btn btn-secondary" data-purchase="' + p.id + '">进</button>' +
      '</div></div>';
  }

  // 商品页内联进货：点「进」直接在这行改数量，不弹窗
  function purchaseEditorRow(p) {
    const unitCost = DB.toNumber(p.costPrice);
    const accountOpts =
      '<option value="cash">现金</option>' +
      '<option value="wechat">微信</option>' +
      '<option value="alipay">支付宝</option>';
    return '<div class="list-item purchase-editor" data-pid="' + p.id + '" data-cost="' + unitCost + '" style="flex-direction:column;align-items:stretch">' +
      '<div class="title">进货 · ' + esc(p.name) + ' <span class="badge soon">现有 ' + p.stock + ' ' + esc(p.unit || '件') + '</span></div>' +
      '<div class="cost-input-wrap" style="margin-top:10px">' +
      '<button type="button" class="cost-step" data-pstep="-1">−</button>' +
      '<input type="number" inputmode="decimal" step="1" min="1" class="cost-qty" data-pqty value="1">' +
      '<button type="button" class="cost-step" data-pstep="1">＋</button>' +
      '<span class="cost-unit">' + esc(p.unit || '件') + '</span>' +
      '</div>' +
      '<div class="field-row" style="margin-top:10px">' +
      '<div class="field" style="margin-bottom:0"><label>使用账户</label><select data-paccount>' + accountOpts + '</select></div>' +
      '<div class="field" style="margin-bottom:0"><label>总金额（元）</label><input type="number" inputmode="decimal" step="0.01" min="0" data-ptotal value="' + (unitCost || '') + '"></div>' +
      '</div>' +
      '<div class="field-row" style="margin-top:12px">' +
      '<button class="btn btn-primary btn-block" data-pok>进货</button>' +
      '<button class="btn btn-ghost btn-block" data-pcancel>取消</button>' +
      '</div>' +
      '</div>';
  }

  async function renderProducts() {
    const el = document.getElementById('view-products');
    const products = await DB.listProducts();
    const list = productSearch ? products.filter(function (p) { return (p.name || '').indexOf(productSearch) !== -1; }) : products;

    // 库存预警 + 最近流水（只在没搜索时显示在商品页下方）
    let extrasHtml = '';
    if (!productSearch) {
      const [preds, sales, purchases, consumptions] = await Promise.all([
        DB.computePredictions(14),
        DB.listSales(),
        DB.listPurchases(),
        DB.listConsumptions(),
      ]);
      const alerts = preds.filter(function (p) { return p.status !== 'ok'; })
        .sort(function (a, b) {
          return (rankStatus(a.status) - rankStatus(b.status)) || ((a.daysLeft === null ? 999 : a.daysLeft) - (b.daysLeft === null ? 999 : b.daysLeft));
        });
      const recents = sales.map(function (s) { return Object.assign({}, s, { type: 'sale' }); })
        .concat(purchases.map(function (p) { return Object.assign({}, p, { type: 'purchase' }); }))
        .concat(consumptions.map(function (c) { return Object.assign({}, c, { type: 'consume' }); }))
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })
        .slice(0, 6);
      extrasHtml =
        '<div class="section-head" style="margin-top:4px"><span class="t">库存预警</span><span class="badge ' + (alerts.length ? 'out' : 'ok') + '">' + alerts.length + ' 项</span></div>' +
        (alerts.length
          ? '<div class="list">' + alerts.slice(0, 8).map(alertRow).join('') + '</div>'
          : '<div class="card"><div class="empty"><p>暂无库存预警 🎉</p></div></div>') +
        '<div class="section-head" style="margin-top:16px"><span class="t">最近流水</span><button class="more" id="qa-all-records">查看全部</button></div>' +
        (recents.length
          ? '<div class="list">' + recents.map(recordRow).join('') + '</div>'
          : '<div class="card"><div class="empty"><p>还没有流水</p></div></div>');
    }

    el.innerHTML =
      '<div class="field" style="margin-bottom:10px"><input id="product-search" type="search" placeholder="搜索商品名称" value="' + esc(productSearch) + '"></div>' +
      (list.length
        ? '<div class="list">' + list.map(productRow).join('') + '</div>'
        : '<div class="card"><div class="empty"><div class="empty-ico">📦</div><p>' + (products.length ? '没有找到匹配的商品' : '还没有商品，点下方按钮添加') + '</p></div></div>') +
      '<button class="btn btn-primary btn-block btn-lg" id="add-product" style="margin-top:12px">＋ 新增商品</button>' +
      extrasHtml;

    const searchEl = el.querySelector('#product-search');
    searchEl.addEventListener('input', function (e) {
      productSearch = e.target.value;
      renderProducts();
      const s = document.getElementById('product-search');
      if (s) { s.focus(); const len = s.value.length; s.setSelectionRange(len, len); }
    });
    el.querySelector('#add-product').onclick = function () { openProductForm(null); };
    el.querySelectorAll('[data-edit]').forEach(function (r) {
      r.onclick = function () { openProductFormById(r.dataset.edit); };
    });
    el.querySelectorAll('[data-sale]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openSaleForm(b.dataset.sale); };
    });
    el.querySelectorAll('[data-purchase]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); purchaseEditingId = b.dataset.purchase; renderProducts(); };
    });
    el.querySelectorAll('[data-consume]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openConsumeForm(b.dataset.consume); };
    });

    // 内联进货编辑器
    const editor = el.querySelector('.purchase-editor');
    if (editor) {
      const pid = editor.dataset.pid;
      const unitCost = DB.toNumber(editor.dataset.cost);
      const qty = editor.querySelector('[data-pqty]');
      const total = editor.querySelector('[data-ptotal]');
      function syncTotal() {
        if (total.dataset.edited !== '1') total.value = DB.round2(DB.toNumber(qty.value) * unitCost);
      }
      editor.querySelectorAll('[data-pstep]').forEach(function (b) {
        b.onclick = function () {
          const step = parseInt(b.dataset.pstep, 10);
          qty.value = String(Math.max(1, DB.toNumber(qty.value) + step));
          syncTotal();
        };
      });
      qty.addEventListener('input', syncTotal);
      total.addEventListener('input', function () { total.dataset.edited = '1'; });
      editor.querySelector('[data-pok]').onclick = async function () {
        try {
          await DB.addPurchase({ productId: pid, quantity: qty.value, totalCost: total.value, account: editor.querySelector('[data-paccount]').value, date: DB.todayStr(), note: '' });
          purchaseEditingId = null;
          toast('已进货');
          renderProducts(); renderHome(); renderStats();
        } catch (err) { toast(err.message || '操作失败'); }
      };
      editor.querySelector('[data-pcancel]').onclick = function () {
        purchaseEditingId = null; renderProducts();
      };
    }

    if (!productSearch) {
      const qa = el.querySelector('#qa-all-records');
      if (qa) qa.onclick = function () { openAllRecords(); };
      el.querySelectorAll('[data-alert-product]').forEach(function (r) {
        r.onclick = function () { openProductFormById(r.dataset.alertProduct); };
      });
      bindDeleteRecord(el, false);
    }
  }

  async function openProductFormById(id) {
    const p = await DB.getProduct(id);
    if (p) openProductForm(p);
  }

  function valOrEmpty(v) { return (v === null || v === undefined || v === '') ? '' : v; }

  function openProductForm(product) {
    const isEdit = !!product;
    let curType = product && product.type === 'material' ? 'material' : 'sellable';

    const curUnit = product ? (product.unit || '') : '';
    const unitIsCustom = curUnit && UNITS.indexOf(curUnit) === -1;
    const unitOptions = '<option value="">默认（件）</option>' +
      UNITS.map(function (u) { return '<option value="' + u + '"' + (curUnit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') +
      '<option value="__custom__"' + (unitIsCustom ? ' selected' : '') + '>其他…</option>';

    const curSpecUnit = product ? (product.specUnit || '克') : '克';
    const specUnitOptions = SPEC_UNITS.map(function (u) { return '<option value="' + u + '"' + (curSpecUnit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('');
    const curAlertUnit = (product && product.alertUnit === 'weight') ? 'weight' : 'piece';

    openModal(
      '<button class="modal-close" data-close>×</button>' +
      '<h3>' + (isEdit ? '编辑商品' : '新增商品') + '</h3>' +
      '<form id="product-form">' +
      '<div class="field"><label>名称 *</label><input name="name" required value="' + esc(product ? product.name : '') + '" placeholder="如：烤肠"></div>' +
      '<div class="field"><label>类型</label>' +
      '<div class="segmented" id="type-seg" style="margin:0">' +
      '<button type="button" data-t="sellable" class="' + (curType === 'sellable' ? 'active' : '') + '">成品（有售价）</button>' +
      '<button type="button" data-t="material" class="' + (curType === 'material' ? 'active' : '') + '">原材料（无售价）</button>' +
      '</div></div>' +
      '<div class="field-row">' +
      '<div class="field"><label>进价（元）</label><input name="costPrice" type="number" inputmode="decimal" step="0.01" min="0" value="' + valOrEmpty(product ? product.costPrice : '') + '"></div>' +
      '<div class="field" id="sell-price-field"><label>售价（元）</label><input name="sellPrice" type="number" inputmode="decimal" step="0.01" min="0" value="' + valOrEmpty(product ? product.sellPrice : '') + '"></div>' +
      '</div>' +
      '<div class="field-row">' +
      '<div class="field"><label>单位</label><select name="unit" id="unit-select">' + unitOptions + '</select>' +
      '<div id="unit-custom-wrap" class="hidden" style="margin-top:6px"><input name="unitCustom" id="unit-custom" value="' + esc(unitIsCustom ? curUnit : '') + '" placeholder="自定义单位"></div></div>' +
      '<div class="field"><label>库存预警线</label>' +
      '<div class="qty-toggle-row">' +
      '<input name="alertThreshold" id="alert-threshold" type="number" inputmode="decimal" step="0.001" min="0" value="' + valOrEmpty(product && product.alertThreshold !== null ? product.alertThreshold : '') + '" placeholder="低于此数提醒">' +
      '<select name="alertUnit" id="alert-unit" style="flex:0 0 auto;width:auto">' +
      '<option value="piece"' + (curAlertUnit === 'piece' ? ' selected' : '') + '>件</option>' +
      '<option value="weight"' + (curAlertUnit === 'weight' ? ' selected' : '') + '>按重量</option>' +
      '</select></div></div>' +
      '</div>' +
      '<div class="field-row" id="spec-field">' +
      '<div class="field"><label>规格（每件重量）</label><input name="spec" type="number" inputmode="decimal" step="0.001" min="0" value="' + valOrEmpty(product && product.spec) + '" placeholder="如 250"></div>' +
      '<div class="field"><label>规格单位</label><select name="specUnit">' + specUnitOptions + '</select></div>' +
      '</div>' +
      (isEdit ? '' : '<div class="field"><label>初始库存</label><input name="initStock" type="number" inputmode="numeric" min="0" value="0"><div class="hint">填了初始库存会自动记一条进货</div></div>') +
      '<button class="btn btn-primary btn-block btn-lg" type="submit">保存</button>' +
      (isEdit ? '<button class="btn btn-danger btn-block" type="button" id="del-product" style="margin-top:10px">删除该商品</button>' : '') +
      '</form>'
    );

    function refreshTypeUI() {
      document.querySelectorAll('#type-seg button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.t === curType);
      });
      document.getElementById('sell-price-field').classList.toggle('hidden', curType === 'material');
      document.getElementById('spec-field').classList.toggle('hidden', curType !== 'material');
      refreshAlertUnit();
    }
    document.querySelectorAll('#type-seg button').forEach(function (b) {
      b.onclick = function () { curType = b.dataset.t; refreshTypeUI(); };
    });

    const unitSel = document.getElementById('unit-select');
    const unitCustomWrap = document.getElementById('unit-custom-wrap');
    function refreshUnit() {
      const custom = unitSel.value === '__custom__';
      unitCustomWrap.classList.toggle('hidden', !custom);
      if (custom) document.getElementById('unit-custom').focus();
    }
    unitSel.onchange = refreshUnit;

    const alertUnitSel = document.getElementById('alert-unit');
    const specInput = document.querySelector('input[name="spec"]');
    const specUnitSel = document.querySelector('select[name="specUnit"]');
    function refreshAlertUnit() {
      const specVal = DB.toNumber(specInput.value);
      const specUnit = specUnitSel.value || '克';
      const weightOpt = alertUnitSel.querySelector('option[value="weight"]');
      const canWeight = curType === 'material' && specVal > 0;
      weightOpt.disabled = !canWeight;
      weightOpt.textContent = '按' + specUnit;
      if (!canWeight && alertUnitSel.value === 'weight') alertUnitSel.value = 'piece';
    }
    specInput.addEventListener('input', refreshAlertUnit);
    specUnitSel.addEventListener('change', refreshAlertUnit);

    refreshTypeUI();
    refreshUnit();

    document.getElementById('product-form').onsubmit = async function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('请填写商品名称'); return; }
      let unit = String(fd.get('unit') || '').trim();
      if (unit === '__custom__') unit = String(fd.get('unitCustom') || '').trim();
      const p = {
        id: product ? product.id : undefined,
        name: name,
        type: curType,
        costPrice: fd.get('costPrice'),
        sellPrice: curType === 'material' ? (product ? product.sellPrice : 0) : fd.get('sellPrice'),
        unit: unit,
        alertThreshold: fd.get('alertThreshold'),
        alertUnit: fd.get('alertUnit'),
        spec: fd.get('spec'),
        specUnit: fd.get('specUnit'),
      };
      if (product) p.stock = product.stock;
      await DB.saveProduct(p);
      if (!product && DB.toNumber(fd.get('initStock')) > 0) {
        await DB.addPurchase({
          productId: p.id,
          quantity: fd.get('initStock'),
          totalCost: DB.toNumber(fd.get('initStock')) * DB.toNumber(fd.get('costPrice')),
          date: DB.todayStr(),
          note: '初始库存',
        });
      }
      closeModal();
      toast('已保存');
      renderProducts();
      renderHome();
    };

    if (isEdit) {
      document.getElementById('del-product').onclick = function () {
        showConfirm('删除后商品从列表移除，历史流水仍会保留当时的名称和价格。确定删除「' + product.name + '」吗？', async function () {
          await DB.deleteProduct(product.id);
          closeModal();
          toast('已删除');
          renderProducts();
          renderHome();
        });
      };
    }
  }

  // ---------- 卖货 / 进货 ----------
  async function openSaleForm(presetProductId) {
    const allProducts = await DB.listProducts();
    const products = allProducts.filter(function (p) { return p.type !== 'material'; });
    if (!products.length) {
      toast('请先添加成品（可售）商品');
      openProductForm(null);
      return;
    }
    const options = products.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === presetProductId ? ' selected' : '') + '>' + esc(p.name) + '（库存 ' + p.stock + '）</option>';
    }).join('');
    openModal(
      '<button class="modal-close" data-close>×</button>' +
      '<h3>记一笔（卖货）</h3>' +
      '<form id="sale-form">' +
      '<div class="field"><label>商品 *</label><select name="productId" id="sale-product">' + options + '</select></div>' +
      '<div class="field-row">' +
      '<div class="field"><label>数量 *</label><input name="quantity" type="number" inputmode="numeric" min="1" step="1" required value="1"></div>' +
      '<div class="field"><label>单价（元）</label><input name="unitPrice" id="sale-price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="默认售价"></div>' +
      '</div>' +
      '<div class="field"><label>日期</label><input name="date" type="date" value="' + DB.todayStr() + '"></div>' +
      '<div class="field"><label>备注</label><input name="note" placeholder="选填"></div>' +
      '<div id="sale-total" style="text-align:right;font-size:18px;font-weight:700;margin-bottom:12px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" type="submit">记一笔</button>' +
      '</form>'
    );

    const form = document.getElementById('sale-form');
    const sel = form.elements.productId;
    const qty = form.elements.quantity;
    const price = form.elements.unitPrice;
    const totalEl = document.getElementById('sale-total');
    function currentProduct() { return products.find(function (p) { return p.id === sel.value; }); }
    function refresh() {
      const p = currentProduct();
      if (!p) return;
      if (price.dataset.userEdited !== '1') price.value = p.sellPrice;
      const q = DB.toNumber(qty.value);
      const pr = DB.toNumber(price.value);
      totalEl.textContent = '合计：¥' + fmtMoney(q * pr);
    }
    sel.onchange = function () { price.dataset.userEdited = ''; refresh(); };
    qty.oninput = refresh;
    price.oninput = function () { price.dataset.userEdited = '1'; refresh(); };
    refresh();

    form.onsubmit = async function (e) {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await DB.addSale({
          productId: fd.get('productId'),
          quantity: fd.get('quantity'),
          unitPrice: fd.get('unitPrice'),
          date: fd.get('date'),
          note: fd.get('note'),
        });
        closeModal();
        toast('已记一笔');
        renderHome(); renderProducts(); renderStats();
      } catch (err) { toast(err.message || '操作失败'); }
    };
  }

  async function openConsumeForm(presetProductId, presetDate) {
    const allProducts = await DB.listProducts();
    const materials = allProducts.filter(function (p) { return p.type === 'material'; });
    if (!materials.length) {
      toast('请先添加原材料（如奶酪、水果）');
      openProductForm(null);
      return;
    }
    const options = materials.map(function (p) {
      const specText = DB.toNumber(p.spec) > 0 ? ' · ' + p.spec + (p.specUnit || '克') + '/件' : '';
      return '<option value="' + p.id + '"' + (p.id === presetProductId ? ' selected' : '') + '>' + esc(p.name) + '（库存 ' + p.stock + ' 件' + specText + '）</option>';
    }).join('');
    openModal(
      '<button class="modal-close" data-close>×</button>' +
      '<h3>消耗（领用原材料）</h3>' +
      '<form id="consume-form">' +
      '<div class="field"><label>原材料 *</label><select name="productId" id="consume-product">' + options + '</select></div>' +
      '<div class="field"><label id="consume-qty-label">用量（件）*</label>' +
      '<div class="qty-toggle-row">' +
      '<input name="quantity" id="consume-qty" type="number" inputmode="decimal" step="0.001" min="0" required value="1">' +
      '<div class="mini-seg" id="consume-mode" style="margin:0">' +
      '<button type="button" data-mode="piece" class="active">件</button>' +
      '<button type="button" data-mode="weight">克</button>' +
      '</div></div>' +
      '<div class="hint">按进价自动算成本</div></div>' +
      '<div class="field"><label>日期</label><input name="date" type="date" value="' + (presetDate || DB.todayStr()) + '"></div>' +
      '<div class="field"><label>备注</label><input name="note" placeholder="选填"></div>' +
      '<div id="consume-cost" style="text-align:right;font-size:18px;font-weight:700;margin-bottom:12px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" type="submit">记录消耗</button>' +
      '</form>'
    );

    const form = document.getElementById('consume-form');
    const sel = form.elements.productId;
    const qty = form.elements.quantity;
    const costEl = document.getElementById('consume-cost');
    const modeSeg = document.getElementById('consume-mode');
    const qtyLabel = document.getElementById('consume-qty-label');
    const modeBtns = modeSeg.querySelectorAll('button[data-mode]');
    let curMode = 'piece';
    function currentMaterial() { return materials.find(function (p) { return p.id === sel.value; }); }
    function refresh() {
      const m = currentMaterial();
      if (!m) return;
      const spec = DB.toNumber(m.spec);
      const specUnit = m.specUnit || '克';
      const hasSpec = spec > 0;
      modeSeg.classList.toggle('hidden', !hasSpec);
      if (!hasSpec) curMode = 'piece';
      const weightBtn = modeSeg.querySelector('button[data-mode="weight"]');
      if (weightBtn) weightBtn.textContent = specUnit;
      modeBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.mode === curMode); });
      const q = DB.toNumber(qty.value);
      let cost;
      if (curMode === 'weight' && hasSpec) {
        qtyLabel.textContent = '用量（' + specUnit + '）*';
        cost = q / spec * DB.toNumber(m.costPrice);
      } else {
        qtyLabel.textContent = '用量（件）*';
        cost = q * DB.toNumber(m.costPrice);
      }
      costEl.textContent = '本次成本：¥' + fmtMoney(cost);
    }
    modeBtns.forEach(function (b) {
      b.onclick = function () { curMode = b.dataset.mode; refresh(); };
    });
    sel.onchange = refresh;
    qty.oninput = refresh;
    refresh();

    form.onsubmit = async function (e) {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await DB.addConsumption({
          productId: fd.get('productId'),
          quantity: fd.get('quantity'),
          mode: curMode,
          date: fd.get('date'),
          note: fd.get('note'),
        });
        closeModal();
        toast('已记录消耗');
        renderHome(); renderProducts(); renderStats();
      } catch (err) { toast(err.message || '操作失败'); }
    };
  }

  function costFillRow(p, usagePieces) {
    const isMat = p.type === 'material';
    const spec = DB.toNumber(p.spec);
    const specUnit = p.specUnit || '克';
    const hasSpec = isMat && spec > 0;
    const mode = costRowModes[p.id] || (hasSpec ? 'weight' : 'piece');
    const displayUnit = hasSpec ? (mode === 'weight' ? specUnit : '件') : (p.unit || '件');
    const remUnit = hasSpec ? '件' : (p.unit || '件');
    const used = DB.toNumber(usagePieces);          // 今天已保存的用量（件）
    const unitCost = DB.toNumber(p.costPrice);
    const amount = DB.round2(used * unitCost);       // 这件商品今天的成本金额
    const remaining = DB.toNumber(p.stock);          // 当前库存（已扣掉今天用量）
    const tag = isMat ? '' : ' <span class="badge ok" style="font-size:11px;padding:1px 6px">成品</span>';
    const specHint = hasSpec ? ' <span style="font-size:12px;color:var(--ink-3)">' + p.spec + specUnit + '/件</span>' : '';
    const toggle = hasSpec
      ? '<div class="mini-seg">' +
        '<button type="button" data-u="weight" class="' + (mode === 'weight' ? 'active' : '') + '">' + esc(specUnit) + '</button>' +
        '<button type="button" data-u="piece" class="' + (mode === 'piece' ? 'active' : '') + '">件</button>' +
        '</div>'
      : '';
    let remText = fmtNum(remaining) + ' ' + remUnit;
    if (hasSpec) remText += '（' + fmtNum(DB.round3(remaining * spec)) + specUnit + '）';
    let displayVal = '';
    if (used > 0) displayVal = (hasSpec && mode === 'weight') ? DB.round3(used * spec) : used;
    return '<div class="list-item cost-row" data-id="' + p.id + '" data-mode="' + mode + '"' +
      ' data-cost="' + unitCost + '" data-spec="' + spec + '" data-specunit="' + esc(specUnit) + '" data-remunit="' + esc(remUnit) + '"' +
      ' data-stock="' + remaining + '" data-used="' + used + '">' +
      '<div class="main">' +
      '<div class="title">' + esc(p.name) + tag + specHint + '</div>' +
      '<div class="sub">进¥' + fmtMoney(unitCost) + ' · 剩 <span class="stock-num cost-remaining">' + remText + '</span></div>' +
      toggle +
      '</div>' +
      '<div class="cost-side">' +
      '<div class="cost-input-wrap">' +
      '<button type="button" class="cost-step" data-step="-1">−</button>' +
      '<input type="number" inputmode="decimal" step="0.001" min="0" placeholder="0" class="cost-qty" value="' + displayVal + '">' +
      '<button type="button" class="cost-step" data-step="1">＋</button>' +
      '<span class="cost-unit">' + esc(displayUnit) + '</span>' +
      '</div>' +
      '<div class="cost-amt">' + (used > 0 ? '¥' + fmtMoney(amount) : '') + '</div>' +
      '</div>' +
      '</div>';
  }

  // （每日利润核算已并入首页 renderHome）

  async function openAdjustForm(presetProductId, presetDate) {
    const allProducts = await DB.listProducts();
    const materials = allProducts.filter(function (p) { return p.type === 'material'; });
    if (!materials.length) { toast('请先添加原材料'); openProductForm(null); return; }
    const options = materials.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === presetProductId ? ' selected' : '') + '>' + esc(p.name) + '（当前库存 ' + p.stock + ' 件）</option>';
    }).join('');
    openModal(
      '<button class="modal-close" data-close>×</button>' +
      '<h3>盘点校正（改实际剩余）</h3>' +
      '<form id="adjust-form">' +
      '<div class="field"><label>原材料 *</label><select name="productId" id="adjust-product">' + options + '</select></div>' +
      '<div class="field" id="adjust-mode-wrap" style="margin-bottom:12px"><label>按什么填</label>' +
      '<div class="segmented" style="margin:0">' +
      '<button type="button" data-mode="piece" class="active">按件</button>' +
      '<button type="button" data-mode="weight">按克</button>' +
      '</div></div>' +
      '<div class="field"><label id="adjust-qty-label">实际剩余（件）*</label><input name="actualQty" id="adjust-qty" type="number" inputmode="decimal" step="0.001" min="0" required></div>' +
      '<div class="field"><label>日期</label><input name="date" type="date" value="' + (presetDate || DB.todayStr()) + '"></div>' +
      '<div class="field"><label>备注</label><input name="note" placeholder="如：称重校正"></div>' +
      '<div class="hint" style="margin-bottom:12px">只改库存数字，不会计入当天成本</div>' +
      '<button class="btn btn-primary btn-block btn-lg" type="submit">保存校正</button>' +
      '</form>'
    );

    const form = document.getElementById('adjust-form');
    const sel = form.elements.productId;
    const qty = form.elements.actualQty;
    const modeWrap = document.getElementById('adjust-mode-wrap');
    const qtyLabel = document.getElementById('adjust-qty-label');
    const modeBtns = modeWrap.querySelectorAll('button[data-mode]');
    let curMode = 'piece';
    function currentMaterial() { return materials.find(function (p) { return p.id === sel.value; }); }
    function refresh() {
      const m = currentMaterial();
      const spec = DB.toNumber(m.spec);
      const specUnit = m.specUnit || '克';
      const hasSpec = spec > 0;
      modeWrap.classList.toggle('hidden', !hasSpec);
      if (!hasSpec) curMode = 'piece';
      const wb = modeWrap.querySelector('button[data-mode="weight"]');
      if (wb) wb.textContent = '按' + specUnit;
      modeBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.mode === curMode); });
      qtyLabel.textContent = (curMode === 'weight' && hasSpec) ? '实际剩余（' + specUnit + '）*' : '实际剩余（件）*';
    }
    modeBtns.forEach(function (b) { b.onclick = function () { curMode = b.dataset.mode; refresh(); }; });
    sel.onchange = refresh;
    refresh();

    form.onsubmit = async function (e) {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await DB.adjustStock({
          productId: fd.get('productId'),
          actualQty: fd.get('actualQty'),
          mode: curMode,
          date: fd.get('date'),
          note: fd.get('note'),
        });
        closeModal();
        toast('已校正库存');
        renderHome(); renderProducts();
      } catch (err) { toast(err.message || '操作失败'); }
    };
  }

  // ---------- 钱包 / 资金记录 ----------
  function fundRow(f) {
    const pos = DB.toNumber(f.amount) >= 0;
    const cls = pos ? 'minus' : 'plus';
    const sign = pos ? '+' : '-';
    const cat = f.category === 'purchase' ? '进货支出' : (f.category === 'settlement' ? '收款收入' : '手动记账');
    return '<div class="list-item record-row">' +
      '<div class="main">' +
      '<div class="title">' + accountLabel(f.account) + ' · ' + esc(f.note || cat) + '</div>' +
      '<div class="sub">' + cat + ' · ' + esc(f.date) + ' · ' + fmtDateTime(f.createdAt) + '</div>' +
      '</div>' +
      '<div class="amount ' + cls + '">' + sign + '¥' + fmtMoney(Math.abs(DB.toNumber(f.amount))) + '</div>' +
      '</div>';
  }

  async function renderWallet() {
    const el = document.getElementById('view-wallet');
    const funds = await DB.listFunds();
    const bal = { cash: 0, wechat: 0, alipay: 0 };
    funds.forEach(function (f) { bal[f.account] = DB.round2(DB.toNumber(bal[f.account]) + DB.toNumber(f.amount)); });
    const total = DB.round2(DB.toNumber(bal.cash) + DB.toNumber(bal.wechat) + DB.toNumber(bal.alipay));

    el.innerHTML =
      '<div class="card">' +
      '<div class="card-title">三个账户的余额</div>' +
      '<div class="stat-grid" style="margin-bottom:10px">' +
      '<div class="stat-tile"><div class="stat-label">现金</div><div class="stat-value">¥' + fmtMoney(bal.cash) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">微信</div><div class="stat-value">¥' + fmtMoney(bal.wechat) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">支付宝</div><div class="stat-value">¥' + fmtMoney(bal.alipay) + '</div></div>' +
      '</div>' +
      '<div class="hero" style="margin-bottom:10px">' +
      '<div class="hero-label">三账户汇总（现金 + 微信 + 支付宝）</div>' +
      '<div class="hero-value">¥' + fmtMoney(total) + '</div>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">余额 = 收款收入 − 进货支出 + 手动记的账。每天的带出现金 / 带回现金会算进「现金」账户。</div>' +
      '<button class="btn btn-primary btn-block" id="fund-add" style="margin-top:10px">＋ 记一笔</button>' +
      '</div>' +
      '<div class="section-head" style="margin-top:4px"><span class="t">资金流水</span></div>' +
      (funds.length
        ? '<div class="list">' + funds.map(fundRow).join('') + '</div>'
        : '<div class="card"><div class="empty"><p>还没有资金记录</p></div></div>');

    el.querySelector('#fund-add').onclick = function () { openFundForm(); };
  }

  function openFundForm() {
    openModal(
      '<button class="modal-close" data-close>×</button>' +
      '<h3>记一笔（钱包）</h3>' +
      '<form id="fund-form">' +
      '<div class="field"><label>账户</label>' +
      '<div class="segmented" id="fund-acct-seg" style="margin:0">' +
      '<button type="button" data-a="cash" class="active">现金</button>' +
      '<button type="button" data-a="wechat">微信</button>' +
      '<button type="button" data-a="alipay">支付宝</button>' +
      '</div></div>' +
      '<div class="field"><label>类型</label>' +
      '<div class="segmented" id="fund-type-seg" style="margin:0">' +
      '<button type="button" data-t="in" class="active">收入</button>' +
      '<button type="button" data-t="out">支出</button>' +
      '</div></div>' +
      '<div class="field"><label>金额（元）*</label><input name="amount" type="number" inputmode="decimal" step="0.01" min="0" required placeholder="0"></div>' +
      '<div class="field"><label>备注</label><input name="note" placeholder="如：初始现金 / 买包装盒"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" type="submit">保存</button>' +
      '</form>'
    );

    let acct = 'cash';
    let dir = 'in';
    document.querySelectorAll('#fund-acct-seg button').forEach(function (b) {
      b.onclick = function () {
        acct = b.dataset.a;
        document.querySelectorAll('#fund-acct-seg button').forEach(function (x) { x.classList.toggle('active', x === b); });
      };
    });
    document.querySelectorAll('#fund-type-seg button').forEach(function (b) {
      b.onclick = function () {
        dir = b.dataset.t;
        document.querySelectorAll('#fund-type-seg button').forEach(function (x) { x.classList.toggle('active', x === b); });
      };
    });

    document.getElementById('fund-form').onsubmit = async function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amt = DB.toNumber(fd.get('amount'));
      try {
        await DB.addFund({
          account: acct,
          amount: dir === 'out' ? -amt : amt,
          note: fd.get('note') || (dir === 'out' ? '支出' : '收入'),
          date: DB.todayStr(),
        });
      } catch (err) { toast(err.message || '操作失败'); return; }
      closeModal();
      toast('已记录');
      renderWallet();
    };
  }

  // ---------- 统计 ----------
  function periodRange(p) {
    const today = DB.startOfDay(new Date());
    if (p === 'today') return { start: today, end: today };
    if (p === 'month') return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
    const days = parseInt(p, 10);
    return { start: DB.addDays(today, -(days - 1)), end: today };
  }
  function periodLabel(p) {
    if (p === 'today') return '今天';
    if (p === '7') return '近 7 天';
    if (p === '30') return '近 30 天';
    return '本月';
  }

  async function renderStats() {
    const el = document.getElementById('view-stats');
    const [sales, consumptions, settlements] = await Promise.all([
      DB.listSales(), DB.listConsumptions(), DB.listSettlements(),
    ]);
    const range = periodRange(statsPeriod);
    const inRange = function (dateStr) {
      const d = DB.parseDateStr(dateStr);
      return d && d >= range.start && d <= range.end;
    };

    let revenue = 0, cost = 0;
    const byDay = {};

    // 营业额来自「核算」：现金(带回-带出) + 微信 + 支付宝
    settlements.forEach(function (st) {
      if (!inRange(st.date)) return;
      const cash = DB.toNumber(st.cashBack) - DB.toNumber(st.cashOut);
      const rev = cash + DB.toNumber(st.wechat) + DB.toNumber(st.alipay);
      revenue += rev;
      byDay[st.date] = byDay[st.date] || { revenue: 0, cost: 0 };
      byDay[st.date].revenue += rev;
    });

    // 成本来自消耗/领用（含原材料和成品）
    consumptions.forEach(function (c) {
      if (!inRange(c.date)) return;
      const cc = DB.toNumber(c.cost);
      cost += cc;
      byDay[c.date] = byDay[c.date] || { revenue: 0, cost: 0 };
      byDay[c.date].cost += cc;
    });

    // 卖得最好：仍按「卖货」记录统计
    const byProduct = {};
    sales.forEach(function (s) {
      if (!inRange(s.date)) return;
      byProduct[s.productId] = byProduct[s.productId] || { name: s.productName, revenue: 0, qty: 0 };
      byProduct[s.productId].revenue += DB.toNumber(s.totalAmount);
      byProduct[s.productId].qty += DB.toNumber(s.quantity);
    });

    const profit = revenue - cost;

    const daysArr = [];
    let d = new Date(range.start);
    while (d <= range.end) {
      const ds = DB.localDateStr(d);
      const agg = byDay[ds] || { revenue: 0, cost: 0 };
      daysArr.push({ date: ds, label: (d.getMonth() + 1) + '/' + d.getDate(), revenue: agg.revenue, cost: agg.cost, profit: agg.revenue - agg.cost });
      d = DB.addDays(d, 1);
    }
    statsDays = daysArr;
    if (statsSelected < 0 || statsSelected >= daysArr.length) statsSelected = daysArr.length - 1;

    const topProducts = Object.keys(byProduct).map(function (k) { return byProduct[k]; })
      .sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 6);
    const maxTop = topProducts.length ? topProducts[0].revenue : 0;

    el.innerHTML =
      '<div class="segmented" id="stats-period">' +
      '<button data-p="today" class="' + (statsPeriod === 'today' ? 'active' : '') + '">今天</button>' +
      '<button data-p="7" class="' + (statsPeriod === '7' ? 'active' : '') + '">近7天</button>' +
      '<button data-p="30" class="' + (statsPeriod === '30' ? 'active' : '') + '">近30天</button>' +
      '<button data-p="month" class="' + (statsPeriod === 'month' ? 'active' : '') + '">本月</button>' +
      '</div>' +
      '<div class="hero">' +
      '<div class="hero-label">' + periodLabel(statsPeriod) + ' · 营业额（核算）</div>' +
      '<div class="hero-value">¥' + fmtMoney(revenue) + '</div>' +
      '<div class="hero-sub">营业额 ¥' + fmtMoney(revenue) + ' − 成本 ¥' + fmtMoney(cost) + ' · 利润 <strong style="color:' + (profit >= 0 ? 'var(--good)' : 'var(--danger)') + '">¥' + fmtMoney(profit) + '</strong></div>' +
      '</div>' +
      '<div class="stat-grid">' +
      '<div class="stat-tile"><div class="stat-label">营业额</div><div class="stat-value">¥' + fmtMoney(revenue) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">成本</div><div class="stat-value">¥' + fmtMoney(cost) + '</div></div>' +
      '<div class="stat-tile"><div class="stat-label">利润</div><div class="stat-value ' + (profit >= 0 ? 'good' : 'bad') + '">¥' + fmtMoney(profit) + '</div></div>' +
      '</div>' +
      '<div class="card chart-card">' +
      '<div class="card-title">每日营业额</div>' +
      '<div id="chart-box"></div>' +
      '<div style="text-align:center;font-size:12px;color:var(--ink-3);margin-top:4px">点柱子看当天详情</div>' +
      '</div>' +
      '<div class="card">' +
      '<div class="card-title">每日明细</div>' +
      buildDailyTable(daysArr) +
      '</div>' +
      '<div class="card">' +
      '<div class="card-title">卖得最好的商品（按「卖货」记录）</div>' +
      buildTopProducts(topProducts, maxTop) +
      '</div>';

    renderChart();
    el.querySelectorAll('#stats-period button').forEach(function (b) {
      b.onclick = function () { statsPeriod = b.dataset.p; statsSelected = -1; renderStats(); };
    });
  }

  function buildDailyTable(daysArr) {
    const rows = daysArr.slice().reverse();
    return '<table class="table-mini"><tr><th>日期</th><th>营业额</th><th>成本</th><th>利润</th></tr>' +
      rows.map(function (d) {
        return '<tr><td>' + esc(d.date) + '</td><td>¥' + fmtMoney(d.revenue) + '</td><td>¥' + fmtMoney(d.cost) + '</td><td>¥' + fmtMoney(d.profit) + '</td></tr>';
      }).join('') + '</table>';
  }

  function buildTopProducts(list, max) {
    if (!list.length) return '<div class="empty"><p>该时间段还没有卖出记录</p></div>';
    return list.map(function (p) {
      const w = max ? Math.round(p.revenue / max * 100) : 0;
      return '<div style="margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;font-size:14px">' +
        '<span>' + esc(p.name) + '</span>' +
        '<span style="color:var(--ink-2)">' + p.qty + '件 · ¥' + fmtMoney(p.revenue) + '</span>' +
        '</div>' +
        '<div style="height:6px;background:var(--line);border-radius:3px;margin-top:4px;overflow:hidden">' +
        '<div style="height:100%;width:' + w + '%;background:var(--chart-bar);border-radius:3px"></div>' +
        '</div></div>';
    }).join('');
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const norm = v / mag;
    let nice;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * mag;
  }

  function barPath(x, y, w, h, r) {
    const r2 = Math.min(r, w / 2, h);
    const x0 = x, x1 = x + w, y0 = y, y1 = y + h;
    return 'M' + x0 + ' ' + y1 +
      ' L' + x0 + ' ' + (y0 + r2) +
      ' Q' + x0 + ' ' + y0 + ' ' + (x0 + r2) + ' ' + y0 +
      ' L' + (x1 - r2) + ' ' + y0 +
      ' Q' + x1 + ' ' + y0 + ' ' + x1 + ' ' + (y0 + r2) +
      ' L' + x1 + ' ' + y1 + ' Z';
  }

  function renderChart() {
    const box = document.getElementById('chart-box');
    if (!box) return;
    const daysArr = statsDays;
    const n = daysArr.length;
    const W = 320, H = 168, padL = 8, padR = 8, padT = 24, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const baseY = padT + plotH;
    const maxV = Math.max.apply(null, [1].concat(daysArr.map(function (d) { return d.revenue; })));
    const yMax = niceCeil(maxV);
    const ticks = [0, yMax / 2, yMax];

    let s = '<line class="bar-grid" x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '"/>';
    ticks.forEach(function (t) {
      const y = baseY - (t / yMax) * plotH;
      s += '<line class="bar-grid" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>';
      s += '<text class="bar-tick" x="' + padL + '" y="' + (y - 3) + '">' + fmtAxis(t) + '</text>';
    });

    const slot = plotW / n;
    let barW = Math.min(22, slot * 0.6);
    barW = Math.max(barW, 3);
    const labelEvery = n <= 10 ? 1 : (n <= 16 ? 2 : Math.ceil(n / 6));

    daysArr.forEach(function (d, i) {
      const h = (d.revenue / yMax) * plotH;
      const x = padL + slot * i + (slot - barW) / 2;
      const y = baseY - h;
      const selected = (i === statsSelected);
      s += '<path class="bar" fill="' + (selected ? 'var(--brand-dark)' : 'var(--chart-bar)') + '" d="' + barPath(x, y, barW, h, 4) + '"/>';
      s += '<rect class="bar-hit" data-i="' + i + '" x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + plotH + '"/>';
      if (selected) {
        s += '<text class="bar-tick" x="' + (x + barW / 2) + '" y="' + Math.max(y - 4, 9) + '" text-anchor="middle">' + fmtMoney(d.revenue) + '</text>';
      }
      if (i % labelEvery === 0 || i === n - 1) {
        s += '<text class="bar-tick" x="' + (x + barW / 2) + '" y="' + (baseY + 14) + '" text-anchor="middle">' + d.label + '</text>';
      }
    });

    box.innerHTML =
      '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' + s + '</svg></div>' +
      '<div id="chart-detail" style="text-align:center;font-size:13px;color:var(--ink-2);margin-top:2px"></div>';
    updateChartDetail();
    box.querySelectorAll('.bar-hit').forEach(function (r) {
      r.onclick = function () { statsSelected = parseInt(r.dataset.i, 10); renderChart(); };
    });
  }

  function updateChartDetail() {
    const el = document.getElementById('chart-detail');
    if (!el) return;
    const d = statsDays[statsSelected];
    el.textContent = d ? (d.date + ' · 营业额 ¥' + fmtMoney(d.revenue) + ' · 成本 ¥' + fmtMoney(d.cost) + ' · 利润 ¥' + fmtMoney(d.profit)) : '';
  }

  // ---------- 设置 ----------
  async function renderSettings() {
    const el = document.getElementById('view-settings');
    const hasPin = await DB.hasPin();
    const hasUndo = await DB.hasUndo();
    const lastBackup = await DB.getSetting('lastBackupAt');

    el.innerHTML =
      '<div class="card">' +
      '<div class="card-title">数据备份与同步</div>' +
      '<div class="list">' +
      '<div class="list-item"><div class="main"><div class="title">导出备份</div><div class="sub">把全部数据存成一个文件，发微信同步到另一台手机</div></div><button class="btn btn-secondary" id="set-export">导出</button></div>' +
      '<div class="list-item"><div class="main"><div class="title">导入备份</div><div class="sub">从文件恢复数据（会覆盖当前数据）</div></div><button class="btn btn-secondary" id="set-import">导入</button></div>' +
      (hasUndo ? '<div class="list-item"><div class="main"><div class="title">撤销上次导入</div><div class="sub">恢复到导入之前的数据</div></div><button class="btn btn-ghost" id="set-undo">撤销</button></div>' : '') +
      (lastBackup ? '<div class="list-item"><div class="main"><div class="title">上次导出</div><div class="sub">' + esc(new Date(lastBackup).toLocaleString('zh-CN')) + '</div></div></div>' : '') +
      '</div></div>' +
      '<div class="card">' +
      '<div class="card-title">安全</div>' +
      '<div class="list">' +
      '<div class="list-item"><div class="main"><div class="title">' + (hasPin ? '修改密码' : '设置打开密码') + '</div><div class="sub">' + (hasPin ? '已开启密码保护' : '设置后每次打开需要输入') + '</div></div><button class="btn btn-secondary" id="set-pin">' + (hasPin ? '修改' : '设置') + '</button></div>' +
      (hasPin ? '<div class="list-item"><div class="main"><div class="title">立即锁定</div><div class="sub">退出到密码界面</div></div><button class="btn btn-ghost" id="set-lock">锁定</button></div>' : '') +
      '</div></div>' +
      '<div class="card">' +
      '<div class="card-title">帮助</div>' +
      '<div class="list">' +
      '<div class="list-item"><div class="main"><div class="title">使用说明</div><div class="sub">怎么记账、怎么两台手机同步</div></div><button class="btn btn-ghost" id="set-help">查看</button></div>' +
      '</div></div>' +
      '<p style="text-align:center;font-size:12px;color:var(--ink-3)">摆摊记账 · 数据只保存在本机</p>';

    el.querySelector('#set-export').onclick = doExport;
    el.querySelector('#set-import').onclick = doImport;
    if (hasUndo) el.querySelector('#set-undo').onclick = doUndo;
    el.querySelector('#set-pin').onclick = function () { showPinSetup(true); };
    if (hasPin) el.querySelector('#set-lock').onclick = lock;
    el.querySelector('#set-help').onclick = showHelp;
  }

  async function doExport() {
    const data = await DB.exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '摆摊账本备份-' + DB.todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    await DB.setSetting('lastBackupAt', Date.now());
    toast('已导出备份，请保存好（可发微信收藏）');
    renderSettings();
  }

  function doImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        let json;
        try { json = JSON.parse(text); } catch (err) { throw new Error('文件不是有效的 JSON'); }
        showConfirm('导入会覆盖当前全部数据（导入前会自动留一份可撤销的快照），确定继续吗？', async function () {
          try {
            await DB.importBackup(json);
            toast('导入成功');
            renderSettings(); renderHome(); renderProducts(); renderStats();
          } catch (err) { toast('导入失败：' + (err.message || '未知错误')); }
        });
      }).catch(function (err) {
        toast('导入失败：' + (err.message || '文件无法读取'));
      });
    };
    input.click();
  }

  async function doUndo() {
    showConfirm('确定撤销上次导入吗？将恢复到导入之前的数据。', async function () {
      const ok = await DB.undoImport();
      if (ok) { toast('已撤销'); renderSettings(); renderHome(); renderProducts(); renderStats(); }
      else toast('没有可撤销的导入');
    });
  }

  function showHelp() {
    openModal(
      '<button class="modal-close" data-close>×</button>' +
      '<h3>使用说明</h3>' +
      '<div style="font-size:14px;color:var(--ink-2);line-height:1.9">' +
      '<p style="margin:0 0 8px"><strong>1. 每日利润核算（重要）</strong><br>就在「首页」直接填：先填带出现金（出门带的钱）、微信收款、支付宝收款、带回现金（收摊剩的钱）（现金收入 = 带回 − 带出）。带出现金可以点旁边的「单独保存」先单独记。再到「成本」一栏在每个商品后面的框里填今天用掉/卖掉的数量，点「保存成本」，系统自动算营业额、成本、利润。</p>' +
      '<p style="margin:0 0 8px"><strong>2. 商品 / 进货 / 成本</strong><br>到「商品」添加商品：成品填进价+售价，原材料填进价、可选填「规格」（每件克重）。「库存预警线」可以按件、也可以按重量（克/斤等）设。点商品行的「进」直接在那行改数量进货（选「使用账户」现金/微信/支付宝，会自动从对应账户扣钱），不用弹窗；「卖」「用」也能直接记。成本栏会列出所有商品，填用量即按进价算成本、显示金额和剩余库存，并自动扣库存。「商品」页下方有库存预警和最近流水。</p>' +
      '<p style="margin:0 0 8px"><strong>3. 钱包 / 资金记录</strong><br>「钱包」页把现金、微信、支付宝三个账户分开记余额：收款收入进对应账户、进货从所选账户扣钱，还能「记一笔」手动记（比如初始现金）。每笔资金流水都记了操作时间（精确到秒）。</p>' +
      '<p style="margin:0 0 8px"><strong>4. 利润 / 统计</strong><br>利润 = 营业额 − 成本。营业额 = 微信 + 支付宝 + 现金，首页填完实时显示。记错了到「商品」页下方的「最近流水」点「删」（或「查看全部」）撤销，进货/卖货/消耗的库存会自动改回去。「统计」里看每天的营业额、成本、利润趋势，以及「卖得最好的商品」。</p>' +
      '<p style="margin:0 0 8px"><strong>5. 两台手机同步</strong><br>手机A「设置 → 导出备份」得到一个文件 → 用微信发给手机B → 手机B「设置 → 导入备份」选那个文件即可。导入前会自动留一份可撤销的快照。</p>' +
      '<p style="margin:0 0 8px"><strong>6. 备份</strong><br>数据只存在本机，建议定期导出备份存到微信收藏或云盘，防止换手机或误删。</p>' +
      '<p style="margin:0"><strong>7. 密码</strong><br>在「设置 → 设置密码」可加一把打开密码。</p>' +
      '</div>'
    );
  }

  // ---------- Service Worker ----------
  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      let swReloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (swReloaded) return;
        swReloaded = true;
        // 检测到版本更新时自动刷新一次，确保手机拿到最新代码
        window.location.reload();
      });
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  // ---------- 启动 ----------
  function init() {
    registerSW();
    document.querySelectorAll('.tabbar .tab').forEach(function (b) {
      b.onclick = function () { showTab(b.dataset.tab); };
    });
    document.getElementById('modal-root').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });
    document.getElementById('topbar-lock').onclick = async function () {
      if (await DB.hasPin()) lock();
      else { toast('尚未设置密码'); showPinSetup(false); }
    };

    DB.hasPin().then(function (hasPin) {
      if (hasPin) { showPinEnter(); return; }
      DB.getSetting('pinSkipped').then(function (skipped) {
        if (skipped) unlock();
        else showPinSetup(false);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

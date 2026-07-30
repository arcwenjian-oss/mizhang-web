// ===== 蜜账 App - 核心逻辑 =====

// ========== 数据层 ==========
const STORAGE_KEYS = {
  tx: 'mz_transactions',
  accounts: 'mz_accounts',
  ledgers: 'mz_ledgers',
  categories: 'mz_categories',
  budgets: 'mz_budgets',
  user: 'mz_user',
  init: 'mz_initialized',
  currentLedger: 'mz_current_ledger',
};

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
function loadObj(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function saveObj(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ========== 数据清理（半年）==========
function cleanOldData() {
  const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const txns = load(STORAGE_KEYS.tx);
  const filtered = txns.filter(t => t.date >= sixMonthsAgo);
  if (filtered.length < txns.length) {
    save(STORAGE_KEYS.tx, filtered);
    return txns.length - filtered.length;
  }
  return 0;
}

// ========== 云同步（GitHub Gist）==========
const GIST_API = 'https://api.github.com/gists';
let syncTimer = null;
let gistId = localStorage.getItem('mz_gist_id') || '';
let syncToken = localStorage.getItem('mz_sync_token') || '';
let syncKey = localStorage.getItem('mz_sync_key') || '';

function isSyncEnabled() {
  return !!(gistId && syncToken);
}

async function initSyncGist() {
  if (!syncToken || !syncKey) return;
  // 验证已有的 gistId 是否有效
  if (gistId) {
    try {
      const res = await fetch(`${GIST_API}/${gistId}`, {
        headers: { 'Authorization': `token ${syncToken}` },
      });
      if (res.ok) return;
    } catch (e) {}
  }
  // 查找已有的 gist
  try {
    const res = await fetch(`${GIST_API}?per_page=100`, {
      headers: { 'Authorization': `token ${syncToken}` },
    });
    if (res.ok) {
      const gists = await res.json();
      const found = gists.find(g => g.description === `mizhang-sync-${syncKey}`);
      if (found) {
        gistId = found.id;
        localStorage.setItem('mz_gist_id', gistId);
        return;
      }
    }
  } catch (e) {}
  // 创建新的 gist
  try {
    const res = await fetch(GIST_API, {
      method: 'POST',
      headers: {
        'Authorization': `token ${syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: `mizhang-sync-${syncKey}`,
        public: false,
        files: {
          'mizhang-data.json': {
            content: JSON.stringify({ updatedAt: Date.now() })
          }
        }
      }),
    });
    if (res.ok) {
      const gist = await res.json();
      gistId = gist.id;
      localStorage.setItem('mz_gist_id', gistId);
    }
  } catch (e) {}
}

async function syncUpload() {
  if (!isSyncEnabled()) return;
  try {
    const data = {
      transactions: load(STORAGE_KEYS.tx),
      accounts: load(STORAGE_KEYS.accounts),
      ledgers: load(STORAGE_KEYS.ledgers),
      categories: load(STORAGE_KEYS.categories),
      budgets: load(STORAGE_KEYS.budgets),
      user: loadObj(STORAGE_KEYS.user),
      updatedAt: Date.now(),
    };
    await fetch(`${GIST_API}/${gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          'mizhang-data.json': {
            content: JSON.stringify(data)
          }
        }
      }),
    });
    showSyncStatus('✓ 已同步', '#7BC47F');
  } catch (e) {
    showSyncStatus('✕ 同步失败', '#FF6B6B');
  }
}

function mergeById(storageKey, cloudItems, idKey = 'id') {
  if (!cloudItems || !cloudItems.length) return;
  const localItems = load(storageKey);
  const map = new Map();
  localItems.forEach(item => map.set(item[idKey], item));
  cloudItems.forEach(item => {
    const local = map.get(item[idKey]);
    if (!local || (item.updatedAt || 0) > (local.updatedAt || 0)) {
      map.set(item[idKey], item);
    }
  });
  save(storageKey, Array.from(map.values()));
}

async function syncDownload() {
  if (!isSyncEnabled()) return;
  try {
    const res = await fetch(`${GIST_API}/${gistId}`, {
      headers: { 'Authorization': `token ${syncToken}` },
    });
    if (!res.ok) return;
    const gist = await res.json();
    const file = gist.files['mizhang-data.json'];
    if (!file || !file.content) return;
    const data = JSON.parse(file.content);
    if (!data || !data.updatedAt) return;

    // 智能合并：按 id 去重，保留更新的记录
    mergeById(STORAGE_KEYS.tx, data.transactions, 'id');
    mergeById(STORAGE_KEYS.accounts, data.accounts, 'id');
    mergeById(STORAGE_KEYS.ledgers, data.ledgers, 'id');
    mergeById(STORAGE_KEYS.categories, data.categories, 'id');
    mergeById(STORAGE_KEYS.budgets, data.budgets, 'id');

    if (data.user) {
      const localUser = loadObj(STORAGE_KEYS.user);
      if (!localUser || (data.user.updatedAt || 0) > (localUser.updatedAt || 0)) {
        saveObj(STORAGE_KEYS.user, data.user);
      }
    }

    localStorage.setItem('mz_sync_time', data.updatedAt.toString());
    showSyncStatus('✓ 已更新', '#7BC47F');
  } catch (e) {
    // 静默失败，不影响本地使用
  }
}

function debounceSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncUpload(), 1000);
}

function showSyncStatus(text, color) {
  let el = document.getElementById('syncStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'syncStatus';
    el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:12px;font-size:11px;font-weight:600;color:white;z-index:999;pointer-events:none;transition:opacity 0.3s;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.background = color;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// ========== 预设数据 ==========
function ensureInit() {
  if (localStorage.getItem(STORAGE_KEYS.init)) return;
  const now = Date.now();

  save(STORAGE_KEYS.accounts, [
    { id: 'acc_cash', name: '现金', type: 0, icon: '💵', color: 0x7BC47F, initialBalance: 0, sortOrder: 0 },
    { id: 'acc_alipay', name: '支付宝', type: 2, icon: '💙', color: 0xB5EAD7, initialBalance: 0, sortOrder: 1 },
    { id: 'acc_wechat', name: '微信钱包', type: 3, icon: '💚', color: 0x80CBC4, initialBalance: 0, sortOrder: 2 },
    { id: 'acc_bank', name: '银行卡', type: 1, icon: '💳', color: 0xB5D8F1, initialBalance: 0, sortOrder: 3 },
  ]);

  save(STORAGE_KEYS.ledgers, [
    { id: 'ledger_default', name: '日常账本', icon: '📒', color: 0xFF8FA3, createdBy: 'local', members: [], sortOrder: 0 },
  ]);

  const expCats = [
    { name: '餐饮', icon: '🍜', color: 0xFF8FA3 }, { name: '购物', icon: '🛍️', color: 0xE5738A },
    { name: '交通', icon: '🚗', color: 0xB5D8F1 }, { name: '住房', icon: '🏠', color: 0xB5EAD7 },
    { name: '娱乐', icon: '🎮', color: 0xE0BBE4 }, { name: '医疗', icon: '💊', color: 0xFFB74D },
    { name: '教育', icon: '📚', color: 0x90CAF9 }, { name: '美容', icon: '💄', color: 0xF48FB1 },
    { name: '通讯', icon: '📱', color: 0x80CBC4 }, { name: '旅行', icon: '✈️', color: 0xFFE082 },
    { name: '零食', icon: '🍪', color: 0xBCAAA4 }, { name: '宠物', icon: '🐾', color: 0xCE93D8 },
  ];
  const incCats = [
    { name: '工资', icon: '💰', color: 0x7BC47F }, { name: '奖金', icon: '🎁', color: 0x66BB6A },
    { name: '理财', icon: '📈', color: 0x81C784 }, { name: '兼职', icon: '💼', color: 0xA5D6A7 },
    { name: '红包', icon: '🧧', color: 0xE5738A }, { name: '其他', icon: '✨', color: 0xFFD54F },
  ];
  const cats = [];
  expCats.forEach((c, i) => cats.push({ id: 'cat_exp_' + i, ...c, type: 1, sortOrder: i, isCustom: false }));
  incCats.forEach((c, i) => cats.push({ id: 'cat_inc_' + i, ...c, type: 0, sortOrder: i, isCustom: false }));
  save(STORAGE_KEYS.categories, cats);

  saveObj(STORAGE_KEYS.user, { id: 'user_local', name: '我的', avatar: '🐻', avatarColor: 0xFF8FA3 });
  saveObj(STORAGE_KEYS.currentLedger, 'ledger_default');
  localStorage.setItem(STORAGE_KEYS.init, '1');
}

// ========== 状态 ==========
let state = {
  currentPage: 'home',
  currentLedger: 'ledger_default',
  statsYear: new Date().getFullYear(),
  statsMonth: new Date().getMonth() + 1,
  accTab: 0,
  editingTx: null,
};

// ========== 数据访问 ==========
const getTx = () => load(STORAGE_KEYS.tx);
const getAccounts = () => load(STORAGE_KEYS.accounts).sort((a, b) => a.sortOrder - b.sortOrder);
const getLedgers = () => load(STORAGE_KEYS.ledgers).sort((a, b) => a.sortOrder - b.sortOrder);
const getCategories = (type) => load(STORAGE_KEYS.categories).filter(c => !type || c.type === type).sort((a, b) => a.sortOrder - b.sortOrder);
const getBudgets = (ledgerId) => load(STORAGE_KEYS.budgets).filter(b => !ledgerId || b.ledgerId === ledgerId);
const getUser = () => loadObj(STORAGE_KEYS.user) || { name: '我的', avatar: '🐻' };

function getAccountBalance(accId) {
  const accounts = getAccounts();
  const acc = accounts.find(a => a.id === accId);
  if (!acc) return 0;
  let bal = acc.initialBalance || 0;
  getTx().forEach(t => {
    if (t.accountId === accId) {
      if (t.type === 0) bal += t.amount;
      else if (t.type === 1) bal -= t.amount;
      else if (t.type === 2) bal -= t.amount;
    }
    if (t.toAccountId === accId && t.type === 2) bal += t.amount;
  });
  return bal;
}

function getSummary(ledgerId, startDate, endDate) {
  let income = 0, expense = 0;
  getTx().forEach(t => {
    if (ledgerId && t.ledgerId !== ledgerId) return;
    if (t.date < startDate || t.date >= endDate) return;
    if (t.type === 0) income += t.amount;
    else if (t.type === 1) expense += t.amount;
  });
  return { income, expense, balance: income - expense };
}

function getCategorySummary(ledgerId, startDate, endDate, type) {
  const grouped = {};
  getTx().forEach(t => {
    if (ledgerId && t.ledgerId !== ledgerId) return;
    if (t.date < startDate || t.date >= endDate) return;
    if (t.type !== type) return;
    if (!grouped[t.categoryId]) {
      grouped[t.categoryId] = { categoryId: t.categoryId, categoryName: t.categoryName, icon: t.categoryIcon, color: t.categoryColor, amount: 0 };
    }
    grouped[t.categoryId].amount += t.amount;
  });
  return Object.values(grouped).sort((a, b) => b.amount - a.amount);
}

function getDailyStats(ledgerId, startDate, endDate) {
  const grouped = {};
  getTx().forEach(t => {
    if (ledgerId && t.ledgerId !== ledgerId) return;
    if (t.date < startDate || t.date >= endDate) return;
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!grouped[key]) grouped[key] = { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), income: 0, expense: 0 };
    if (t.type === 0) grouped[key].income += t.amount;
    else if (t.type === 1) grouped[key].expense += t.amount;
  });
  return Object.values(grouped).sort((a, b) => a.date - b.date);
}

// ========== 工具 ==========
function fmtMoney(n) { return '¥' + (Math.round(n * 100) / 100).toFixed(2); }
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDateShort(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  return `${d.getMonth()+1}月${d.getDate()}日`;
}
function colorHex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ========== 页面切换 ==========
function switchPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));

  if (page === 'home') renderHome();
  else if (page === 'stats') renderStats();
  else if (page === 'accounts') renderAccounts();
  else if (page === 'settings') renderSettings();
}

// ========== 首页渲染 ==========
function renderHome() {
  const user = getUser();
  const now = new Date();
  const summary = getSummary(state.currentLedger, new Date(now.getFullYear(), now.getMonth(), 1).getTime(), new Date(now.getFullYear(), now.getMonth()+1, 1).getTime());

  const cover = localStorage.getItem('mz_cover') || '';
const coverStyle = cover ? `background-image:url('${cover}')` : '';

document.getElementById('homeHeader').innerHTML = `
    <div class="header-cover" style="${coverStyle}"></div>
    <div class="header-cover-overlay"></div>
    <button class="header-cover-btn" onclick="document.getElementById('coverInput').click()" oncontextmenu="event.preventDefault();removeCover()" title="左键换封面，右键移除">📷</button>
    <input type="file" id="coverInput" accept="image/*" style="display:none" onchange="uploadCover(event)">
    <div style="position:relative;z-index:1">
      <div class="header-top">
        <div class="header-user">
          <span class="header-avatar">${user.avatar}</span>
          <span class="header-name">${user.name}</span>
        </div>
        <span class="header-month">${now.getMonth()+1}月 🌸</span>
      </div>
      <div class="header-label">本月结余</div>
      <div class="header-balance">${fmtMoney(summary.balance)}</div>
      <div class="header-summary">
        <div class="summary-card">
          <span class="summary-emoji">💰</span>
          <div class="summary-text"><div class="summary-label">收入</div><div class="summary-val">${fmtMoney(summary.income)}</div></div>
        </div>
        <div class="summary-card">
          <span class="summary-emoji">🛍️</span>
          <div class="summary-text"><div class="summary-label">支出</div><div class="summary-val">${fmtMoney(summary.expense)}</div></div>
        </div>
      </div>
    </div>
  `;

  renderBudgetSection();
  renderLedgerBar();
  renderQuickRecord();
  renderTxList();
}

// ========== 封面上传 & 裁剪 ==========
let cropState = { img: null, x: 0, y: 0, zoom: 100 };

function uploadCover(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('图片太大了，请选 5MB 以内的'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    showCropDialog(e.target.result);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function showCropDialog(src) {
  cropState = { img: new Image(), x: 0, y: 0, zoom: 100 };
  cropState.img.onload = function() {
    const frame = document.getElementById('cropFrame');
    const img = document.getElementById('cropImg');
    img.src = src;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.transform = 'translate(0,0) scale(1)';
    cropState.x = 0; cropState.y = 0; cropState.zoom = 100;
    document.getElementById('cropZoom').value = 100;
    document.getElementById('cropOverlay').classList.add('show');
    initCropDrag();
  };
  cropState.img.src = src;
}

function cropZoom(val) {
  cropState.zoom = parseInt(val);
  updateCropTransform();
}

function updateCropTransform() {
  const img = document.getElementById('cropImg');
  const scale = cropState.zoom / 100;
  img.style.transform = `translate(${cropState.x}px, ${cropState.y}px) scale(${scale})`;
  img.style.transformOrigin = 'center center';
}

function initCropDrag() {
  const frame = document.getElementById('cropFrame');
  let startX = 0, startY = 0, dragging = false;

  frame.onmousedown = function(e) { dragging = true; startX = e.clientX - cropState.x; startY = e.clientY - cropState.y; };
  window.onmousemove = function(e) {
    if (!dragging) return;
    cropState.x = e.clientX - startX;
    cropState.y = e.clientY - startY;
    updateCropTransform();
  };
  window.onmouseup = function() { dragging = false; };

  frame.ontouchstart = function(e) { dragging = true; startX = e.touches[0].clientX - cropState.x; startY = e.touches[0].clientY - cropState.y; };
  window.ontouchmove = function(e) {
    if (!dragging) return;
    cropState.x = e.touches[0].clientX - startX;
    cropState.y = e.touches[0].clientY - startY;
    updateCropTransform();
  };
  window.ontouchend = function() { dragging = false; };
}

function confirmCrop() {
  const frame = document.getElementById('cropFrame');
  const scale = cropState.zoom / 100;
  const fw = frame.offsetWidth;
  const fh = frame.offsetHeight;

  const canvas = document.createElement('canvas');
  canvas.width = fw;
  canvas.height = fh;
  const ctx = canvas.getContext('2d');

  // 先填充粉色渐变底色
  const grad = ctx.createLinearGradient(0, 0, fw, fh);
  grad.addColorStop(0, 'rgba(255,143,163,0.35)');
  grad.addColorStop(0.5, 'rgba(255,179,198,0.25)');
  grad.addColorStop(1, 'rgba(255,214,224,0.15)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, fw, fh);

  // 绘制图片 - 从原始图片计算可见区域
  const img = cropState.img;
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;

  // 计算 object-fit: cover 下的显示尺寸
  const frameRatio = fw / fh;
  const imgRatio = imgW / imgH;
  let drawW, drawH;
  if (imgRatio > frameRatio) {
    drawH = fh;
    drawW = fh * imgRatio;
  } else {
    drawW = fw;
    drawH = fw / imgRatio;
  }

  // 应用用户缩放
  drawW *= scale;
  drawH *= scale;

  // 计算绘制位置（居中 + 用户拖动偏移）
  const baseX = (fw - drawW) / 2;
  const baseY = (fh - drawH) / 2;

  ctx.globalAlpha = 0.85;
  ctx.drawImage(img, baseX + cropState.x, baseY + cropState.y, drawW, drawH);
  ctx.globalAlpha = 1.0;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  localStorage.setItem('mz_cover', dataUrl);
  closeCrop();
  renderHome();
  toast('封面设置成功！🌸');
}

function closeCrop() {
  document.getElementById('cropOverlay').classList.remove('show');
}

function removeCover() {
  if (!localStorage.getItem('mz_cover')) return;
  localStorage.removeItem('mz_cover');
  renderHome();
  toast('封面已移除 🗑️');
}

function renderBudgetSection() {
  const budgets = getBudgets(state.currentLedger);
  if (!budgets.length) { document.getElementById('budgetSection').innerHTML = ''; return; }

  const now = new Date();
  let range;
  budgets.forEach(b => {
    // Simplified: monthly period
    range = { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: new Date(now.getFullYear(), now.getMonth()+1, 1).getTime() };
  });
  range = { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: new Date(now.getFullYear(), now.getMonth()+1, 1).getTime() };

  let html = '<div class="budget-card"><div class="budget-title">🎯 预算</div>';
  budgets.slice(0, 3).forEach(b => {
    const txns = getTx().filter(t => t.ledgerId === state.currentLedger && t.date >= range.start && t.date < range.end && t.type === 1 && (!b.categoryId || t.categoryId === b.categoryId));
    const used = txns.reduce((s, t) => s + t.amount, 0);
    const pct = b.amount > 0 ? Math.min(used / b.amount, 1) : 0;
    const isOver = used >= b.amount;
    const name = b.categoryId ? b.categoryName : '总预算';
    html += `
      <div class="budget-item">
        <div class="budget-row">
          <span>${name}</span>
          <span style="color:${isOver ? 'var(--warning)' : 'var(--text-2)'};font-weight:600">¥${Math.round(used)} / ${Math.round(b.amount)}</span>
        </div>
        <div class="budget-bar"><div class="budget-fill" style="width:${pct*100}%;background:${isOver ? 'var(--warning)' : 'var(--pink)'}"></div></div>
      </div>`;
  });
  html += '</div>';
  document.getElementById('budgetSection').innerHTML = html;
}

function renderLedgerBar() {
  const ledgers = getLedgers();
  document.getElementById('ledgerBar').innerHTML = ledgers.map(l => `
    <div class="ledger-chip ${l.id === state.currentLedger ? 'active' : ''}" onclick="setLedger('${l.id}')">
      ${l.icon} ${l.name}
    </div>
  `).join('');
}

// ========== 快速记账 ==========
let quickState = { type: 1, categoryId: null, amountStr: '', cat: null };

function renderQuickRecord() {
  const expCats = getCategories(1);
  const incCats = getCategories(0);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86400000;

  // Today's spending per category
  const todayByCat = {};
  getTx().forEach(t => {
    if (t.ledgerId !== state.currentLedger) return;
    if (t.date < todayStart || t.date >= todayEnd) return;
    if (!todayByCat[t.type]) todayByCat[t.type] = {};
    if (!todayByCat[t.type][t.categoryId]) todayByCat[t.type][t.categoryId] = { amount: 0, name: t.categoryName, icon: t.categoryIcon, color: t.categoryColor };
    todayByCat[t.type][t.categoryId].amount += t.amount;
  });

  const activeType = quickState.type;
  const cats = activeType === 1 ? expCats : incCats;
  const todayData = todayByCat[activeType] || {};

  let html = `
    <div class="quick-section">
      <div class="quick-tabs">
        <div class="quick-tab ${activeType === 1 ? 'active' : ''}" onclick="switchQuickType(1)">🛍️ 支出</div>
        <div class="quick-tab ${activeType === 0 ? 'active' : ''}" onclick="switchQuickType(0)">💰 收入</div>
      </div>
      <div class="quick-grid">
        ${cats.map(c => {
          const today = todayData[c.id];
          const hasToday = today && today.amount > 0;
          return `<div class="quick-cat ${hasToday ? 'has-today' : ''}" onclick="openQuickPopup('${c.id}')">
            <div class="quick-cat-emoji">${c.icon}</div>
            <div class="quick-cat-name">${c.name}</div>
            <div class="quick-cat-today ${hasToday ? '' : 'zero'}">${hasToday ? '¥' + Math.round(today.amount) : '—'}</div>
          </div>`;
        }).join('')}
        <div class="quick-cat" onclick="window._fromQuick=true;addCategoryDialog(${activeType})">
            <div class="quick-cat-emoji">➕</div>
            <div class="quick-cat-name">添加</div>
          </div>
          <div class="quick-cat quick-del" onclick="showDeleteList(${activeType})">
            <div class="quick-cat-emoji">−</div>
            <div class="quick-cat-name">删除</div>
          </div>
      </div>
    </div>
  `;
  document.getElementById('quickRecord').innerHTML = html;
}

function switchQuickType(type) {
  quickState.type = type;
  renderQuickRecord();
}

function openQuickPopup(catId) {
  const cats = getCategories(quickState.type);
  const cat = cats.find(c => c.id === catId);
  if (!cat) return;

  quickState.categoryId = catId;
  quickState.cat = cat;
  quickState.amountStr = '';
  quickState.note = '';

  const label = quickState.type === 0 ? '💰 收入了多少呀？' : '🌸 花了多少钱呀？';

  // 预生成账户选项 HTML，避免弹出后动态插入导致高度跳动
  const accounts = getAccounts();
  const accountOptsHtml = accounts.length > 0
    ? accounts.slice(0, 4).map((a, i) =>
        `<button class="quick-option ${i === 0 ? 'selected' : ''}" onclick="quickSetAccount(this, '${a.id}')">${a.icon} ${a.name}</button>`
      ).join('')
    : '';
  if (accounts.length > 0) quickState.accountId = accounts[0].id;

  document.getElementById('quickPopup').innerHTML = `
    <div class="quick-popup-header">
      <div class="quick-popup-cat">
        <div class="quick-popup-icon" style="background:${colorHex(cat.color)}18">${cat.icon}</div>
        <div>
          <div class="quick-popup-name">${cat.name}</div>
          <div style="font-size:12px;color:var(--text-2)">${label}</div>
        </div>
      </div>
      <button class="quick-popup-close" onclick="closeQuickPopup()">✕</button>
    </div>
    <div class="quick-popup-body">
      <div class="quick-amount-display">
        <div class="quick-amount-label">金额</div>
        <div class="quick-amount-val empty" id="quickAmountVal">¥0</div>
      </div>
      <div class="quick-options" id="quickOptsBar">${accountOptsHtml}</div>
      <button id="quickSaveBtn" class="quick-amt-btn save disabled" style="width:100%;" onclick="quickSave()" disabled>✓ 记好啦</button>
      <div class="quick-note-input fake-input" onclick="openNoteInput()">
        <span class="note-placeholder">写点备注（可选）✏️</span>
      </div>
    </div>
    <div class="quick-amount-btns">
      <button class="quick-amt-btn" onclick="quickInput('7')">7</button>
      <button class="quick-amt-btn" onclick="quickInput('8')">8</button>
      <button class="quick-amt-btn" onclick="quickInput('9')">9</button>
      <button class="quick-amt-btn" onclick="quickInput('4')">4</button>
      <button class="quick-amt-btn" onclick="quickInput('5')">5</button>
      <button class="quick-amt-btn" onclick="quickInput('6')">6</button>
      <button class="quick-amt-btn" onclick="quickInput('1')">1</button>
      <button class="quick-amt-btn" onclick="quickInput('2')">2</button>
      <button class="quick-amt-btn" onclick="quickInput('3')">3</button>
      <button class="quick-amt-btn" onclick="quickInput('.')">·</button>
      <button class="quick-amt-btn" onclick="quickInput('0')">0</button>
      <button class="quick-amt-btn del" onclick="quickBackspace()">⌫</button>
    </div>
  `;

  document.getElementById('quickOverlay').classList.add('show');
  document.getElementById('quickPopup').classList.add('show');

  // 锁定页面，防止滚动导致布局跳动
  const scrollY = window.scrollY || window.pageYOffset;
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.top = `-${scrollY}px`;
  quickState._scrollY = scrollY;

  // 强制收起系统键盘，防止误触
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
}

function quickSetAccount(el, accId) {
  document.querySelectorAll('.quick-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  quickState.accountId = accId || (getAccounts()[0]?.id);
}

function quickInput(ch) {
  if (ch === '.' && quickState.amountStr.includes('.')) return;
  if (quickState.amountStr.includes('.')) {
    const parts = quickState.amountStr.split('.');
    if (parts[1] && parts[1].length >= 2) return;
  }
  if (quickState.amountStr === '0' && ch !== '.') {
    quickState.amountStr = ch;
  } else {
    quickState.amountStr += ch;
  }
  updateQuickDisplay();
}

function quickBackspace() {
  quickState.amountStr = quickState.amountStr.slice(0, -1);
  updateQuickDisplay();
}

function updateQuickDisplay() {
  const el = document.getElementById('quickAmountVal');
  if (!el) return;
  if (!quickState.amountStr) {
    el.textContent = '¥0';
    el.classList.add('empty');
    el.classList.remove('income-color');
  } else {
    el.textContent = '¥' + quickState.amountStr;
    el.classList.remove('empty');
    if (quickState.type === 0) el.classList.add('income-color');
    else el.classList.remove('income-color');
  }

  // 更新保存按钮状态：有金额时才能点
  const saveBtn = document.getElementById('quickSaveBtn');
  const amount = parseFloat(quickState.amountStr);
  if (saveBtn) {
    if (amount && amount > 0) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('disabled');
    } else {
      saveBtn.disabled = true;
      saveBtn.classList.add('disabled');
    }
  }
}

function quickSave() {
  const amount = parseFloat(quickState.amountStr);
  if (!amount || amount <= 0) { toast('请输入金额呀～ 🌸'); return; }

  const cat = quickState.cat;
  const accounts = getAccounts();
  const acc = accounts.find(a => a.id === quickState.accountId) || accounts[0];
  if (!acc) { toast('请先添加一个账户 💰'); return; }

  const ledgers = getLedgers();
  const ledger = ledgers.find(l => l.id === state.currentLedger) || ledgers[0];
  const user = getUser();
  const note = quickState.note || null;

  const txData = {
    id: uid(), type: quickState.type, amount,
    categoryId: cat.id, categoryName: cat.name, categoryIcon: cat.icon, categoryColor: cat.color,
    accountId: acc.id, accountName: acc.name,
    toAccountId: null, toAccountName: null,
    ledgerId: ledger.id, ledgerName: ledger.name,
    date: Date.now(), note,
    createdBy: user.name, createdAt: Date.now(), updatedAt: Date.now(),
  };

  const txns = getTx();
  txns.push(txData);
  save(STORAGE_KEYS.tx, txns);

  closeQuickPopup();
  renderHome();
  debounceSync();
  toast(`${cat.icon} ${quickState.type === 0 ? '收入' : '支出'} ¥${amount.toFixed(2)} 记好啦！🌸`);
}

function closeQuickPopup(e) {
  if (e && e.target.id !== 'quickOverlay') return;
  document.getElementById('quickOverlay').classList.remove('show');
  document.getElementById('quickPopup').classList.remove('show');
  quickState.amountStr = '';
  quickState.note = '';

  // 恢复页面滚动
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.top = '';
  if (quickState._scrollY !== undefined) {
    window.scrollTo(0, quickState._scrollY);
    delete quickState._scrollY;
  }
}

// ========== 备注输入弹窗 ==========
function openNoteInput() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">写点备注 ✏️</div>
    <textarea id="noteInput" rows="4" placeholder="今天的小心情、小记录..."
      style="width:100%;padding:12px;border-radius:12px;border:1px solid #EEE;
      font-size:14px;resize:none;margin-bottom:12px;font-family:inherit">${quickState.note || ''}</textarea>
    <div style="display:flex;gap:8px">
      <button class="quick-amt-btn" style="flex:1;background:#F5F5F5;color:var(--text-2)" onclick="closeModal()">取消</button>
      <button class="quick-amt-btn save" style="flex:2" onclick="saveNote()">✓ 保存</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  // 允许备注输入框获得焦点
  window._allowFocus = true;
  // 聚焦并弹出键盘
  setTimeout(() => document.getElementById('noteInput').focus(), 50);
}

function saveNote() {
  quickState.note = document.getElementById('noteInput').value.trim();
  // 更新主弹窗的备注显示
  const noteEl = document.querySelector('.note-placeholder');
  if (noteEl) {
    if (quickState.note) {
      noteEl.textContent = '📝 ' + quickState.note;
      noteEl.style.color = 'var(--text)';
    } else {
      noteEl.textContent = '写点备注（可选）✏️';
      noteEl.style.color = '';
    }
  }
  closeModal();
}

function setLedger(id) {
  state.currentLedger = id;
  saveObj(STORAGE_KEYS.currentLedger, id);
  renderHome();
}

function renderTxList() {
  const txns = getTx().filter(t => t.ledgerId === state.currentLedger).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
  const list = document.getElementById('txList');

  if (!txns.length) {
    list.innerHTML = `<div class="empty"><div class="empty-emoji">🐰</div><div class="empty-title">还没有记账记录哦</div><div class="empty-sub">点击上方分类图标，快速记一笔吧～</div></div>`;
    return;
  }

  // Group by date
  const grouped = {};
  txns.forEach(t => {
    const key = fmtDate(t.date);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  });
  const keys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  let html = "";
  keys.forEach(key => {
    const dayTxns = grouped[key];
    const dayExp = dayTxns.filter(t => t.type === 1).reduce((s, t) => s + t.amount, 0);
    const dayInc = dayTxns.filter(t => t.type === 0).reduce((s, t) => s + t.amount, 0);
    html += `<div class="tx-group-header"><span>${fmtDateShort(dayTxns[0].date)}</span><span>${dayInc > 0 ? '收 ¥'+Math.round(dayInc)+' ' : ''}${dayExp > 0 ? '支 ¥'+Math.round(dayExp) : ''}</span></div>`;
    dayTxns.forEach(t => {
      const isInc = t.type === 0;
      const isTrf = t.type === 2;
      const sign = isInc ? '+' : (isTrf ? '' : '-');
      const color = isInc ? 'var(--income)' : (isTrf ? 'var(--transfer)' : 'var(--expense)');
      const name = isTrf ? `${t.accountName} → ${t.toAccountName}` : t.categoryName;
      html += `
        <div class="tx-item" onclick="editTx('${t.id}')">
          <div class="tx-icon" style="background:${colorHex(t.categoryColor)}20">${t.categoryIcon}</div>
          <div class="tx-info">
            <div class="tx-cat">${name}</div>
            <div class="tx-meta">${t.note || t.accountName}<span class="tx-tag">${t.createdBy}</span></div>
          </div>
          <div class="tx-amount" style="color:${color}">${sign}${fmtMoney(t.amount)}</div>
        </div>`;
    });
  });
  list.innerHTML = html;
}

// ========== 添加/编辑交易 ==========
function openAddTx(txId) {
  const tx = txId ? getTx().find(t => t.id === txId) : null;
  state.editingTx = tx;

  const expCats = getCategories(1);
  const incCats = getCategories(0);
  const accounts = getAccounts();
  const ledgers = getLedgers();
  const currentLedger = ledgers.find(l => l.id === state.currentLedger) || ledgers[0];
  const type = tx ? tx.type : 1;

  const amount = tx ? tx.amount : '';
  const note = tx ? (tx.note || '') : '';

  let catHtml = (type === 1 ? expCats : incCats).map(c => `
    <div class="cat-item ${tx && tx.categoryId === c.id ? 'selected' : ''}" data-cat="${c.id}" onclick="selectCat(this)">
      <div class="cat-emoji">${c.icon}</div>
      <div class="cat-name">${c.name}</div>
    </div>
  `).join('') + `
    <div class="cat-item" onclick="addCategoryDialog(${type})">
      <div class="cat-emoji">➕</div>
      <div class="cat-name">添加</div>
    </div>`;

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    ${tx ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span class="modal-title" style="margin:0">编辑记录</span>
      <button onclick="deleteTx('${tx.id}')" style="color:var(--warning);background:none;font-size:13px;cursor:pointer">🗑️ 删除</button>
    </div>` : '<div class="modal-title">记一笔</div>'}
    <div class="tab-bar">
      <div class="tab-item ${type === 0 ? 'active' : ''}" onclick="switchTxType(0)">收入</div>
      <div class="tab-item ${type === 1 ? 'active' : ''}" onclick="switchTxType(1)">支出</div>
      <div class="tab-item ${type === 2 ? 'active' : ''}" onclick="switchTxType(2)">转账</div>
    </div>
    <div id="txFormBody">
      ${renderTxFormBody(type, amount, note, tx, expCats, incCats, accounts, catHtml)}
    </div>
    <button class="btn-primary" onclick="saveTx()">${tx ? '保存修改' : '记好啦！'}</button>
  `;
  document.getElementById('modalOverlay').classList.add('show');

  // Store selected cat/account
  window._txState = {
    type,
    categoryId: tx ? tx.categoryId : null,
    accountId: tx ? tx.accountId : (accounts[0]?.id || null),
    toAccountId: tx ? tx.toAccountId : null,
    date: tx ? tx.date : Date.now(),
    ledgerId: currentLedger?.id,
    ledgerName: currentLedger?.name,
  };
}

function renderTxFormBody(type, amount, note, tx, expCats, incCats, accounts, catHtml) {
  if (type === 2) {
    // Transfer form
    return `
      <div class="amount-box">
        <div class="amount-hint">转了多少钱呀？🔄</div>
        <div class="amount-input-wrap">
          <span class="amount-symbol" style="color:var(--transfer)">¥</span>
          <input class="amount-input" id="txAmount" type="number" placeholder="0.00" value="${amount}" style="color:var(--transfer)">
        </div>
      </div>
      <div class="section-label">从账户</div>
      <div class="field" onclick="pickAccount('from')">
        <span class="field-icon">${tx ? (accounts.find(a=>a.id===tx.accountId)?.icon || '💰') : '💰'}</span>
        <span class="field-label" id="fromAccountName">${tx ? (accounts.find(a=>a.id===tx.accountId)?.name || '选择账户') : '选择账户'}</span>
        <span class="field-arrow">›</span>
      </div>
      <div class="section-label">到账户</div>
      <div class="field" onclick="pickAccount('to')">
        <span class="field-icon">${tx?.toAccountId ? (accounts.find(a=>a.id===tx.toAccountId)?.icon || '💰') : '💰'}</span>
        <span class="field-label" id="toAccountName">${tx?.toAccountId ? (accounts.find(a=>a.id===tx.toAccountId)?.name || '选择账户') : '选择账户'}</span>
        <span class="field-arrow">›</span>
      </div>
      <div class="field" onclick="pickDate()">
        <span class="field-icon">📅</span>
        <span class="field-label" id="txDateLabel">${fmtDate(window._txState?.date || Date.now())}</span>
        <span class="field-arrow">›</span>
      </div>
      <input class="field-input" id="txNote" placeholder="写点备注吧～" value="${note}">
    `;
  }

  const color = type === 0 ? 'var(--income)' : 'var(--expense)';
  const hint = type === 0 ? '赚了多少呀？💰' : '花了多少钱呀？🌸';

  return `
    <div class="amount-box">
      <div class="amount-hint">${hint}</div>
      <div class="amount-input-wrap">
        <span class="amount-symbol" style="color:${color}">¥</span>
        <input class="amount-input" id="txAmount" type="number" placeholder="0.00" value="${amount}" style="color:${color}">
      </div>
    </div>
    <div class="section-label">选择分类</div>
    <div class="cat-grid" id="catGrid">${catHtml}</div>
    <div class="section-label">账户</div>
    <div class="field" onclick="pickAccount('from')">
      <span class="field-icon">${tx ? (accounts.find(a=>a.id===tx.accountId)?.icon || '💰') : accounts[0]?.icon || '💰'}</span>
      <span class="field-label" id="fromAccountName">${tx ? (accounts.find(a=>a.id===tx.accountId)?.name || '选择账户') : accounts[0]?.name || '选择账户'}</span>
      <span class="field-arrow">›</span>
    </div>
    <div class="field" onclick="pickDate()">
      <span class="field-icon">📅</span>
      <span class="field-label" id="txDateLabel">${fmtDate(window._txState?.date || Date.now())}</span>
      <span class="field-arrow">›</span>
    </div>
    <input class="field-input" id="txNote" placeholder="写点备注吧～" value="${note}">
  `;
}

function switchTxType(type) {
  const tx = state.editingTx;
  const amount = document.getElementById('txAmount')?.value || '';
  const note = document.getElementById('txNote')?.value || '';
  const expCats = getCategories(1);
  const incCats = getCategories(0);
  const accounts = getAccounts();

  window._txState.type = type;

  let catHtml;
  if (type === 2) {
    catHtml = '';
  } else {
    const cats = type === 0 ? incCats : expCats;
    catHtml = cats.map(c => `
      <div class="cat-item ${window._txState.categoryId === c.id ? 'selected' : ''}" data-cat="${c.id}" onclick="selectCat(this)">
        <div class="cat-emoji">${c.icon}</div>
        <div class="cat-name">${c.name}</div>
      </div>
    `).join('') + `
      <div class="cat-item" onclick="addCategoryDialog(${type})">
        <div class="cat-emoji">➕</div>
        <div class="cat-name">添加</div>
      </div>`;
  }

  document.getElementById('txFormBody').innerHTML = renderTxFormBody(type, amount, note, tx, expCats, incCats, accounts, catHtml);
  document.querySelectorAll('.tab-item').forEach((el, i) => el.classList.toggle('active', i === type));
  if (type !== 2 && !window._txState.categoryId) {
    const cats = type === 0 ? incCats : expCats;
    if (cats.length) {
      window._txState.categoryId = cats[0].id;
      document.querySelector('.cat-item')?.classList.add('selected');
    }
  }
}

function selectCat(el) {
  document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  window._txState.categoryId = el.dataset.cat;
}

function pickAccount(direction) {
  const accounts = getAccounts();
  const title = direction === 'from' ? '选择账户' : '选择转入账户';
  let html = `<div class="modal-handle"></div><div class="modal-title">${title}</div>`;
  accounts.forEach(a => {
    html += `<div class="acc-item" onclick="setAccount('${direction}','${a.id}')">
      <div class="acc-icon" style="background:${colorHex(a.color)}20">${a.icon}</div>
      <div class="acc-info"><div class="acc-name">${a.name}</div></div>
      <span>›</span>
    </div>`;
  });
  document.getElementById('modalContent').innerHTML = html;
}

function setAccount(direction, accId) {
  const acc = getAccounts().find(a => a.id === accId);
  if (!acc) return;
  if (direction === 'from') {
    window._txState.accountId = accId;
    const el = document.getElementById('fromAccountName');
    if (el) { el.textContent = acc.name; el.previousElementSibling.textContent = acc.icon; }
  } else {
    window._txState.toAccountId = accId;
    const el = document.getElementById('toAccountName');
    if (el) { el.textContent = acc.name; el.previousElementSibling.textContent = acc.icon; }
  }
  // Reopen the add tx modal
  reopenTxModal();
}

function pickDate() {
  const current = new Date(window._txState.date || Date.now());
  const input = document.createElement('input');
  input.type = 'date';
  input.value = fmtDate(window._txState.date);
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.top = '50%';
  document.body.appendChild(input);
  input.showPicker?.() || input.click();
  input.addEventListener('change', () => {
    if (input.value) {
      window._txState.date = new Date(input.value).getTime();
      const el = document.getElementById('txDateLabel');
      if (el) el.textContent = input.value;
    }
    input.remove();
  });
  input.addEventListener('blur', () => setTimeout(() => input.remove(), 300));
}

function reopenTxModal() {
  const amount = document.getElementById('txAmount')?.value || '';
  const note = document.getElementById('txNote')?.value || '';
  const type = window._txState.type;
  const expCats = getCategories(1);
  const incCats = getCategories(0);
  const accounts = getAccounts();

  let catHtml = '';
  if (type !== 2) {
    const cats = type === 0 ? incCats : expCats;
    catHtml = cats.map(c => `
      <div class="cat-item ${window._txState.categoryId === c.id ? 'selected' : ''}" data-cat="${c.id}" onclick="selectCat(this)">
        <div class="cat-emoji">${c.icon}</div>
        <div class="cat-name">${c.name}</div>
      </div>
    `).join('') + `
      <div class="cat-item" onclick="addCategoryDialog(${type})">
        <div class="cat-emoji">➕</div>
        <div class="cat-name">添加</div>
      </div>`;
  }

  // Build account display
  const fromAcc = accounts.find(a => a.id === window._txState.accountId);
  const toAcc = accounts.find(a => a.id === window._txState.toAccountId);

  // Create a fake tx object for rendering
  const fakeTx = {
    type, amount, note,
    accountId: window._txState.accountId,
    toAccountId: window._txState.toAccountId,
    categoryId: window._txState.categoryId,
    date: window._txState.date,
  };

  const body = renderTxFormBody(type, amount, note, fakeTx, expCats, incCats, accounts, catHtml);
  // Override account names
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    ${state.editingTx ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span class="modal-title" style="margin:0">编辑记录</span>
      <button onclick="deleteTx('${state.editingTx.id}')" style="color:var(--warning);background:none;font-size:13px;cursor:pointer">🗑️ 删除</button>
    </div>` : '<div class="modal-title">记一笔</div>'}
    <div class="tab-bar">
      <div class="tab-item ${type === 0 ? 'active' : ''}" onclick="switchTxType(0)">收入</div>
      <div class="tab-item ${type === 1 ? 'active' : ''}" onclick="switchTxType(1)">支出</div>
      <div class="tab-item ${type === 2 ? 'active' : ''}" onclick="switchTxType(2)">转账</div>
    </div>
    <div id="txFormBody">${body}</div>
    <button class="btn-primary" onclick="saveTx()">${state.editingTx ? '保存修改' : '记好啦！'}</button>
  `;
}

function saveTx() {
  const amount = parseFloat(document.getElementById('txAmount').value);
  if (!amount || amount <= 0) { toast('请输入有效金额呀～ 🌸'); return; }

  const type = window._txState.type;
  const note = document.getElementById('txNote').value.trim();
  const accounts = getAccounts();
  const ledgers = getLedgers();
  const ledger = ledgers.find(l => l.id === state.currentLedger) || ledgers[0];
  const user = getUser();

  if (type !== 2) {
    if (!window._txState.categoryId) { toast('选一个分类吧～ 🎯'); return; }
    const cat = getCategories(type === 0 ? 0 : 1).find(c => c.id === window._txState.categoryId);
    if (!cat) { toast('分类无效'); return; }
    window._txState.categoryName = cat.name;
    window._txState.categoryIcon = cat.icon;
    window._txState.categoryColor = cat.color;
  }

  if (!window._txState.accountId) { toast('选一个账户吧～ 💰'); return; }
  const fromAcc = accounts.find(a => a.id === window._txState.accountId);
  if (!fromAcc) { toast('账户无效'); return; }

  if (type === 2) {
    if (!window._txState.toAccountId) { toast('选一个转入账户吧～ 💰'); return; }
    if (window._txState.toAccountId === window._txState.accountId) { toast('转出和转入不能相同哦～ 🔄'); return; }
  }

  const txData = {
    id: state.editingTx?.id || uid(),
    type,
    amount,
    categoryId: window._txState.categoryId || '',
    categoryName: window._txState.categoryName || '',
    categoryIcon: window._txState.categoryIcon || '💰',
    categoryColor: window._txState.categoryColor || 0xFF8FA3,
    accountId: window._txState.accountId,
    accountName: fromAcc.name,
    toAccountId: type === 2 ? window._txState.toAccountId : null,
    toAccountName: type === 2 ? accounts.find(a => a.id === window._txState.toAccountId)?.name : null,
    ledgerId: ledger.id,
    ledgerName: ledger.name,
    date: window._txState.date,
    note: note || null,
    createdBy: user.name,
    createdAt: state.editingTx?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  const txns = getTx();
  if (state.editingTx) {
    const idx = txns.findIndex(t => t.id === state.editingTx.id);
    if (idx >= 0) txns[idx] = txData;
  } else {
    txns.push(txData);
  }
  save(STORAGE_KEYS.tx, txns);
  closeModal();
  renderHome();
  debounceSync();
  toast(state.editingTx ? '修改成功！🌸' : '记账成功！🌸');
}

function editTx(id) { openAddTx(id); }

function deleteTx(id) {
  if (!confirm('确认删除？删除后不可恢复哦～')) return;
  const txns = getTx().filter(t => t.id !== id);
  save(STORAGE_KEYS.tx, txns);
  closeModal();
  renderHome();
  debounceSync();
  toast('已删除 🗑️');
}

// ========== 添加分类 ==========
function addCategoryDialog(type) {
  const emojis = ['🌟', '🍰', '🧋', '🍿', '🎈', '🎨', '🎸', '⚽', '🏊', '🚲', '🌱', '🌻', '🐶', '🐱', '🐰', '🦊'];
  let selectedEmoji = '🌟';

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">添加分类</div>
    <input class="field-input" id="newCatName" placeholder="分类名称" maxlength="6" style="margin-bottom:12px">
    <div class="section-label">选个图标</div>
    <div class="cat-grid" id="emojiGrid">
      ${emojis.map(e => `<div class="cat-item ${e === selectedEmoji ? 'selected' : ''}" onclick="selectEmoji(this,'${e}')"><div class="cat-emoji">${e}</div></div>`).join('')}
    </div>
    <button class="btn-primary" onclick="confirmAddCategory(${type})">添加</button>
    <button class="btn-outline" onclick="closeModal()">取消</button>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  window._newCatEmoji = '🌟';
}

function selectEmoji(el, emoji) {
  document.querySelectorAll('#emojiGrid .cat-item').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  window._newCatEmoji = emoji;
}

function confirmAddCategory(type) {
  const name = document.getElementById('newCatName').value.trim();
  if (!name) { toast('请输入分类名称'); return; }
  const cats = load(STORAGE_KEYS.categories);
  const newCat = {
    id: uid(), name, icon: window._newCatEmoji, color: 0xFF8FA3,
    type, sortOrder: cats.filter(c => c.type === type).length, isCustom: true,
  };
  cats.push(newCat);
  save(STORAGE_KEYS.categories, cats);
  debounceSync();
  toast('添加成功！🌸');

  // If modal was opened from quick record, refresh and open popup for new cat
  if (window._fromQuick) {
    window._fromQuick = false;
    closeModal();
    renderQuickRecord();
    openQuickPopup(newCat.id);
  } else {
    window._txState.categoryId = newCat.id;
    window._txState.categoryName = newCat.name;
    window._txState.categoryIcon = newCat.icon;
    window._txState.categoryColor = newCat.color;
    reopenTxModal();
  }
}

// ========== 删除分类列表 ==========
function showDeleteList(type) {
  const cats = getCategories(type).filter(c => c.isCustom);
  if (cats.length === 0) { toast('没有可删除的分类'); return; }

  let listHtml = cats.map(c =>
    `<div class="acc-item" onclick="closeModal();askDeleteCategory('${c.id}','${c.name}',1)">
      <div class="acc-icon" style="background:${colorHex(c.color)}20">${c.icon}</div>
      <div class="acc-info"><div class="acc-name">${c.name}</div></div>
      <span style="color:var(--text-3)">›</span>
    </div>`
  ).join('');

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">删除分类</div>
    <div style="font-size:12px;color:var(--text-2);margin-bottom:12px">选择要删除的分类（需确认 3 次）</div>
    ${listHtml}
    <button class="btn-outline" onclick="closeModal()" style="margin-top:12px">取消</button>
  `;
  document.getElementById('modalOverlay').classList.add('show');
}

// ========== 删除分类（三次确认）==========
function askDeleteCategory(catId, catName, step) {
  const messages = [
    `确定要删除「${catName}」吗？`,
    `删除后不可恢复！\n确定删除「${catName}」？`,
    `⚠️ 最后确认\n删除「${catName}」？`
  ];
  const btnLabels = ['删除', '确认删除', '彻底删除'];
  const btnColors = ['#FF8FA3', '#FF6B6B', '#E53E3E'];

  if (step > 3) {
    // 执行删除
    const cats = load(STORAGE_KEYS.categories).filter(c => c.id !== catId);
    save(STORAGE_KEYS.categories, cats);
    closeModal();
    renderQuickRecord();
    renderHome();
    debounceSync();
    toast(`「${catName}」已删除 🗑️`);
    return;
  }

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">删除分类</div>
    <div style="text-align:center;padding:16px 0;white-space:pre-line;font-size:15px;color:var(--text);line-height:1.6">
      ${messages[step - 1]}
    </div>
    <button class="btn-primary" onclick="askDeleteCategory('${catId}','${catName}',${step + 1})"
      style="background:${btnColors[step - 1]}">${btnLabels[step - 1]}</button>
    <button class="btn-outline" onclick="closeModal()">取消</button>
  `;
  document.getElementById('modalOverlay').classList.add('show');
}

// ========== 统计页面 ==========
function changeMonth(delta) {
  state.statsMonth += delta;
  if (state.statsMonth > 12) { state.statsMonth = 1; state.statsYear++; }
  if (state.statsMonth < 1) { state.statsMonth = 12; state.statsYear--; }
  renderStats();
}

function renderStats() {
  document.getElementById('statsMonthText').textContent = `${state.statsYear}年${state.statsMonth}月`;

  const startDate = new Date(state.statsYear, state.statsMonth - 1, 1).getTime();
  const endDate = new Date(state.statsYear, state.statsMonth, 1).getTime();
  const summary = getSummary(state.currentLedger, startDate, endDate);
  const catStats = getCategorySummary(state.currentLedger, startDate, endDate, 1);
  const incCatStats = getCategorySummary(state.currentLedger, startDate, endDate, 0);
  const dailyStats = getDailyStats(state.currentLedger, startDate, endDate);

  // 上月对比
  const prevStart = new Date(state.statsYear, state.statsMonth - 2, 1).getTime();
  const prevEnd = startDate;
  const prevSummary = getSummary(state.currentLedger, prevStart, prevEnd);

  let html = `
    <div class="stats-summary">
      <div class="stats-sum-item"><div class="stats-sum-emoji">💰</div><div class="stats-sum-label">收入</div><div class="stats-sum-val">${fmtMoney(summary.income)}</div></div>
      <div class="stats-sum-item"><div class="stats-sum-emoji">🛍️</div><div class="stats-sum-label">支出</div><div class="stats-sum-val">${fmtMoney(summary.expense)}</div></div>
      <div class="stats-sum-item"><div class="stats-sum-emoji">🌸</div><div class="stats-sum-label">结余</div><div class="stats-sum-val">${fmtMoney(summary.balance)}</div></div>
    </div>
  `;

  // ===== 智能洞察卡片 =====
  if (summary.expense > 0 || summary.income > 0) {
    const insights = [];

    // 支出对比上月
    if (prevSummary.expense > 0 && summary.expense > 0) {
      const diff = summary.expense - prevSummary.expense;
      const pct = Math.round(Math.abs(diff) / prevSummary.expense * 100);
      if (diff < 0) {
        insights.push({ emoji: '🎉', text: `比上月少花了 ¥${Math.abs(Math.round(diff))}，省钱小达人！`, bg: 'rgba(123,196,127,0.1)', color: 'var(--income)' });
      } else if (diff > 0) {
        insights.push({ emoji: '😅', text: `比上月多花了 ¥${Math.round(diff)}（+${pct}%），要注意哦`, bg: 'rgba(255,143,163,0.1)', color: 'var(--expense)' });
      } else {
        insights.push({ emoji: '👏', text: `支出和上月一模一样，保持得真好！`, bg: 'rgba(181,234,215,0.15)', color: 'var(--mint)' });
      }
    }

    // 日均支出
    const daysInMonth = new Date(state.statsYear, state.statsMonth, 0).getDate();
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === state.statsYear && (now.getMonth() + 1) === state.statsMonth;
    const elapsedDays = isCurrentMonth ? now.getDate() : daysInMonth;
    const dailyAvg = summary.expense / elapsedDays;
    if (dailyAvg > 0) {
      insights.push({ emoji: '📅', text: `日均支出 ¥${dailyAvg.toFixed(1)}，${dailyAvg > 200 ? '有点多哦～' : '控制得不错！'}`, bg: 'rgba(181,216,241,0.15)', color: '#5B9BD5' });
    }

    // 最大支出分类
    if (catStats.length) {
      const top = catStats[0];
      const topPct = Math.round(top.amount / summary.expense * 100);
      insights.push({ emoji: top.icon, text: `${top.categoryName}花得最多，占 ${topPct}%`, bg: `${colorHex(top.color)}15`, color: colorHex(top.color) });
    }

    // 储蓄率
    if (summary.income > 0) {
      const saveRate = Math.round((summary.balance / summary.income) * 100);
      if (saveRate >= 30) {
        insights.push({ emoji: '🐷', text: `储蓄率 ${saveRate}%，存钱小能手！`, bg: 'rgba(255,228,181,0.2)', color: '#E6A23C' });
      } else if (saveRate < 0) {
        insights.push({ emoji: '⚠️', text: `这个月入不敷出啦，要加油！`, bg: 'rgba(255,107,107,0.1)', color: 'var(--warning)' });
      }
    }

    insights.forEach(ins => {
      html += `<div class="insight-card" style="background:${ins.bg};color:${ins.color}">
        <span class="insight-emoji">${ins.emoji}</span>
        <span>${ins.text}</span>
      </div>`;
    });
  }

  // ===== 本周 vs 上周对比 =====
  if (summary.expense > 0) {
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === state.statsYear && (now.getMonth() + 1) === state.statsMonth;
    if (isCurrentMonth) {
      const weekStart = now.getDate() - now.getDay() + 1;
      const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), weekStart).getTime();
      const thisWeekEnd = thisWeekStart + 7 * 86400000;
      const lastWeekStart = thisWeekStart - 7 * 86400000;
      const thisWeekExp = getTx().filter(t => t.ledgerId === state.currentLedger && t.date >= thisWeekStart && t.date < thisWeekEnd && t.type === 1).reduce((s, t) => s + t.amount, 0);
      const lastWeekExp = getTx().filter(t => t.ledgerId === state.currentLedger && t.date >= lastWeekStart && t.date < thisWeekStart && t.type === 1).reduce((s, t) => s + t.amount, 0);
      const weekDiff = thisWeekExp - lastWeekExp;

      html += `<div class="chart-card">
        <div class="chart-title">📅 本周 vs 上周</div>
        <div class="week-compare">
          <div class="week-card last">
            <div class="week-card-label">上周支出</div>
            <div class="week-card-val" style="color:var(--text-2)">¥${Math.round(lastWeekExp)}</div>
            <div class="week-card-sub" style="color:var(--text-3)">📅 上7天</div>
          </div>
          <div class="week-card this">
            <div class="week-card-label">本周支出</div>
            <div class="week-card-val" style="color:var(--expense)">¥${Math.round(thisWeekExp)}</div>
            <div class="week-card-sub" style="color:${weekDiff < 0 ? 'var(--income)' : 'var(--expense)'}">${weekDiff < 0 ? '↓' : '↑'} ¥${Math.abs(Math.round(weekDiff))}</div>
          </div>
        </div>
      </div>`;
    }
  }

  // ===== 饼图 =====
  if (catStats.length) {
    const total = catStats.reduce((s, c) => s + c.amount, 0);
    const top = catStats.slice(0, 6);
    let cumulative = 0;
    const conicParts = top.map(c => {
      const pct = (c.amount / total) * 100;
      const start = cumulative;
      cumulative += pct;
      return `${colorHex(c.color)} ${start}% ${cumulative}%`;
    }).join(', ');
    const otherAmount = catStats.slice(6).reduce((s, c) => s + c.amount, 0);
    if (otherAmount > 0) {
      const pct = (otherAmount / total) * 100;
      conicParts += `, #E0E0E0 ${cumulative}% ${cumulative + pct}%`;
    }

    html += `<div class="chart-card">
      <div class="chart-title">🥧 支出分类 <span style="margin-left:auto;font-size:12px;color:var(--text-2);font-weight:400">共 ${fmtMoney(total)}</span></div>
      <div class="pie-wrap">
        <div class="pie" style="background: conic-gradient(${conicParts})">
          <div class="pie-center"><div class="pie-center-emoji">💸</div><div class="pie-center-label">总支出</div><div class="pie-center-val">¥${Math.round(total)}</div></div>
        </div>
        <div class="pie-legend">
          ${top.map(c => {
            const pct = Math.round(c.amount / total * 100);
            return `<div class="pie-legend-item">
              <div class="pie-legend-dot" style="background:${colorHex(c.color)}"></div>
              <span class="pie-legend-name">${c.icon} ${c.categoryName}</span>
              <span class="pie-legend-val">¥${Math.round(c.amount)}<span class="pie-legend-pct">${pct}%</span></span>
            </div>`;
          }).join('')}
          ${otherAmount > 0 ? `<div class="pie-legend-item"><div class="pie-legend-dot" style="background:#E0E0E0"></div><span class="pie-legend-name">其他</span><span class="pie-legend-val">¥${Math.round(otherAmount)}</span></div>` : ''}
        </div>
      </div>
    </div>`;
  }

  // ===== 每日趋势柱状图 =====
  if (dailyStats.length) {
    const daysInMonth = new Date(state.statsYear, state.statsMonth, 0).getDate();
    const dayMap = {};
    dailyStats.forEach(d => { dayMap[d.date.getDate()] = d.expense; });
    const maxVal = Math.max(...Array.from({length: daysInMonth}, (_, i) => dayMap[i+1] || 0), 1);
    const now = new Date();
    const today = (now.getFullYear() === state.statsYear && now.getMonth() + 1 === state.statsMonth) ? now.getDate() : -1;

    html += `<div class="chart-card">
      <div class="chart-title">📈 每日支出趋势</div>
      <div class="bar-chart">
        ${Array.from({length: daysInMonth}, (_, i) => {
          const day = i + 1;
          const val = dayMap[day] || 0;
          const h = (val / maxVal) * 100;
          const isToday = day === today;
          const gradient = val > maxVal * 0.7 ? 'linear-gradient(180deg, #FF6B6B, #FF8FA3)' : 'linear-gradient(180deg, #FF8FA3, #FFB3C6)';
          return `<div class="bar-col" title="${day}日: ¥${Math.round(val)}">
            <div class="bar ${isToday ? 'today' : ''}" style="height:${h}%;background:${gradient}"></div>
            ${day % 5 === 0 || day === 1 ? `<div class="bar-label">${day}</div>` : '<div class="bar-label"></div>'}
          </div>`;
        }).join('')}
      </div>
      ${today > 0 ? `<div style="text-align:center;font-size:11px;color:var(--text-3);margin-top:8px">📍 今天是 ${today} 日 · 今日已花 ¥${Math.round(dayMap[today] || 0)}</div>` : ''}
    </div>`;
  }

  // ===== 日历热力图 =====
  if (dailyStats.length) {
    const daysInMonth = new Date(state.statsYear, state.statsMonth, 0).getDate();
    const firstDay = new Date(state.statsYear, state.statsMonth - 1, 1).getDay();
    const dayMap = {};
    dailyStats.forEach(d => { dayMap[d.date.getDate()] = d.expense; });
    const maxDaily = Math.max(...Object.values(dayMap), 1);

    const weekLabels = ['日','一','二','三','四','五','六'];
    let weekLabelHtml = weekLabels.map(w => `<div class="cal-week-label">${w}</div>`).join('');
    let calCellsHtml = '';
    // 日期格子 - 第一天用 grid-column-start 定位，不使用空格占位
    for (let d = 1; d <= daysInMonth; d++) {
      const val = dayMap[d] || 0;
      let heatClass = '';
      if (val > 0) {
        const ratio = val / maxDaily;
        if (ratio > 0.75) heatClass = 'heat-4';
        else if (ratio > 0.5) heatClass = 'heat-3';
        else if (ratio > 0.25) heatClass = 'heat-2';
        else heatClass = 'heat-1';
      }
      const colStart = d === 1 ? `style="grid-column-start:${firstDay + 1}"` : '';
      calCellsHtml += `<div class="cal-cell ${heatClass}" ${colStart} title="${d}日: ¥${Math.round(val)}">${d}</div>`;
    }

    html += `<div class="chart-card">
      <div class="chart-title">🗓️ 支出日历 <span style="margin-left:auto;font-size:11px;color:var(--text-3);font-weight:400">颜色越深花得越多</span></div>
      <div class="cal-week-row">${weekLabelHtml}</div>
      <div class="cal-heatmap">${calCellsHtml}</div>
      <div class="cal-legend">
        少
        <div class="cal-legend-dot" style="background:#F5F5F5"></div>
        <div class="cal-legend-dot" style="background:rgba(255,143,163,0.15)"></div>
        <div class="cal-legend-dot" style="background:rgba(255,143,163,0.3)"></div>
        <div class="cal-legend-dot" style="background:rgba(255,143,163,0.5)"></div>
        <div class="cal-legend-dot" style="background:rgba(255,143,163,0.7)"></div>
        多
      </div>
    </div>`;
  }

  // ===== 分类排行 =====
  if (catStats.length) {
    const total = catStats.reduce((s, c) => s + c.amount, 0);
    const medals = ['🥇', '🥈', '🥉'];
    html += `<div class="chart-card">
      <div class="chart-title">🏆 支出排行榜</div>
      ${catStats.map((c, i) => {
        const pct = total > 0 ? (c.amount / total * 100) : 0;
        return `<div class="rank-item">
          <div class="${i < 3 ? 'rank-medal' : 'rank-num'}">${i < 3 ? medals[i] : (i+1)}</div>
          <div class="rank-info">
            <div class="rank-row"><span class="rank-name">${c.icon} ${c.categoryName}</span><span class="rank-amount">¥${c.amount.toFixed(2)}</span></div>
            <div class="rank-bar"><div class="rank-fill" style="width:${pct}%;background:${colorHex(c.color)}"></div></div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ===== 收入分类 =====
  if (incCatStats.length) {
    const incTotal = incCatStats.reduce((s, c) => s + c.amount, 0);
    html += `<div class="chart-card">
      <div class="chart-title">💚 收入来源 <span style="margin-left:auto;font-size:12px;color:var(--text-2);font-weight:400">共 ${fmtMoney(incTotal)}</span></div>
      ${incCatStats.map((c, i) => {
        const pct = incTotal > 0 ? (c.amount / incTotal * 100) : 0;
        return `<div class="rank-item">
          <div class="rank-num" style="color:var(--income)">${i+1}</div>
          <div class="rank-info">
            <div class="rank-row"><span class="rank-name">${c.icon} ${c.categoryName}</span><span class="rank-amount" style="color:var(--income)">+¥${c.amount.toFixed(2)}</span></div>
            <div class="rank-bar"><div class="rank-fill" style="width:${pct}%;background:${colorHex(c.color)}"></div></div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  if (!catStats.length && !incCatStats.length) {
    html += `<div class="chart-card"><div class="empty"><div class="empty-emoji">📊</div><div class="empty-title">本月还没有记录</div><div class="empty-sub">记一笔来看看分析吧～</div></div></div>`;
  }

  document.getElementById('statsContent').innerHTML = html;
}

// ========== 账户页面 ==========
function switchAccTab(tab) {
  state.accTab = tab;
  document.querySelectorAll('#page-accounts .tab-item').forEach((el, i) => el.classList.toggle('active', i === tab));
  document.getElementById('accTab0').style.display = tab === 0 ? 'block' : 'none';
  document.getElementById('accTab1').style.display = tab === 1 ? 'block' : 'none';
}

function renderAccounts() {
  // Accounts tab
  const accounts = getAccounts();
  const totalAssets = accounts.reduce((s, a) => s + getAccountBalance(a.id), 0);
  const totalInit = accounts.reduce((s, a) => s + (a.initialBalance || 0), 0);

  let accHtml = `
    <div class="acc-total-card">
      <div>
        <div class="acc-total-label">💰 总资产</div>
        <div class="acc-total-val">${fmtMoney(totalAssets)}</div>
      </div>
      <div style="font-size:36px;opacity:0.3">🌸</div>
    </div>
  `;
  accHtml += accounts.map(a => {
    const bal = getAccountBalance(a.id);
    return `<div class="acc-item">
      <div class="acc-icon" style="background:${colorHex(a.color)}20">${a.icon}</div>
      <div class="acc-info"><div class="acc-name">${a.name}</div><div class="acc-type">${['现金','银行卡','支付宝','微信','储蓄','信用卡','其他'][a.type]}</div></div>
      <div class="acc-balance" style="color:${bal >= 0 ? 'var(--text)' : 'var(--warning)'}">${fmtMoney(bal)}</div>
    </div>`;
  }).join('');
  accHtml += `<div style="padding:16px"><button class="btn-outline" onclick="addAccountDialog()">➕ 添加账户</button></div>`;
  document.getElementById('accTab0').innerHTML = accHtml;

  // Ledgers tab
  const ledgers = getLedgers();
  let ledHtml = `<div style="padding:12px 16px 8px;font-size:12px;color:var(--text-2);font-weight:600">📚 我的账本（${ledgers.length}）</div>`;
  ledHtml += ledgers.map(l => {
    const isCurrent = l.id === state.currentLedger;
    const ledgerTxns = getTx().filter(t => t.ledgerId === l.id);
    const ledgerExp = ledgerTxns.filter(t => t.type === 1).reduce((s, t) => s + t.amount, 0);
    const ledgerInc = ledgerTxns.filter(t => t.type === 0).reduce((s, t) => s + t.amount, 0);
    return `<div class="acc-item" onclick="setLedger('${l.id}');renderAccounts()">
      <div class="acc-icon" style="background:${colorHex(l.color)}20">${l.icon}</div>
      <div class="acc-info">
        <div class="acc-name">${l.name} ${isCurrent ? '<span style="color:var(--pink);font-size:11px">✨ 当前</span>' : ''}</div>
        <div class="acc-type">收 ¥${Math.round(ledgerInc)} · 支 ¥${Math.round(ledgerExp)} · ${ledgerTxns.length}笔</div>
      </div>
      <span style="color:var(--text-3)">›</span>
    </div>`;
  }).join('');
  ledHtml += `<div style="padding:16px"><button class="btn-outline" onclick="addLedgerDialog()">➕ 添加账本</button></div>`;
  document.getElementById('accTab1').innerHTML = ledHtml;
}

function addAccountDialog() {
  const presets = [
    { type: 0, name: '现金', icon: '💵', color: 0x7BC47F },
    { type: 1, name: '银行卡', icon: '💳', color: 0xB5D8F1 },
    { type: 2, name: '支付宝', icon: '💙', color: 0xB5EAD7 },
    { type: 3, name: '微信', icon: '💚', color: 0x80CBC4 },
    { type: 4, name: '储蓄', icon: '🏦', color: 0xFFE082 },
    { type: 5, name: '信用卡', icon: '💳', color: 0xE5738A },
  ];
  let selected = presets[0];

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">添加账户</div>
    <div class="section-label">选择类型</div>
    <div class="cat-grid" id="accTypeGrid">
      ${presets.map((p, i) => `<div class="cat-item ${i === 0 ? 'selected' : ''}" onclick="selectAccType(${i})" data-idx="${i}">
        <div class="cat-emoji">${p.icon}</div><div class="cat-name">${p.name}</div>
      </div>`).join('')}
    </div>
    <input class="field-input" id="newAccName" placeholder="账户名称" style="margin-top:12px">
    <input class="field-input" id="newAccBalance" type="number" placeholder="初始余额" style="margin-top:8px">
    <button class="btn-primary" onclick="confirmAddAccount()">添加</button>
    <button class="btn-outline" onclick="closeModal()">取消</button>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  window._accPresets = presets;
  window._selectedAccType = 0;
}

function selectAccType(idx) {
  document.querySelectorAll('#accTypeGrid .cat-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
  window._selectedAccType = idx;
  const preset = window._accPresets[idx];
  const nameInput = document.getElementById('newAccName');
  if (!nameInput.value) nameInput.value = preset.name;
}

function confirmAddAccount() {
  const name = document.getElementById('newAccName').value.trim();
  if (!name) { toast('请输入账户名称'); return; }
  const balance = parseFloat(document.getElementById('newAccBalance').value) || 0;
  const preset = window._accPresets[window._selectedAccType];
  const accounts = load(STORAGE_KEYS.accounts);
  accounts.push({
    id: uid(), name, type: preset.type, icon: preset.icon, color: preset.color,
    initialBalance: balance, sortOrder: accounts.length,
  });
  save(STORAGE_KEYS.accounts, accounts);
  closeModal();
  renderAccounts();
  debounceSync();
  toast('添加成功！🌸');
}

function addLedgerDialog() {
  const presets = [
    { name: '日常账本', icon: '📒', color: 0xFF8FA3 },
    { name: '旅行账本', icon: '✈️', color: 0xB5D8F1 },
    { name: '装修账本', icon: '🔨', color: 0xFFE082 },
    { name: '宝宝账本', icon: '🍼', color: 0xE0BBE4 },
  ];
  const emojis = ['📒', '✈️', '🔨', '🍼', '🐾', '🌸', '🎂', '💍', '🏖️', '🎓'];

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">添加账本</div>
    <div class="section-label">快速选择</div>
    <div class="cat-grid" id="ledgerPresetGrid">
      ${presets.map(p => `<div class="cat-item" onclick="document.getElementById('newLedgerName').value='${p.name}';window._ledgerEmoji='${p.icon}';window._ledgerColor=${p.color};document.querySelectorAll('#ledgerEmojiGrid .cat-item').forEach(c=>c.classList.remove('selected'));">
        <div class="cat-emoji">${p.icon}</div><div class="cat-name">${p.name}</div>
      </div>`).join('')}
    </div>
    <input class="field-input" id="newLedgerName" placeholder="账本名称" maxlength="10" style="margin-top:12px">
    <div class="section-label">选个图标</div>
    <div class="cat-grid" id="ledgerEmojiGrid">
      ${eopts(emojis)}
    </div>
    <button class="btn-primary" onclick="confirmAddLedger()">创建</button>
    <button class="btn-outline" onclick="closeModal()">取消</button>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  window._ledgerEmoji = '📒';
  window._ledgerColor = 0xFF8FA3;
}

function eopts(emojis) {
  return emojis.map((e, i) => `<div class="cat-item ${i === 0 ? 'selected' : ''}" onclick="selectLedgerEmoji(this,'${e}')"><div class="cat-emoji">${e}</div></div>`).join('');
}

function selectLedgerEmoji(el, emoji) {
  document.querySelectorAll('#ledgerEmojiGrid .cat-item').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  window._ledgerEmoji = emoji;
}

function confirmAddLedger() {
  const name = document.getElementById('newLedgerName').value.trim();
  if (!name) { toast('请输入账本名称'); return; }
  const ledgers = load(STORAGE_KEYS.ledgers);
  ledgers.push({
    id: uid(), name, icon: window._ledgerEmoji, color: window._ledgerColor,
    createdBy: 'local', members: [], sortOrder: ledgers.length,
  });
  save(STORAGE_KEYS.ledgers, ledgers);
  closeModal();
  renderAccounts();
  debounceSync();
  toast('创建成功！🌸');
}

// ========== 预算页面 (from home) ==========
function openBudgetPage() {
  const budgets = getBudgets(state.currentLedger);
  const expCats = getCategories(1);

  let html = `<div class="modal-handle"></div>
    <div class="modal-title">🎯 预算管理</div>`;

  if (budgets.length) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth()+1, 1).getTime();

    budgets.forEach(b => {
      const txns = getTx().filter(t => t.ledgerId === state.currentLedger && t.date >= start && t.date < end && t.type === 1 && (!b.categoryId || t.categoryId === b.categoryId));
      const used = txns.reduce((s, t) => s + t.amount, 0);
      const pct = b.amount > 0 ? Math.min(used / b.amount, 1) : 0;
      const isOver = used >= b.amount;
      const name = b.categoryId ? b.categoryName : '总预算';
      html += `
        <div class="budget-card" style="margin:0 0 8px">
          <div class="budget-row" style="font-size:14px;font-weight:600;margin-bottom:8px">
            <span>${isOver ? '⚠️' : '🎯'} ${name}</span>
            <span style="color:var(--text-2)">${['每周','每月','每年'][b.period] || '每月'}</span>
          </div>
          <div class="budget-row"><span style="color:${isOver?'var(--warning)':'var(--text)'};font-weight:600">已用 ¥${used.toFixed(2)}</span><span>预算 ¥${b.amount.toFixed(2)}</span></div>
          <div class="budget-bar" style="margin-top:6px"><div class="budget-fill" style="width:${pct*100}%;background:${isOver?'var(--warning)':'var(--pink)'}"></div></div>
          <div style="margin-top:4px;font-size:12px;color:${isOver?'var(--warning)':'var(--income)'}">${isOver ? '超支 ¥'+(used-b.amount).toFixed(2)+' 😱' : '剩余 ¥'+(b.amount-used).toFixed(2)+' 😊'}</div>
          <button onclick="deleteBudget('${b.id}')" style="color:var(--warning);background:none;font-size:12px;margin-top:8px;cursor:pointer">删除</button>
        </div>`;
    });
  } else {
    html += '<div class="empty"><div class="empty-emoji">🎯</div><div class="empty-title">还没有设置预算</div><div class="empty-sub">设置预算来控制消费吧～</div></div>';
  }

  // Add budget form
  const availableCats = expCats.filter(c => !budgets.find(b => b.categoryId === c.id));
  html += `
    <div class="section-label" style="margin-top:16px">设置新预算</div>
    <div class="cat-grid" id="budgetCatGrid">
      <div class="cat-item selected" onclick="selectBudgetCat(this,null)" data-cat=""><div class="cat-emoji">🎯</div><div class="cat-name">总预算</div></div>
      ${availableCats.map(c => `<div class="cat-item" onclick="selectBudgetCat(this,'${c.id}')" data-cat="${c.id}" data-name="${c.name}"><div class="cat-emoji">${c.icon}</div><div class="cat-name">${c.name}</div></div>`).join('')}
    </div>
    <div class="section-label">周期</div>
    <div class="tab-bar" id="budgetPeriodBar">
      <div class="tab-item" onclick="selectBudgetPeriod(0)">每周</div>
      <div class="tab-item active" onclick="selectBudgetPeriod(1)">每月</div>
      <div class="tab-item" onclick="selectBudgetPeriod(2)">每年</div>
    </div>
    <input class="field-input" id="budgetAmount" type="number" placeholder="预算金额 ¥">
    <button class="btn-primary" onclick="confirmAddBudget()">设置</button>
    <button class="btn-outline" onclick="closeModal()">关闭</button>
  `;

  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
  window._budgetCat = null;
  window._budgetCatName = null;
  window._budgetPeriod = 1;
}

function selectBudgetCat(el, catId) {
  document.querySelectorAll('#budgetCatGrid .cat-item').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  window._budgetCat = catId || null;
  window._budgetCatName = el.dataset.name || null;
}

function selectBudgetPeriod(period) {
  document.querySelectorAll('#budgetPeriodBar .tab-item').forEach((el, i) => el.classList.toggle('active', i === period));
  window._budgetPeriod = period;
}

function confirmAddBudget() {
  const amount = parseFloat(document.getElementById('budgetAmount').value);
  if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
  const budgets = load(STORAGE_KEYS.budgets);
  budgets.push({
    id: uid(), ledgerId: state.currentLedger,
    categoryId: window._budgetCat, categoryName: window._budgetCatName,
    amount, period: window._budgetPeriod, createdAt: Date.now(),
  });
  save(STORAGE_KEYS.budgets, budgets);
  closeModal();
  renderHome();
  toast('预算设置成功！🎯');
}

function deleteBudget(id) {
  const budgets = load(STORAGE_KEYS.budgets).filter(b => b.id !== id);
  save(STORAGE_KEYS.budgets, budgets);
  closeModal();
  renderHome();
  toast('已删除');
}

// ========== 云同步设置 ==========
function openSyncDialog() {
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">云同步 💫</div>
    <div style="font-size:12px;color:var(--text-2);margin-bottom:12px;line-height:1.5">
      两台手机输入同一个<b>同步密钥</b>，就能自动同步账单。<br>
      密钥可以是手机号、情侣暗号等任意文字。
    </div>
    <div class="section-label">GitHub Token</div>
    <input class="field-input" id="syncTokenInput" placeholder="ghp_xxxxxxxx" value="${syncToken}" style="margin-bottom:12px">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">
      Token 只存在本机，不上传。获取方式：GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → 勾选 gist 权限
    </div>
    <div class="section-label">同步密钥</div>
    <input class="field-input" id="syncKeyInput" placeholder="例如：老婆手机号" value="${syncKey}" style="margin-bottom:12px">
    <button class="btn-primary" onclick="saveSyncConfig()">保存并开启</button>
    <button class="btn-outline" onclick="closeModal()">取消</button>
    ${isSyncEnabled() ? `<button class="btn-outline" onclick="disableSync();closeModal();renderSettings();toast('已关闭同步')" style="margin-top:8px;color:var(--warning);border-color:var(--warning)">关闭同步</button>` : ''}
  `;
  document.getElementById('modalOverlay').classList.add('show');
}

async function saveSyncConfig() {
  const token = document.getElementById('syncTokenInput').value.trim();
  const key = document.getElementById('syncKeyInput').value.trim();
  if (!token) { toast('请输入 GitHub Token'); return; }
  if (!key) { toast('请输入同步密钥'); return; }

  syncToken = token;
  syncKey = key;
  localStorage.setItem('mz_sync_token', token);
  localStorage.setItem('mz_sync_key', key);

  toast('正在初始化同步... 🌸');
  await initSyncGist();
  if (gistId) {
    await syncDownload();
    closeModal();
    renderSettings();
    toast('云同步已开启！☁️');
  } else {
    toast('初始化失败，请检查 Token 和密钥');
  }
}

function disableSync() {
  localStorage.removeItem('mz_sync_token');
  localStorage.removeItem('mz_sync_key');
  localStorage.removeItem('mz_gist_id');
  syncToken = '';
  syncKey = '';
  gistId = '';
}

// ========== 设置页面 ==========
function renderSettings() {
  const user = getUser();
  const txns = getTx();
  const accounts = getAccounts();
  const ledgers = getLedgers();
  const cats = load(STORAGE_KEYS.categories);
  const now = new Date();
  const summary = getSummary(state.currentLedger, new Date(now.getFullYear(), now.getMonth(), 1).getTime(), new Date(now.getFullYear(), now.getMonth()+1, 1).getTime());

  document.getElementById('settingsContent').innerHTML = `
    <div class="settings-user">
      <span class="settings-avatar">${user.avatar}</span>
      <div style="flex:1">
        <div style="font-size:18px;font-weight:700">${user.name}</div>
        <div style="font-size:13px;opacity:0.8">蜜账用户 🌸</div>
      </div>
      <button onclick="editUserDialog()" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:50%;width:36px;height:36px;font-size:16px;cursor:pointer">✏️</button>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">云同步 💫</div>
      <div class="settings-group">
        <div class="settings-item" onclick="openSyncDialog()">
          <span class="settings-icon">${isSyncEnabled() ? '☁️' : '⛅'}</span>
          <div class="settings-text">
            <div class="settings-label">${isSyncEnabled() ? '云同步已开启' : '开启云同步'}</div>
            <div class="settings-sub">${isSyncEnabled() ? `密钥：${syncKey}` : '多台手机实时同步账单'}</div>
          </div>
          <span style="color:var(--text-3)">›</span>
        </div>
        ${isSyncEnabled() ? `<div class="settings-item" onclick="syncDownload();renderSettings();toast('手动同步完成 🌸')">
          <span class="settings-icon">🔄</span>
          <div class="settings-text"><div class="settings-label">立即同步</div><div class="settings-sub">拉取最新云端数据</div></div>
          <span style="color:var(--text-3)">›</span>
        </div>` : ''}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">数据管理</div>
      <div class="settings-group">
        <div class="settings-item" onclick="exportData()">
          <span class="settings-icon">📤</span>
          <div class="settings-text"><div class="settings-label">导出账单</div><div class="settings-sub">导出为 CSV / Excel 文件</div></div>
          <span style="color:var(--text-3)">›</span>
        </div>
        <div class="settings-item" onclick="openBudgetPage()">
          <span class="settings-icon">🎯</span>
          <div class="settings-text"><div class="settings-label">预算管理</div><div class="settings-sub">设置和管理预算</div></div>
          <span style="color:var(--text-3)">›</span>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">数据概览</div>
      <div class="settings-group">
        <div class="settings-item"><span class="settings-icon">📝</span><div class="settings-text"><div class="settings-label">记录总数</div></div><span style="font-weight:700">${txns.length} 条</span></div>
        <div class="settings-item"><span class="settings-icon">📒</span><div class="settings-text"><div class="settings-label">账本数量</div></div><span style="font-weight:700">${ledgers.length} 个</span></div>
        <div class="settings-item"><span class="settings-icon">💳</span><div class="settings-text"><div class="settings-label">账户数量</div></div><span style="font-weight:700">${accounts.length} 个</span></div>
        <div class="settings-item"><span class="settings-icon">🏷️</span><div class="settings-text"><div class="settings-label">分类数量</div></div><span style="font-weight:700">${cats.length} 个</span></div>
        <div class="settings-item"><span class="settings-icon">💰</span><div class="settings-text"><div class="settings-label">本月收入</div></div><span style="font-weight:700;color:var(--income)">${fmtMoney(summary.income)}</span></div>
        <div class="settings-item"><span class="settings-icon">🛍️</span><div class="settings-text"><div class="settings-label">本月支出</div></div><span style="font-weight:700;color:var(--expense)">${fmtMoney(summary.expense)}</span></div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">关于</div>
      <div class="settings-group">
        <div class="settings-item" onclick="toast('蜜账 v1.0.0 🌸\\n可爱清新的情侣共享记账 App\\n🐻 做你最喜欢用的记账小可爱')">
          <span class="settings-icon">🌸</span>
          <div class="settings-text"><div class="settings-label">关于蜜账</div><div class="settings-sub">v1.0.0 - 可爱清新记账</div></div>
          <span style="color:var(--text-3)">›</span>
        </div>
      </div>
    </div>

    <div style="text-align:center;padding:20px;font-size:12px;color:var(--text-3)">🐻 做你最喜欢用的记账小可爱 🌸</div>
  `;
}

function editUserDialog() {
  const user = getUser();
  const avatars = ['🐻', '🐱', '🐰', '🐼', '🦊', '🐨', '🐧', '🐥', '🦄', '🐯'];

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-title">编辑资料</div>
    <div class="section-label">选个头像</div>
    <div class="cat-grid" id="avatarGrid">
      ${avatars.map(a => `<div class="cat-item ${a === user.avatar ? 'selected' : ''}" onclick="selectAvatar(this,'${a}')"><div class="cat-emoji">${a}</div></div>`).join('')}
    </div>
    <input class="field-input" id="userName" placeholder="你的昵称" maxlength="8" value="${user.name}" style="margin-top:12px">
    <button class="btn-primary" onclick="confirmEditUser()">保存</button>
    <button class="btn-outline" onclick="closeModal()">取消</button>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  window._selectedAvatar = user.avatar;
}

function selectAvatar(el, avatar) {
  document.querySelectorAll('#avatarGrid .cat-item').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  window._selectedAvatar = avatar;
}

function confirmEditUser() {
  const name = document.getElementById('userName').value.trim() || '我的';
  const user = { ...getUser(), name, avatar: window._selectedAvatar };
  saveObj(STORAGE_KEYS.user, user);
  closeModal();
  renderSettings();
  toast('保存成功！🌸');
}

// ========== 导出 ==========
function exportData() {
  const txns = getTx().sort((a, b) => b.date - a.date);
  if (!txns.length) { toast('暂无数据可导出'); return; }

  let csv = '﻿日期,类型,分类,账户,金额,账本,备注,记录人\n';
  txns.forEach(t => {
    const typeStr = ['收入', '支出', '转账'][t.type];
    const dateStr = new Date(t.date).toLocaleString('zh-CN');
    const note = (t.note || '').replace(/,/g, '，');
    csv += `${dateStr},${typeStr},${t.categoryName},${t.accountName},${t.amount},${t.ledgerName},${note},${t.createdBy}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `蜜账导出_${fmtDate(Date.now())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('导出成功！🌸');
}

// ========== Modal ==========
function closeModal(e) {
  if (e && e.target.id !== 'modalOverlay') return;
  document.getElementById('modalOverlay').classList.remove('show');
  state.editingTx = null;
  // 关闭备注弹窗后，恢复防止键盘弹出的拦截
  window._allowFocus = false;
}

// ========== 初始化 ==========
function init() {
  // 全局监听：防止快速记账时系统键盘意外弹出
  document.addEventListener('focusin', (e) => {
    const quickPopup = document.getElementById('quickPopup');
    if (quickPopup && quickPopup.classList.contains('show')) {
      // 如果明确允许聚焦（如备注输入弹窗打开时），不拦截
      if (window._allowFocus) return;
      // 快速记账主弹窗打开时，禁止 INPUT/TEXTAREA 获得焦点，防止键盘弹出导致布局跳动
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        e.target.blur();
      }
    }
  }, true);

  ensureInit();
  state.currentLedger = loadObj(STORAGE_KEYS.currentLedger) || 'ledger_default';

  // 初始化云同步（如果已配置）
  initSyncGist().then(() => {
    syncDownload();
  });

  const removed = cleanOldData();
  if (removed > 0) debounceSync();
  renderHome();
  setTimeout(() => document.getElementById('loadingScreen').classList.add('hide'), 300);

  // 每 15 秒自动拉取云端最新数据（准实时同步）
  setInterval(syncDownload, 15000);

  // 页面从后台切回前台时立即同步
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncDownload();
  });

  // 每天清理一次过期数据
  setInterval(cleanOldData, 24 * 60 * 60 * 1000);
}

init();

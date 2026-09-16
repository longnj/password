function calculateStrength(length, variety) {
  var score = length * variety;
  if (score < 30) return { level: '弱', score: score };
  if (score < 60) return { level: '中等', score: score };
  return { level: '很强', score: score };
}
let entries = [];
let currentCategory = 'all';
let editingId = null;
let lastGeneratedPassword = '';

const ENTRY_TAGS = [
  '网站', 'SSH', 'MySQL', 'PostgreSQL', 'SQL Server', 'MongoDB', 'Redis', 'Oracle',
  'API', '邮箱', 'RDP', 'VNC', 'FTP', 'SFTP', 'Wi-Fi', '银行卡', '证件', '软件许可', '安全笔记', '自定义'
];
const TAG_DEFAULT_PORTS = {
  MySQL: 3306,
  PostgreSQL: 5432,
  'SQL Server': 1433,
  MongoDB: 27017,
  Redis: 6379,
  Oracle: 1521,
  SSH: 22,
  SFTP: 22,
  RDP: 3389,
  VNC: 5900,
  FTP: 21
};
const HOST_TAGS = new Set([
  'SSH', 'MySQL', 'PostgreSQL', 'SQL Server', 'MongoDB', 'Redis', 'Oracle',
  '邮箱', 'RDP', 'VNC', 'FTP', 'SFTP'
]);
let selectedTag = '网站';

// 初始化
async function init() {
  const exists = await window.vault.checkExists();
  if (!exists) {
    document.getElementById('login-title').textContent = '创建密码库';
    document.getElementById('login-subtitle').textContent = '设置一个主密码来保护你的密码';
    document.getElementById('first-time-section').style.display = 'block';
    document.getElementById('login-btn').textContent = '创建密码库';
  }
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('login-confirm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  document.querySelectorAll('.sidebar-item[data-category]').forEach((el) => {
    el.addEventListener('click', () => selectCategory(el));
  });
  initTagSelector();

  // 监听锁定事件
  window.vault.onLocked(() => {
    showPage('login-page');
    entries = [];
    document.getElementById('login-password').value = '';
    showToast('已自动锁定', 'success');
  });

  // 用户活动检测
  ['click', 'keydown', 'mousemove'].forEach((evt) => {
    document.addEventListener(evt, () => window.vault.activity(), { passive: true });
  });
}

async function handleLogin() {
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';

  if (!password) {
    showLoginError('请输入主密码');
    return;
  }

  const firstTimeSection = document.getElementById('first-time-section');
  if (firstTimeSection.style.display !== 'none') {
    const confirm = document.getElementById('login-confirm').value;
    if (password !== confirm) {
      showLoginError('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      showLoginError('主密码至少 6 位');
      return;
    }
    const result = await window.vault.create(password);
    if (result.success) {
      enterMainApp();
    } else {
      showLoginError('创建失败，请重试');
    }
    return;
  }

  const result = await window.vault.unlock(password);
  if (result.success) {
    enterMainApp();
  } else {
    showLoginError(result.error || '主密码错误');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function enterMainApp() {
  showPage('main-page');
  entries = await window.vault.getEntries();
  renderEntries();
  updateCounts();
}

function showPage(id) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function lockApp() {
  window.vault.lock();
}

function selectCategory(el) {
  document.querySelectorAll('.sidebar-item[data-category]').forEach((item) => {
    item.classList.remove('active');
  });
  el.classList.add('active');
  currentCategory = el.dataset.category;
  renderEntries();
}

function renderEntries() {
  const search = document.getElementById('search-input').value.toLowerCase();
  let filtered = entries;

  if (currentCategory === 'favorite') {
    filtered = filtered.filter((e) => e.favorite);
  } else if (currentCategory !== 'all') {
    filtered = filtered.filter((e) => e.category === currentCategory);
  }

  if (search) {
    filtered = filtered.filter((e) =>
      (e.name || '').toLowerCase().includes(search) ||
      (e.username || '').toLowerCase().includes(search) ||
      (e.url || '').toLowerCase().includes(search) ||
      (e.host || '').toLowerCase().includes(search) ||
      (e.tag || '').toLowerCase().includes(search)
    );
  }

  const list = document.getElementById('password-list');
  const emptyState = document.getElementById('empty-state');

  if (filtered.length === 0) {
    list.innerHTML = '';
    if (entries.length === 0) {
      emptyState.style.display = 'flex';
    } else {
      emptyState.style.display = 'none';
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">没有匹配的密码条目</div>';
    }
  } else {
    emptyState.style.display = 'none';
    list.innerHTML = filtered.map((e) => entryHtml(e)).join('');
  }

  document.getElementById('status-info').textContent = entries.length + ' 条密码';
}

function getFavicon(name) {
  const first = (name || '?')[0].toUpperCase();
  const colors = ['#24292e', '#07c160', '#ff6a00', '#0052cc', '#1e80ff', '#171717', '#8b5cf6', '#ec4899'];
  const idx = (name || '').charCodeAt(0) % colors.length;
  const color = colors[idx];
  return '<div class="favicon" style="background:' + color + '">' + first + '</div>';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function entryHtml(e) {
  const favIcon = e.favorite ? '<span class="item-fav">⭐</span>' : '';
  const displayTag = e.tag || '网站';
  const tagHtml = '<span class="item-tag">' + escapeHtml(displayTag) + '</span>';
  const connection = e.host
    ? e.host + (e.port ? ':' + e.port : '')
    : '';
  const address = e.url || connection;
  const metaParts = [e.username || '', address].filter(Boolean);

  return '<div class="password-item">' +
    getFavicon(e.name) +
    '<div class="item-info">' +
      '<div class="item-name">' + escapeHtml(e.name) + ' ' + favIcon + '</div>' +
      '<div class="item-meta">' +
        metaParts.map((part) => '<span>' + escapeHtml(part) + '</span>').join('<span>·</span>') +

      '</div>' +
      '<div class="item-tags">' + tagHtml + '</div>' +
    '</div>' +
    '<div class="item-actions">' +
      '<button class="icon-btn" title="复制密码" onclick="copyEntryPassword(\'' + e.id + '\')">📋</button>' +
      '<button class="icon-btn" title="编辑" onclick="openEditModal(\'' + e.id + '\')">✏️</button>' +
      '<button class="icon-btn" title="收藏" onclick="toggleFavorite(\'' + e.id + '\')">' + (e.favorite ? '★' : '☆') + '</button>' +
      '<button class="icon-btn" title="删除" onclick="deleteEntry(\'' + e.id + '\')">🗑</button>' +
    '</div>' +
  '</div>';
}

async function copyEntryPassword(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  await window.vault.copyPassword(entry.password);
  showToast('密码已复制，30 秒后自动清空', 'success');
}

async function toggleFavorite(id) {
  const result = await window.vault.toggleFavorite(id);
  if (result.success) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx !== -1) entries[idx] = result.entry;
    renderEntries();
    updateCounts();
  } else {
    showToast(result.error || '操作失败', 'error');
  }
}

function getEntryTag(entry) {
  return entry && ENTRY_TAGS.includes(entry.tag) ? entry.tag : '网站';
}

function initTagSelector() {
  const select = document.getElementById('edit-tag');
  select.innerHTML = ENTRY_TAGS.map((tag) => '<option value="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</option>').join('');
  select.addEventListener('change', () => {
    selectedTag = select.value;
    updateTagDrivenFields(true, true);
  });
}

function getDefaultPort(tag) {
  return TAG_DEFAULT_PORTS[tag] || '';
}

function updateTagDrivenFields(fillDefaultPort, overwriteDefaultPort) {
  const usesHost = HOST_TAGS.has(selectedTag);
  document.getElementById('edit-url-group').style.display = usesHost ? 'none' : '';
  document.getElementById('edit-connection-row').style.display = usesHost ? '' : 'none';
  document.getElementById('edit-url-label').textContent = selectedTag === 'API' ? '服务地址' : '网址';

  const portInput = document.getElementById('edit-port');
  if (fillDefaultPort && usesHost && (overwriteDefaultPort || !portInput.value)) {
    portInput.value = getDefaultPort(selectedTag);
  }
}

function openEditModal(id) {
  editingId = id || null;
  const entry = id ? entries.find((e) => e.id === id) : null;
  document.getElementById('edit-modal-title').textContent = entry ? '编辑密码' : '添加新密码';
  document.getElementById('edit-name').value = entry ? entry.name : '';
  document.getElementById('edit-url').value = entry ? entry.url : '';
  document.getElementById('edit-host').value = entry ? entry.host : '';
  document.getElementById('edit-port').value = entry && entry.port != null ? entry.port : '';
  document.getElementById('edit-username').value = entry ? entry.username : '';
  document.getElementById('edit-category').value = entry ? entry.category : '工作';
  document.getElementById('edit-password').value = entry ? entry.password : '';
  document.getElementById('edit-notes').value = entry ? entry.notes : '';
  selectedTag = getEntryTag(entry);
  document.getElementById('edit-tag').value = selectedTag;
  updateTagDrivenFields(true);
  document.getElementById('edit-modal').style.display = 'flex';
  document.getElementById('edit-name').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingId = null;
}

async function saveEntry() {
  const name = document.getElementById('edit-name').value.trim();
  if (!name) {
    showToast('请输入名称', 'error');
    return;
  }

  const password = document.getElementById('edit-password').value;
  if (!password) {
    showToast('请输入密码', 'error');
    return;
  }

  const portValue = document.getElementById('edit-port').value.trim();
  if (portValue && (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535)) {
    showToast('端口必须在 1-65535 之间', 'error');
    return;
  }

  const entry = {
    id: editingId || undefined,
    name: name,
    url: document.getElementById('edit-url').value.trim(),
    host: HOST_TAGS.has(selectedTag) ? document.getElementById('edit-host').value.trim() : '',
    port: HOST_TAGS.has(selectedTag) ? portValue : '',
    username: document.getElementById('edit-username').value.trim(),
    category: document.getElementById('edit-category').value,
    password: password,
    tag: selectedTag,
    notes: document.getElementById('edit-notes').value.trim(),
    favorite: editingId ? (entries.find((e) => e.id === editingId) || {}).favorite || false : false,
  };

  const result = await window.vault.saveEntry(entry);
  if (result.success) {
    if (editingId) {
      const idx = entries.findIndex((e) => e.id === editingId);
      if (idx !== -1) entries[idx] = result.entry;
    } else {
      entries.push(result.entry);
    }
    renderEntries();
    updateCounts();
    closeEditModal();
    showToast(editingId ? '已更新' : '已添加', 'success');
  } else {
    showToast(result.error || '保存失败', 'error');
  }
}

async function deleteEntry(id) {
  if (!confirm('确定删除这条密码吗？此操作不可撤销。')) return;
  const result = await window.vault.deleteEntry(id);
  if (result.success) {
    entries = entries.filter((e) => e.id !== id);
    renderEntries();
    updateCounts();
    showToast('已删除', 'success');
  } else {
    showToast(result.error || '删除失败', 'error');
  }
}

function updateCounts() {
  document.getElementById('count-all').textContent = entries.length;
  ['工作', '个人', '金融', '娱乐'].forEach((cat) => {
    const el = document.getElementById('count-' + cat);
    if (el) el.textContent = entries.filter((e) => e.category === cat).length;
  });
  document.getElementById('count-favorite').textContent = entries.filter((e) => e.favorite).length;
}

// 密码生成器
function openGeneratorModal() {
  document.getElementById('generator-modal').style.display = 'flex';
  regenerate();
}

function closeGeneratorModal() {
  document.getElementById('generator-modal').style.display = 'none';
}

function updateGenLength(val) {
  document.getElementById('length-value').textContent = val;
  regenerate();
}

async function regenerate() {
  const options = {
    length: parseInt(document.getElementById('gen-length').value),
    uppercase: document.getElementById('opt-upper').checked,
    lowercase: document.getElementById('opt-lower').checked,
    numbers: document.getElementById('opt-num').checked,
    symbols: document.getElementById('opt-sym').checked,
  };
  const pw = await window.vault.generatePassword(options);
  lastGeneratedPassword = pw;
  document.getElementById('gen-output').textContent = pw;
  const variety = [options.uppercase, options.lowercase, options.numbers, options.symbols].filter(Boolean).length;
  const strength = calculateStrength(options.length, variety);
  const fill = document.getElementById('strength-fill');
  const label = document.getElementById('strength-label');
  if (strength.level === '弱') {
    fill.style.width = '30%'; fill.style.background = 'var(--danger)';
    label.innerHTML = '强度：<strong style="color:var(--danger)">弱</strong>';
  } else if (strength.level === '中等') {
    fill.style.width = '60%'; fill.style.background = 'var(--warning)';
    label.innerHTML = '强度：<strong style="color:var(--warning)">中等</strong>';
  } else {
    fill.style.width = '90%'; fill.style.background = 'var(--success)';
    label.innerHTML = '强度：<strong style="color:var(--success)">很强</strong>';
  }
}

async function copyGenerated() {
  if (!lastGeneratedPassword) return;
  await window.vault.copyPassword(lastGeneratedPassword);
  showToast('已复制，30 秒后自动清空', 'success');
}

function useGeneratedPassword() {
  if (!lastGeneratedPassword) return;
  document.getElementById('edit-password').value = lastGeneratedPassword;
  closeGeneratorModal();
  showToast('已填入密码框', 'success');
}

async function fillGeneratedPassword() {
  openGeneratorModal();
}

// 设置
function showSettings() {
  document.getElementById('settings-modal').style.display = 'flex';
  document.getElementById('settings-old-pw').value = '';
  document.getElementById('settings-new-pw').value = '';
  document.getElementById('settings-confirm-pw').value = '';
  document.getElementById('settings-error').style.display = 'none';
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

async function changeMasterPassword() {
  const oldPw = document.getElementById('settings-old-pw').value;
  const newPw = document.getElementById('settings-new-pw').value;
  const confirmPw = document.getElementById('settings-confirm-pw').value;
  const errEl = document.getElementById('settings-error');

  if (!oldPw || !newPw) {
    errEl.textContent = '请填写所有字段';
    errEl.style.display = 'block';
    return;
  }
  if (newPw !== confirmPw) {
    errEl.textContent = '两次新密码不一致';
    errEl.style.display = 'block';
    return;
  }
  if (newPw.length < 6) {
    errEl.textContent = '新密码至少 6 位';
    errEl.style.display = 'block';
    return;
  }
  const result = await window.vault.changeMasterPassword(oldPw, newPw);
  if (result.success) {
    closeSettings();
    showToast('主密码已修改', 'success');
  } else {
    errEl.textContent = result.error || '修改失败';
    errEl.style.display = 'block';
  }
}

// 导入/导出
async function exportData() {
  const result = await window.vault.exportData();
  if (result.success) {
    showToast('已导出到：' + result.path, 'success');
  } else if (!result.canceled) {
    showToast(result.error || '导出失败', 'error');
  }
}

function showImportDialog() {
  document.getElementById('import-modal').style.display = 'flex';
  document.getElementById('import-password').value = '';
  document.getElementById('import-error').style.display = 'none';
}

function closeImport() {
  document.getElementById('import-modal').style.display = 'none';
}

async function performImport() {
  const password = document.getElementById('import-password').value;
  if (!password) {
    const errEl = document.getElementById('import-error');
    errEl.textContent = '请输入主密码';
    errEl.style.display = 'block';
    return;
  }
  const result = await window.vault.importData(password);
  if (result.success) {
    entries = result.data.entries;
    renderEntries();
    updateCounts();
    closeImport();
    if (document.getElementById('main-page').classList.contains('active')) {
      showToast('导入成功，共 ' + entries.length + ' 条密码', 'success');
    } else {
      enterMainApp();
      showToast('导入成功，共 ' + entries.length + ' 条密码', 'success');
    }
  } else if (!result.canceled) {
    const errEl = document.getElementById('import-error');
    errEl.textContent = result.error || '导入失败';
    errEl.style.display = 'block';
  }
}

// 工具函数
function togglePasswordField(id, btn) {
  const input = document.getElementById(id);
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

let toastTimer = null;
function showToast(msg, type) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show ' + (type || '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 2500);
}

// 启动
init();

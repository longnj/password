const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const crypto = require('./crypto');
const {
  getUnlockState,
  recordFailedUnlock,
  recordSuccessfulUnlock,
  validateVaultData
} = require('./vault-policy');
const { writeVaultFileAtomically } = require('./storage');

const ENTRY_TAGS = new Set([
  '网站', 'SSH', 'MySQL', 'PostgreSQL', 'SQL Server', 'MongoDB', 'Redis', 'Oracle',
  'API', '邮箱', 'RDP', 'VNC', 'FTP', 'SFTP', 'Wi-Fi', '银行卡', '证件', '软件许可', '安全笔记', '自定义'
]);

function formatLockedError(retryAfterMs) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `尝试次数过多，请 ${seconds} 秒后重试`;
}

function normalizeOptionalText(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeTag(value) {
  if (value === undefined || value === null || value === '') return '网站';
  if (typeof value !== 'string') return null;

  const tag = value.trim();
  return ENTRY_TAGS.has(tag) ? tag : null;
}

function normalizePort(value) {
  if (value === undefined || value === null || value === '') return { value: null };

  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { invalid: true };
  }
  return { value: port };
}

function createEntryForSave(entry, existing, timestamp) {
  const name = normalizeOptionalText(entry.name).trim();
  const password = normalizeOptionalText(entry.password);
  if (!name || !password) {
    return { error: '条目格式不正确' };
  }

  const tag = normalizeTag(entry.tag);
  if (tag === null) {
    return { error: '不支持的标签' };
  }

  const port = normalizePort(entry.port);
  if (port.invalid) {
    return { error: '端口必须在 1-65535 之间' };
  }

  return {
    entry: {
      id: entry.id,
      name,
      url: normalizeOptionalText(entry.url),
      host: normalizeOptionalText(entry.host).trim(),
      port: port.value,
      username: normalizeOptionalText(entry.username),
      password,
      category: normalizeOptionalText(entry.category),
      tag,
      notes: normalizeOptionalText(entry.notes),
      favorite: Boolean(entry.favorite),
      createdAt: existing ? existing.createdAt : timestamp,
      updatedAt: timestamp
    }
  };
}

function createVaultService({
  filePath,
  writeFile = writeVaultFileAtomically,
  now = Date.now
}) {
  let vaultData = null;
  let masterPassword = null;
  let unlockFailureState = { failedAttempts: 0, lockedUntil: 0 };

  function isUnlocked() {
    return Boolean(vaultData && masterPassword);
  }

  function lock() {
    vaultData = null;
    masterPassword = null;
  }

  function getData() {
    return vaultData === null ? null : structuredClone(vaultData);
  }

  function persist(nextVaultData, password = masterPassword) {
    if (typeof password !== 'string' || password.length < 6) {
      return { success: false, error: '主密码至少 6 位' };
    }

    const validation = validateVaultData(nextVaultData);
    if (!validation.valid) {
      return {
        success: false,
        error: `密码库数据损坏：${validation.error}`
      };
    }

    let encrypted;
    try {
      encrypted = crypto.encrypt(validation.value, password);
    } catch (error) {
      return {
        success: false,
        error: `无法加密密码库：${error.message}`
      };
    }

    try {
      writeFile(filePath, encrypted);
    } catch (error) {
      return {
        success: false,
        error: `无法写入密码库文件：${error.message}`
      };
    }

    vaultData = validation.value;
    masterPassword = password;
    return { success: true, data: vaultData };
  }

  function unlock(password) {
    const currentTime = now();
    const unlockState = getUnlockState(unlockFailureState, currentTime);
    if (unlockState.locked) {
      return {
        success: false,
        error: formatLockedError(unlockState.retryAfterMs),
        locked: true,
        retryAfterMs: unlockState.retryAfterMs
      };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: '密码库文件不存在' };
    }

    let decrypted;
    try {
      decrypted = crypto.decrypt(fs.readFileSync(filePath), password);
    } catch {
      unlockFailureState = recordFailedUnlock(unlockFailureState, currentTime);
      const failedState = getUnlockState(unlockFailureState, currentTime);
      if (failedState.locked) {
        return {
          success: false,
          error: formatLockedError(failedState.retryAfterMs),
          locked: true,
          retryAfterMs: failedState.retryAfterMs
        };
      }

      return {
        success: false,
        error: '主密码错误',
        locked: false
      };
    }

    const validation = validateVaultData(decrypted);
    if (!validation.valid) {
      return {
        success: false,
        error: `密码库数据损坏：${validation.error}`
      };
    }

    vaultData = validation.value;
    masterPassword = password;
    unlockFailureState = recordSuccessfulUnlock();
    return { success: true, data: vaultData };
  }

  function create(password) {
    const createdAt = new Date(now()).toISOString();
    return persist({ version: 1, entries: [], createdAt }, password);
  }

  function saveEntry(entry, timestamp = now()) {
    if (!isUnlocked()) return { success: false, error: '未解锁' };
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { success: false, error: '条目格式不正确' };
    }

    const updatedAt = new Date(timestamp).toISOString();
    if (Number.isNaN(Date.parse(updatedAt))) {
      return { success: false, error: '条目时间格式不正确' };
    }

    const nextData = getData();
    const existingIndex = entry.id
      ? nextData.entries.findIndex((current) => current.id === entry.id)
      : -1;

    if (entry.id && existingIndex === -1) {
      return { success: false, error: '条目不存在' };
    }

    const normalizedResult = createEntryForSave(
      entry,
      existingIndex === -1 ? null : nextData.entries[existingIndex],
      updatedAt
    );
    if (normalizedResult.error) {
      return { success: false, error: normalizedResult.error };
    }
    const normalizedEntry = normalizedResult.entry;

    if (existingIndex === -1) {
      normalizedEntry.id = nodeCrypto.randomUUID();
      nextData.entries.push(normalizedEntry);
    } else {
      nextData.entries[existingIndex] = normalizedEntry;
    }

    const result = persist(nextData);
    if (!result.success) return result;
    return { success: true, entry: normalizedEntry };
  }

  function deleteEntry(id) {
    if (!isUnlocked()) return { success: false, error: '未解锁' };

    const nextData = getData();
    const nextEntries = nextData.entries.filter((entry) => entry.id !== id);
    if (nextEntries.length === nextData.entries.length) {
      return { success: false, error: '条目不存在' };
    }

    nextData.entries = nextEntries;
    return persist(nextData);
  }

  function toggleFavorite(id) {
    if (!isUnlocked()) return { success: false, error: '未解锁' };

    const nextData = getData();
    const entry = nextData.entries.find((current) => current.id === id);
    if (!entry) return { success: false, error: '条目不存在' };

    entry.favorite = !entry.favorite;
    entry.updatedAt = new Date(now()).toISOString();
    const result = persist(nextData);
    if (!result.success) return result;
    return { success: true, entry };
  }

  function changeMasterPassword(oldPassword, newPassword) {
    if (!isUnlocked()) return { success: false, error: '未解锁' };
    if (oldPassword !== masterPassword) {
      return { success: false, error: '原密码不正确' };
    }
    return persist(getData(), newPassword);
  }

  function importEncrypted(encryptedBackup, backupPassword) {
    let decrypted;
    try {
      decrypted = crypto.decrypt(encryptedBackup, backupPassword);
    } catch {
      return { success: false, error: '解密失败，备份主密码可能不正确' };
    }

    const validation = validateVaultData(decrypted);
    if (!validation.valid) {
      return {
        success: false,
        error: `密码库数据损坏：${validation.error}`
      };
    }

    return persist(validation.value, backupPassword);
  }

  function exportEncrypted() {
    if (!isUnlocked()) return { success: false, error: '未解锁' };
    try {
      return { success: true, data: crypto.encrypt(getData(), masterPassword) };
    } catch (error) {
      return { success: false, error: `无法导出密码库：${error.message}` };
    }
  }

  return {
    isUnlocked,
    lock,
    getData,
    save: persist,
    unlock,
    create,
    saveEntry,
    deleteEntry,
    toggleFavorite,
    changeMasterPassword,
    importEncrypted,
    exportEncrypted
  };
}

module.exports = {
  createVaultService
};

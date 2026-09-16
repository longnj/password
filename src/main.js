const { app, BrowserWindow, ipcMain, dialog, clipboard, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('./crypto');
const { createVaultService } = require('./vault-service');

let mainWindow = null;
let vaultService = null;
let vaultFilePath = null;
let lockTimer = null;
const IDLE_TIMEOUT = 5 * 60 * 1000;
const CLIPBOARD_CLEAR_DELAY = 30 * 1000;

function getVaultPath() {
  if (!vaultFilePath) {
    vaultFilePath = path.join(app.getPath('userData'), 'passvault.enc');
  }
  return vaultFilePath;
}

function getVaultService() {
  if (!vaultService) {
    vaultService = createVaultService({ filePath: getVaultPath() });
  }
  return vaultService;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  resetLockTimer();
}

function lockVault() {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
  getVaultService().lock();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vault-locked');
  }
}

function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(lockVault, IDLE_TIMEOUT);
}

function ensureVaultExists() {
  return fs.existsSync(getVaultPath());
}

app.whenReady().then(() => {
  createWindow();

  // powerMonitor 只能在 Electron ready 后使用。
  powerMonitor.on('suspend', lockVault);
  powerMonitor.on('lock-screen', lockVault);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ===== IPC 处理 =====

ipcMain.handle('vault:check-exists', () => {
  return ensureVaultExists();
});

ipcMain.handle('vault:create', (event, password) => {
  if (ensureVaultExists()) {
    return { success: false, error: '密码库已存在，请直接解锁' };
  }

  const result = getVaultService().create(password);
  if (result.success) resetLockTimer();
  return result;
});

ipcMain.handle('vault:unlock', (event, password) => {
  const result = getVaultService().unlock(password);
  if (result.success) resetLockTimer();
  return result;
});

ipcMain.handle('vault:lock', () => {
  lockVault();
  return { success: true };
});

ipcMain.handle('vault:get-entries', () => {
  const service = getVaultService();
  if (!service.isUnlocked()) return [];
  return service.getData().entries;
});

ipcMain.handle('vault:save-entry', (event, entry) => {
  const result = getVaultService().saveEntry(entry);
  if (result.success) resetLockTimer();
  return result;
});

ipcMain.handle('vault:delete-entry', (event, id) => {
  const result = getVaultService().deleteEntry(id);
  if (result.success) resetLockTimer();
  return result;
});

ipcMain.handle('vault:toggle-favorite', (event, id) => {
  const result = getVaultService().toggleFavorite(id);
  if (result.success) resetLockTimer();
  return result;
});

ipcMain.handle('vault:generate-password', (event, options) => {
  return crypto.generatePassword(options);
});

ipcMain.handle('vault:copy-password', (event, password) => {
  clipboard.writeText(password);
  setTimeout(() => {
    if (clipboard.readText() === password) {
      clipboard.clear();
    }
  }, CLIPBOARD_CLEAR_DELAY);
  resetLockTimer();
  return { success: true };
});

ipcMain.handle('vault:export', async () => {
  const service = getVaultService();
  const exported = service.exportEncrypted();
  if (!exported.success) return exported;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出密码库',
    defaultPath: `passvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: '加密备份文件', extensions: ['json'] }]
  });
  if (result.canceled) return { success: false, canceled: true };

  try {
    fs.writeFileSync(result.filePath, exported.data, { mode: 0o600 });
  } catch (error) {
    return { success: false, error: `无法写入备份文件：${error.message}` };
  }

  resetLockTimer();
  return { success: true, path: result.filePath };
});

ipcMain.handle('vault:import', async (event, password) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入密码库',
    filters: [{ name: '加密备份文件', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return { success: false, canceled: true };

  let encryptedBackup;
  try {
    encryptedBackup = fs.readFileSync(result.filePaths[0]);
  } catch (error) {
    return { success: false, error: `无法读取备份文件：${error.message}` };
  }

  const imported = getVaultService().importEncrypted(encryptedBackup, password);
  if (imported.success) resetLockTimer();
  return imported;
});

ipcMain.handle('vault:change-master-password', (event, oldPassword, newPassword) => {
  const result = getVaultService().changeMasterPassword(oldPassword, newPassword);
  if (result.success) resetLockTimer();
  return result;
});

ipcMain.handle('vault:activity', () => {
  if (getVaultService().isUnlocked()) {
    resetLockTimer();
  }
  return { success: true };
});

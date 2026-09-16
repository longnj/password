const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vault', {
  checkExists: () => ipcRenderer.invoke('vault:check-exists'),
  create: (password) => ipcRenderer.invoke('vault:create', password),
  unlock: (password) => ipcRenderer.invoke('vault:unlock', password),
  lock: () => ipcRenderer.invoke('vault:lock'),
  getEntries: () => ipcRenderer.invoke('vault:get-entries'),
  saveEntry: (entry) => ipcRenderer.invoke('vault:save-entry', entry),
  deleteEntry: (id) => ipcRenderer.invoke('vault:delete-entry', id),
  toggleFavorite: (id) => ipcRenderer.invoke('vault:toggle-favorite', id),
  generatePassword: (options) => ipcRenderer.invoke('vault:generate-password', options),
  copyPassword: (password) => ipcRenderer.invoke('vault:copy-password', password),
  exportData: () => ipcRenderer.invoke('vault:export'),
  importData: (password) => ipcRenderer.invoke('vault:import', password),
  changeMasterPassword: (oldPw, newPw) => ipcRenderer.invoke('vault:change-master-password', oldPw, newPw),
  activity: () => ipcRenderer.invoke('vault:activity'),
  onLocked: (callback) => ipcRenderer.on('vault-locked', callback),
});

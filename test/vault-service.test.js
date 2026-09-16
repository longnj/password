const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('../src/crypto');

const servicePath = path.resolve(__dirname, '..', 'src', 'vault-service.js');
assert.equal(
  fs.existsSync(servicePath),
  true,
  '应提供 vault-service 模块集中处理解锁、验证与持久化'
);

const { createVaultService } = require(servicePath);

function createTestVault(fileName = 'passvault.enc') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passvault-service-'));
  return { root, filePath: path.join(root, fileName) };
}

test('unlock locks for one minute after five wrong passwords and then allows a correct retry', () => {
  const { root, filePath } = createTestVault();
  const vault = { version: 1, entries: [], createdAt: '2026-09-16T00:00:00.000Z' };
  fs.writeFileSync(filePath, crypto.encrypt(vault, 'correct-master'));
  let currentTime = 1_800_000_000_000;
  const service = createVaultService({ filePath, now: () => currentTime });
  const messages = [];

  try {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      currentTime += attempt * 1000;
      const result = service.unlock('wrong-master');
      assert.deepEqual(
        { success: result.success, locked: result.locked },
        { success: false, locked: false }
      );
      assert.equal(result.error, '主密码错误');
    }

    currentTime += 5000;
    const fifth = service.unlock('wrong-master');
    assert.equal(fifth.success, false);
    assert.equal(fifth.locked, true);
    assert.equal(fifth.retryAfterMs, 60000);
    messages.push(fifth.error);

    const lockedCorrect = service.unlock('correct-master');
    assert.equal(lockedCorrect.success, false);
    assert.equal(lockedCorrect.locked, true);
    assert.equal(lockedCorrect.retryAfterMs, 60000);
    messages.push(lockedCorrect.error);

    currentTime += 60000;
    const unlocked = service.unlock('correct-master');
    assert.equal(unlocked.success, true);
    assert.deepEqual(unlocked.data, vault);
    assert.equal(service.isUnlocked(), true);
    assert.equal(messages.every((message) => message.includes('60 秒')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unlock reports malformed decrypted vault data without treating it as a wrong password', () => {
  const { root, filePath } = createTestVault();
  fs.writeFileSync(filePath, crypto.encrypt({ version: 2, entries: [] }, 'correct-master'));
  const service = createVaultService({ filePath });

  try {
    const result = service.unlock('correct-master');

    assert.equal(result.success, false);
    assert.equal(result.error, '密码库数据损坏：密码库版本不受支持');
    assert.equal(service.isUnlocked(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('create writes a valid encrypted vault and reports write failures', () => {
  const { root, filePath } = createTestVault();
  const startedAt = 1_800_000_100_000;
  const service = createVaultService({
    filePath,
    now: () => startedAt,
    writeFile: () => {
      throw new Error('disk-full');
    }
  });

  try {
    const failed = service.create('master-password');
    assert.equal(failed.success, false);
    assert.equal(failed.error, '无法写入密码库文件：disk-full');
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(service.isUnlocked(), false);

    const writableService = createVaultService({ filePath, now: () => startedAt });
    const created = writableService.create('master-password');
    assert.equal(created.success, true);
    assert.deepEqual(created.data, {
      version: 1,
      entries: [],
      createdAt: new Date(startedAt).toISOString()
    });
    assert.deepEqual(crypto.decrypt(fs.readFileSync(filePath), 'master-password'), created.data);
    assert.equal(writableService.isUnlocked(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save only switches memory to the next vault after the encrypted file is written', () => {
  const { root, filePath } = createTestVault();
  const firstVault = { version: 1, entries: [], createdAt: '2026-09-16T00:00:00.000Z' };
  const nextVault = {
    version: 1,
    entries: [{ id: 'entry-1', name: 'GitHub' }],
    createdAt: firstVault.createdAt
  };
  fs.writeFileSync(filePath, crypto.encrypt(firstVault, 'master-password'));
  const written = [];
  const service = createVaultService({
    filePath,
    writeFile: (target, bytes) => {
      written.push({ target, bytes });
    }
  });

  try {
    assert.equal(service.unlock('master-password').success, true);

    const failedSave = service.save({ ...nextVault, version: 2 }, 'master-password');
    assert.equal(failedSave.success, false);
    assert.equal(failedSave.error, '密码库数据损坏：密码库版本不受支持');
    assert.deepEqual(service.getData(), firstVault);
    assert.equal(written.length, 0);

    const failingService = createVaultService({
      filePath,
      writeFile: () => {
        throw new Error('disk-full');
      }
    });
    failingService.unlock('master-password');
    const failedWrite = failingService.save(nextVault, 'master-password');
    assert.equal(failedWrite.success, false);
    assert.equal(failedWrite.error, '无法写入密码库文件：disk-full');
    assert.deepEqual(failingService.getData(), firstVault);

    const saved = service.save(nextVault, 'master-password');
    assert.equal(saved.success, true);
    assert.deepEqual(service.getData(), nextVault);
    assert.equal(written.length, 1);
    assert.equal(written[0].target, filePath);
    assert.deepEqual(crypto.decrypt(written[0].bytes, 'master-password'), nextVault);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save can reuse the current session master password after unlock', () => {
  const { root, filePath } = createTestVault();
  const firstVault = { version: 1, entries: [], createdAt: '2026-09-16T00:00:00.000Z' };
  const nextVault = { ...firstVault, entries: [{ id: 'entry-1', name: 'GitHub' }] };
  fs.writeFileSync(filePath, crypto.encrypt(firstVault, 'master-password'));
  const written = [];
  const service = createVaultService({
    filePath,
    writeFile: (target, bytes) => written.push({ target, bytes })
  });

  try {
    service.unlock('master-password');
    const result = service.save(nextVault);

    assert.equal(result.success, true);
    assert.deepEqual(crypto.decrypt(written[0].bytes, 'master-password'), nextVault);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saveEntry rejects malformed entries before touching the vault file', () => {
  const { root, filePath } = createTestVault();
  let rejectWrites = false;
  const service = createVaultService({
    filePath,
    now: () => 1_800_000_200_000,
    writeFile: (target, bytes) => {
      if (rejectWrites) throw new Error('write should not be called');
      fs.writeFileSync(target, bytes);
    }
  });

  try {
    service.create('master-password');
    rejectWrites = true;
    assert.equal(typeof service.saveEntry, 'function', '应提供 saveEntry 方法');
    const invalid = service.saveEntry(null);

    assert.equal(invalid.success, false);
    assert.equal(invalid.error, '条目格式不正确');
    assert.deepEqual(service.getData().entries, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saveEntry creates and updates entries with stable timestamps', () => {
  const { root, filePath } = createTestVault();
  const service = createVaultService({ filePath, writeFile: () => {} });

  try {
    service.create('master-password');
    const createdAt = new Date(1_800_000_300_000).toISOString();

    assert.equal(typeof service.saveEntry, 'function', '应提供 saveEntry 方法');
    const created = service.saveEntry(
      { name: ' GitHub ', username: 'chen', password: 'secret', category: '工作' },
      createdAt
    );
    assert.equal(created.success, true);
    assert.match(created.entry.id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(
      { ...created.entry, id: 'generated' },
      {
        id: 'generated',
        name: 'GitHub',
        username: 'chen',
        password: 'secret',
        category: '工作',
        notes: '',
        url: '',
        favorite: false,
        createdAt,
        updatedAt: createdAt
      }
    );

    const updatedAt = new Date(1_800_000_400_000).toISOString();
    const updated = service.saveEntry(
      { ...created.entry, name: 'GitHub Production', password: 'new-secret' },
      updatedAt
    );
    assert.equal(updated.success, true);
    assert.equal(updated.entry.createdAt, createdAt);
    assert.equal(updated.entry.updatedAt, updatedAt);
    assert.deepEqual(
      service.getData().entries.map((entry) => entry.name),
      ['GitHub Production']
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deleteEntry removes an existing entry and reports missing ids', () => {
  const { root, filePath } = createTestVault();
  const service = createVaultService({ filePath, writeFile: () => {} });

  try {
    service.create('master-password');
    rejectWrites = true;
    assert.equal(typeof service.saveEntry, 'function', '应提供 saveEntry 方法');
    const entry = service.saveEntry({ name: 'GitHub', password: 'secret' }, '2026-09-16T00:00:00.000Z').entry;
    const missing = service.deleteEntry('missing');

    assert.equal(missing.success, false);
    assert.equal(missing.error, '条目不存在');

    const deleted = service.deleteEntry(entry.id);
    assert.equal(deleted.success, true);
    assert.deepEqual(service.getData().entries, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('toggleFavorite flips an existing entry and reports missing ids', () => {
  const { root, filePath } = createTestVault();
  const service = createVaultService({ filePath, writeFile: () => {} });

  try {
    service.create('master-password');
    rejectWrites = true;
    assert.equal(typeof service.saveEntry, 'function', '应提供 saveEntry 方法');
    const entry = service.saveEntry({ name: 'GitHub', password: 'secret' }, '2026-09-16T00:00:00.000Z').entry;
    const missing = service.toggleFavorite('missing');

    assert.equal(missing.success, false);
    assert.equal(missing.error, '条目不存在');

    const toggled = service.toggleFavorite(entry.id);
    assert.equal(toggled.success, true);
    assert.equal(toggled.entry.favorite, true);
    assert.equal(service.getData().entries[0].favorite, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('changeMasterPassword verifies the old password before writing a new encrypted vault', () => {
  const { root, filePath } = createTestVault();
  const vault = { version: 1, entries: [], createdAt: '2026-09-16T00:00:00.000Z' };
  fs.writeFileSync(filePath, crypto.encrypt(vault, 'old-master'));
  const written = [];
  const service = createVaultService({
    filePath,
    writeFile: (target, bytes) => written.push({ target, bytes })
  });

  try {
    service.unlock('old-master');
    assert.equal(typeof service.changeMasterPassword, 'function', '应提供 changeMasterPassword 方法');
    const wrongOld = service.changeMasterPassword('wrong-old', 'new-master');
    assert.equal(wrongOld.success, false);
    assert.equal(wrongOld.error, '原密码不正确');
    assert.equal(written.length, 0);

    const changed = service.changeMasterPassword('old-master', 'new-master');
    assert.equal(changed.success, true);
    assert.deepEqual(crypto.decrypt(written[0].bytes, 'new-master'), vault);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('importEncrypted validates backup passwords and data before replacing the vault', () => {
  const { root, filePath } = createTestVault();
  const current = { version: 1, entries: [], createdAt: '2026-09-16T00:00:00.000Z' };
  const backup = {
    version: 1,
    entries: [{ id: 'entry-1', name: 'GitHub', password: 'secret' }],
    createdAt: '2026-09-15T00:00:00.000Z'
  };
  fs.writeFileSync(filePath, crypto.encrypt(current, 'current-master'));
  const written = [];
  const service = createVaultService({
    filePath,
    writeFile: (target, bytes) => written.push({ target, bytes })
  });

  try {
    service.unlock('current-master');
    assert.equal(typeof service.importEncrypted, 'function', '应提供 importEncrypted 方法');
    const wrongPassword = service.importEncrypted(crypto.encrypt(backup, 'backup-master'), 'wrong-master');
    assert.equal(wrongPassword.success, false);
    assert.equal(wrongPassword.error, '解密失败，备份主密码可能不正确');

    const malformed = service.importEncrypted(crypto.encrypt({ version: 2, entries: [] }, 'backup-master'), 'backup-master');
    assert.equal(malformed.success, false);
    assert.equal(malformed.error, '密码库数据损坏：密码库版本不受支持');
    assert.deepEqual(service.getData(), current);
    assert.equal(written.length, 0);

    const imported = service.importEncrypted(crypto.encrypt(backup, 'backup-master'), 'backup-master');
    assert.equal(imported.success, true);
    assert.deepEqual(service.getData(), backup);
    assert.deepEqual(crypto.decrypt(written[0].bytes, 'backup-master'), backup);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});



test('exportEncrypted returns the current vault encrypted with its active master password', () => {
  const { root, filePath } = createTestVault();
  const vault = { version: 1, entries: [{ id: 'entry-1', name: 'GitHub' }], createdAt: '2026-09-16T00:00:00.000Z' };
  fs.writeFileSync(filePath, crypto.encrypt(vault, 'master-password'));
  const service = createVaultService({ filePath });

  try {
    assert.equal(typeof service.exportEncrypted, 'function', '应提供 exportEncrypted 方法');
    const locked = service.exportEncrypted();
    assert.equal(locked.success, false);
    assert.equal(locked.error, '未解锁');

    service.unlock('master-password');
    const exported = service.exportEncrypted();
    assert.equal(exported.success, true);
    assert.deepEqual(crypto.decrypt(exported.data, 'master-password'), vault);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


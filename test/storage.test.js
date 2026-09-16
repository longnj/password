const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const storagePath = path.resolve(__dirname, '..', 'src', 'storage.js');
assert.equal(
  fs.existsSync(storagePath),
  true,
  '应提供 storage 模块承载密码库原子写入'
);

const { writeVaultFileAtomically } = require(storagePath);

test('writeVaultFileAtomically creates directories, writes bytes, and removes temporary files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passvault-storage-'));
  const target = path.join(root, 'userData', 'nested', 'passvault.enc');
  const bytes = Buffer.from([1, 2, 3, 4, 5]);

  try {
    writeVaultFileAtomically(target, bytes);

    assert.equal(fs.readFileSync(target).equals(bytes), true);
    assert.equal(fs.readdirSync(path.dirname(target)).includes('passvault.enc'), true);
    assert.equal(
      fs.readdirSync(path.dirname(target)).some((name) => name.endsWith('.tmp')),
      false
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeVaultFileAtomically keeps the old vault when writing the temporary file fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passvault-storage-'));
  const target = path.join(root, 'passvault.enc');
  const oldBytes = Buffer.from('old-vault');

  try {
    fs.writeFileSync(target, oldBytes);
    const failingFs = {
      ...fs,
      writeFileSync: () => {
        throw new Error('disk-full');
      }
    };

    assert.throws(
      () => writeVaultFileAtomically(target, Buffer.from('new-vault'), failingFs),
      /disk-full/
    );

    assert.equal(fs.readFileSync(target).equals(oldBytes), true);
    assert.equal(
      fs.readdirSync(root).some((name) => name.endsWith('.tmp')),
      false
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

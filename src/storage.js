const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function writeVaultFileAtomically(filePath, bytes, fileSystem = fs) {
  const directory = path.dirname(filePath);
  fileSystem.mkdirSync(directory, { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fileSystem.writeFileSync(temporaryPath, bytes, { mode: 0o600 });
    fileSystem.renameSync(temporaryPath, filePath);
  } catch (error) {
    fileSystem.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

module.exports = {
  writeVaultFileAtomically
};

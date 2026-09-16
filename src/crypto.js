const crypto = require('crypto');

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

function deriveKey(masterPassword, salt) {
  return crypto.pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

function encrypt(data, masterPassword) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterPassword, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

function decrypt(encryptedBuffer, masterPassword) {
  const salt = encryptedBuffer.subarray(0, SALT_LENGTH);
  const iv = encryptedBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const key = deriveKey(masterPassword, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

function verifyMasterPassword(encryptedBuffer, masterPassword) {
  try {
    decrypt(encryptedBuffer, masterPassword);
    return true;
  } catch {
    return false;
  }
}

function generatePassword(options = {}) {
  const {
    length = 18,
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true
  } = options;
  let chars = '';
  if (uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
  if (numbers) chars += '0123456789';
  if (symbols) chars += '!@#$%^&*';
  if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz';
  const randomBytes = crypto.randomBytes(length);
  const result = [];
  for (let i = 0; i < length; i++) {
    result.push(chars[randomBytes[i] % chars.length]);
  }
  return result.join('');
}

function calculateStrength(length, variety) {
  const score = length * variety;
  if (score < 30) return { level: '弱', score };
  if (score < 60) return { level: '中等', score };
  return { level: '很强', score };
}

module.exports = {
  encrypt,
  decrypt,
  verifyMasterPassword,
  generatePassword,
  calculateStrength,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  IV_LENGTH,
  AUTH_TAG_LENGTH
};


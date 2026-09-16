const assert = require('assert');
const { encrypt, decrypt, verifyMasterPassword, generatePassword, calculateStrength } = require('../src/crypto');

console.log('Running crypto tests...\n');

// 测试1: 加密-解密往返
const data = { version: 1, entries: [{ id: '1', name: 'GitHub', password: 'secret123' }] };
const encrypted = encrypt(data, 'myMasterPassword');
const decrypted = decrypt(encrypted, 'myMasterPassword');
assert.deepStrictEqual(decrypted, data, '往返解密应得到原始数据');
console.log('  ✓ 加密-解密往返成功');

// 测试2: 错误密码应失败
assert.throws(() => decrypt(encrypted, 'wrongPassword'), '错误密码应抛出异常');
console.log('  ✓ 错误密码被拒绝');

// 测试3: verifyMasterPassword
assert.strictEqual(verifyMasterPassword(encrypted, 'myMasterPassword'), true, '正确密码应验证通过');
assert.strictEqual(verifyMasterPassword(encrypted, 'wrongPassword'), false, '错误密码应验证失败');
console.log('  ✓ 主密码验证正确');

// 测试4: 每次加密结果不同（随机 salt + iv）
const encrypted2 = encrypt(data, 'myMasterPassword');
assert.notStrictEqual(encrypted.toString('hex'), encrypted2.toString('hex'), '两次加密结果应不同');
console.log('  ✓ 每次加密结果不同（随机 salt/iv）');

// 测试5: 密码生成器
const pw = generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true });
assert.strictEqual(pw.length, 20, '生成的密码长度应为 20');
console.log('  ✓ 密码生成器: ' + pw);

// 测试6: 只用小写字母
const pwLower = generatePassword({ length: 10, uppercase: false, lowercase: true, numbers: false, symbols: false });
assert.strictEqual(pwLower.length, 10);
assert.match(pwLower, /^[a-z]+$/, '应只包含小写字母');
console.log('  ✓ 仅小写字母: ' + pwLower);

// 测试7: 强度计算
assert.strictEqual(calculateStrength(8, 1).level, '弱');
assert.strictEqual(calculateStrength(12, 3).level, '中等');
assert.strictEqual(calculateStrength(18, 4).level, '很强');
console.log('  ✓ 强度计算正确');

console.log('\n全部测试通过! ✓');

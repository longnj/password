const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policyPath = path.resolve(__dirname, '..', 'src', 'vault-policy.js');
assert.equal(
  fs.existsSync(policyPath),
  true,
  '应提供 vault-policy 模块承载密码库结构与登录失败策略'
);

const {
  validateVaultData,
  getUnlockState,
  recordFailedUnlock,
  recordSuccessfulUnlock,
  MAX_FAILED_UNLOCK_ATTEMPTS,
  UNLOCK_LOCK_DURATION_MS
} = require(policyPath);

test('validateVaultData accepts a valid vault and normalizes metadata', () => {
  const input = { version: 1, entries: [], createdAt: '2026-09-16T00:00:00.000Z' };
  const result = validateVaultData(input);

  assert.deepEqual(result, {
    valid: true,
    value: {
      version: 1,
      entries: [],
      createdAt: '2026-09-16T00:00:00.000Z'
    }
  });
});

test('validateVaultData rejects malformed vault containers and entries', () => {
  const invalidValues = [
    null,
    'not-an-object',
    { version: 2, entries: [] },
    { version: 1, entries: 'not-an-array' },
    { version: 1, entries: [null] }
  ];

  for (const value of invalidValues) {
    const result = validateVaultData(value);
    assert.equal(result.valid, false, JSON.stringify(value));
    assert.equal(typeof result.error, 'string');
    assert.notEqual(result.error, '');
  }
});

test('unlock failures lock for one minute after five consecutive mistakes', () => {
  const startedAt = 1_800_000_000_000;
  let state = { failedAttempts: 0, lockedUntil: 0 };

  for (let attempt = 1; attempt < MAX_FAILED_UNLOCK_ATTEMPTS; attempt += 1) {
    state = recordFailedUnlock(state, startedAt + attempt);
    assert.deepEqual(state, { failedAttempts: attempt, lockedUntil: 0 });
    assert.equal(getUnlockState(state, startedAt + attempt).locked, false);
  }

  state = recordFailedUnlock(state, startedAt + MAX_FAILED_UNLOCK_ATTEMPTS);
  assert.equal(state.failedAttempts, MAX_FAILED_UNLOCK_ATTEMPTS);
  assert.equal(state.lockedUntil, startedAt + MAX_FAILED_UNLOCK_ATTEMPTS + UNLOCK_LOCK_DURATION_MS);
  assert.equal(getUnlockState(state, startedAt + MAX_FAILED_UNLOCK_ATTEMPTS).locked, true);

  const stillLocked = getUnlockState(state, state.lockedUntil - 1);
  assert.equal(stillLocked.locked, true);
  assert.equal(stillLocked.retryAfterMs, 1);

  const unlocked = getUnlockState(state, state.lockedUntil);
  assert.equal(unlocked.locked, false);
});

test('successful unlock clears the failure state', () => {
  const state = recordSuccessfulUnlock({ failedAttempts: 4, lockedUntil: 0 });

  assert.deepEqual(state, { failedAttempts: 0, lockedUntil: 0 });
});

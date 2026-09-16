const MAX_FAILED_UNLOCK_ATTEMPTS = 5;
const UNLOCK_LOCK_DURATION_MS = 60 * 1000;
const EMPTY_UNLOCK_STATE = { failedAttempts: 0, lockedUntil: 0 };

function validateVaultData(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: '密码库格式不正确' };
  }

  if (data.version !== 1) {
    return { valid: false, error: '密码库版本不受支持' };
  }

  if (!Array.isArray(data.entries)) {
    return { valid: false, error: '密码库条目格式不正确' };
  }

  if (data.entries.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) {
    return { valid: false, error: '密码库条目格式不正确' };
  }

  return {
    valid: true,
    value: {
      version: 1,
      entries: data.entries,
      createdAt: data.createdAt
    }
  };
}

function normalizeUnlockState(state) {
  return {
    failedAttempts: Number.isFinite(state?.failedAttempts) ? state.failedAttempts : 0,
    lockedUntil: Number.isFinite(state?.lockedUntil) ? state.lockedUntil : 0
  };
}

function getUnlockState(state, now = Date.now()) {
  const normalized = normalizeUnlockState(state);
  if (normalized.lockedUntil > now) {
    return {
      ...normalized,
      locked: true,
      retryAfterMs: normalized.lockedUntil - now
    };
  }

  return { ...normalized, locked: false, retryAfterMs: 0 };
}

function recordFailedUnlock(state, now = Date.now()) {
  const normalized = normalizeUnlockState(state);
  const failedAttempts = normalized.failedAttempts + 1;

  if (failedAttempts >= MAX_FAILED_UNLOCK_ATTEMPTS) {
    return {
      failedAttempts,
      lockedUntil: now + UNLOCK_LOCK_DURATION_MS
    };
  }

  return { failedAttempts, lockedUntil: 0 };
}

function recordSuccessfulUnlock() {
  return { ...EMPTY_UNLOCK_STATE };
}

module.exports = {
  MAX_FAILED_UNLOCK_ATTEMPTS,
  UNLOCK_LOCK_DURATION_MS,
  validateVaultData,
  getUnlockState,
  recordFailedUnlock,
  recordSuccessfulUnlock
};

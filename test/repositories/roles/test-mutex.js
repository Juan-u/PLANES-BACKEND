const protectedTransactions = new WeakSet();

export function markProtectedTestTransaction(tx) {
  if (!tx || typeof tx !== 'object') throw new TypeError('Test transaction must be an object.');
  protectedTransactions.add(tx);
  return tx;
}

export const testMutex = Object.freeze({
  assertHeld(tx) {
    if (!protectedTransactions.has(tx)) {
      const error = new Error('Test transaction has no mutex protection.');
      error.name = 'AuthorizationMutexRepositoryError';
      error.code = 'MUTEX_REQUIRED';
      throw error;
    }
  }
});

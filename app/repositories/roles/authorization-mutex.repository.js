export class AuthorizationMutexRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthorizationMutexRepositoryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AuthorizationMutexRepositoryError(code, message);
}

function requireTransaction(tx) {
  if (!tx || typeof tx !== 'object' ||
      typeof tx.execute !== 'function' || typeof tx.query !== 'function') {
    fail('TRANSACTION_REQUIRED', 'A transaction with query() and execute() is required.');
  }
}

function readMutexRow(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    fail('INVALID_PERSISTENCE_RESULT', 'The transaction returned an invalid mysql2 result.');
  }

  const rows = result[0];
  if (rows.length === 0) {
    fail('MUTEX_ROW_MISSING', 'The persistent authorization mutex row is missing.');
  }
  if (rows.length !== 1 ||
      !(rows[0].mutex_id === 1 || rows[0].mutex_id === '1')) {
    fail('MUTEX_ROW_INVALID', 'The persistent authorization mutex must return exactly mutex_id = 1.');
  }
}

/**
 * Provides a transaction-scoped mutex lease for the persistent authorization gate.
 * The row lock belongs to the supplied transaction and is released only by its
 * transaction manager on commit or rollback. This repository never commits,
 * rolls back, acquires connections, or creates the mutex row.
 */
export function createAuthorizationMutexRepository() {
  const leases = new WeakMap();
  const activeTransactions = new WeakSet();

  function assertHeld(tx) {
    const lease = tx && typeof tx === 'object' ? leases.get(tx) : undefined;
    if (!lease || !lease.active) {
      fail('MUTEX_REQUIRED', 'The transaction has no active authorization mutex lease.');
    }
  }

  async function withLock(tx, work) {
    requireTransaction(tx);
    if (typeof work !== 'function') {
      fail('INVALID_MUTEX_WORK', 'Mutex work must be a function.');
    }
    if (activeTransactions.has(tx)) {
      fail('MUTEX_ALREADY_ACQUIRED', 'The authorization mutex is already active for this transaction.');
    }

    activeTransactions.add(tx);
    let lease;
    try {
      const result = await tx.execute(
        'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE'
      );
      readMutexRow(result);

      lease = { active: true };
      const protectedTx = Object.freeze({
        query: (...args) => {
          if (!lease.active) fail('MUTEX_LEASE_EXPIRED', 'The protected transaction is outside the mutex work scope.');
          return tx.query(...args);
        },
        execute: (...args) => {
          if (!lease.active) fail('MUTEX_LEASE_EXPIRED', 'The protected transaction is outside the mutex work scope.');
          return tx.execute(...args);
        }
      });
      leases.set(protectedTx, lease);

      return await work(protectedTx);
    } finally {
      if (lease) lease.active = false;
      activeTransactions.delete(tx);
    }
  }

  return Object.freeze({ withLock, assertHeld });
}

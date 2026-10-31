import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthorizationMutexRepositoryError,
  createAuthorizationMutexRepository
} from '../../../app/repositories/roles/authorization-mutex.repository.js';

const LOCK_SQL = 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE';

function makeTx({ result = [[{ mutex_id: 1 }], []], executeError = null } = {}) {
  const calls = [];
  const tx = {
    async execute(sql, params) {
      calls.push({ method: 'execute', sql, params });
      if (executeError) throw executeError;
      return result;
    },
    async query(sql, params) {
      calls.push({ method: 'query', sql, params });
      return [[{ value: 'queried' }], []];
    }
  };
  return { tx, calls };
}

test('acquires the persistent mutex and returns the work result', async () => {
  const repo = createAuthorizationMutexRepository();
  const { tx, calls } = makeTx();
  let workCalled = false;

  const result = await repo.withLock(tx, async (protectedTx) => {
    workCalled = true;
    repo.assertHeld(protectedTx);
    return { ok: true };
  });

  assert.equal(workCalled, true);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ method: 'execute', sql: LOCK_SQL, params: undefined }]);
});

test('fails closed when the mutex row is missing', async () => {
  const repo = createAuthorizationMutexRepository();
  const { tx, calls } = makeTx({ result: [[], []] });
  let workCalled = false;

  await assert.rejects(
    repo.withLock(tx, async () => { workCalled = true; }),
    (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'MUTEX_ROW_MISSING'
  );
  assert.equal(workCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, LOCK_SQL);
});

test('rejects an invalid mutex result instead of continuing', async () => {
  const repo = createAuthorizationMutexRepository();
  const { tx } = makeTx({ result: [[{ mutex_id: 1 }, { mutex_id: 1 }], []] });
  let workCalled = false;

  await assert.rejects(
    repo.withLock(tx, async () => { workCalled = true; }),
    (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'MUTEX_ROW_INVALID'
  );
  assert.equal(workCalled, false);
});

test('propagates a mutex query error unchanged', async () => {
  const repo = createAuthorizationMutexRepository();
  const original = new Error('query failed');
  const { tx } = makeTx({ executeError: original });

  await assert.rejects(repo.withLock(tx, async () => assert.fail('work must not run')), (error) => error === original);
});

test('rejects a transaction without query and execute before querying', async () => {
  const repo = createAuthorizationMutexRepository();
  let called = false;

  await assert.rejects(
    repo.withLock({ execute: async () => { called = true; } }, async () => {}),
    (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'TRANSACTION_REQUIRED'
  );
  assert.equal(called, false);
});

test('protected facade forwards query and execute through the supplied transaction', async () => {
  const repo = createAuthorizationMutexRepository();
  const { tx, calls } = makeTx();

  await repo.withLock(tx, async (protectedTx) => {
    repo.assertHeld(protectedTx);
    assert.deepEqual(await protectedTx.query('SELECT value', []), [[{ value: 'queried' }], []]);
    await protectedTx.execute('UPDATE example SET value = ?', ['x']);
  });

  assert.deepEqual(calls.map(({ method, sql, params }) => ({ method, sql, params })), [
    { method: 'execute', sql: LOCK_SQL, params: undefined },
    { method: 'query', sql: 'SELECT value', params: [] },
    { method: 'execute', sql: 'UPDATE example SET value = ?', params: ['x'] }
  ]);
});

test('rejects a transaction without the mutex', () => {
  const repo = createAuthorizationMutexRepository();
  const { tx } = makeTx();

  assert.throws(
    () => repo.assertHeld(tx),
    (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'MUTEX_REQUIRED'
  );
});

test('invalidates the facade and rejects reuse outside its work scope', async () => {
  const repo = createAuthorizationMutexRepository();
  const { tx } = makeTx();
  let protectedTx;

  await repo.withLock(tx, async (facade) => {
    protectedTx = facade;
    repo.assertHeld(protectedTx);
  });

  assert.throws(
    () => repo.assertHeld(protectedTx),
    (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'MUTEX_REQUIRED'
  );
  assert.throws(
    () => protectedTx.execute('SELECT 1'),
    (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'MUTEX_LEASE_EXPIRED'
  );
});

test('propagates a work error and invalidates the facade after failure', async () => {
  const repo = createAuthorizationMutexRepository();
  const { tx } = makeTx();
  const original = new Error('work failed');
  let protectedTx;

  await assert.rejects(repo.withLock(tx, async (facade) => {
    protectedTx = facade;
    throw original;
  }), (error) => error === original);

  assert.throws(
    () => repo.assertHeld(protectedTx),
    (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'MUTEX_REQUIRED'
  );
});

test('rejects nested acquisition on the same transaction', async () => {
  const repo = createAuthorizationMutexRepository();
  const { tx } = makeTx();

  await repo.withLock(tx, async () => {
    await assert.rejects(
      repo.withLock(tx, async () => {}),
      (error) => error instanceof AuthorizationMutexRepositoryError && error.code === 'MUTEX_ALREADY_ACQUIRED'
    );
  });
});

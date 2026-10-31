import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMysqlTransactionManager } from '../../app/services/mysql-transaction-manager.js';

function makePool(options = {}) {
  const events = [];
  const connection = {
    async beginTransaction() {
      events.push('begin');
      if (options.beginError) throw options.beginError;
    },
    async commit() {
      events.push('commit');
      if (options.commitError) throw options.commitError;
    },
    async rollback() {
      events.push('rollback');
      if (options.rollbackError) throw options.rollbackError;
    },
    release() {
      events.push('release');
      if (options.releaseError) throw options.releaseError;
    },
    async query(...args) {
      events.push(['query', ...args]);
      return [[{ source: 'dedicated-connection' }], []];
    },
    async execute(...args) {
      events.push(['execute', ...args]);
      return [{ affectedRows: 1 }, []];
    }
  };
  const pool = {
    async getConnection() {
      events.push('getConnection');
      return connection;
    },
    async query() {
      events.push('pool-query');
      throw new Error('The global pool must not be used inside the transaction.');
    }
  };
  return { pool, connection, events };
}

function managerWithDiagnostics(pool, diagnostics = []) {
  return createMysqlTransactionManager(pool, {
    onReleaseError: (error, context) => diagnostics.push({ error, context })
  });
}

test('commits a normal result and releases the dedicated connection', async () => {
  const { pool, events } = makePool();
  const transactions = createMysqlTransactionManager(pool);
  const result = await transactions.run(async (tx) => {
    const [rows] = await tx.query('SELECT ?', [1]);
    assert.equal(rows[0].source, 'dedicated-connection');
    await tx.execute('UPDATE fixture SET value = ?', ['x']);
    return 'complete';
  });

  assert.equal(result, 'complete');
  assert.deepEqual(events, [
    'getConnection', 'begin', ['query', 'SELECT ?', [1]],
    ['execute', 'UPDATE fixture SET value = ?', ['x']], 'commit', 'release'
  ]);
});

test('commits a normal { ok: false } result', async () => {
  const { pool, events } = makePool();
  const result = await createMysqlTransactionManager(pool).run(async () => ({
    ok: false,
    code: 'REQUEST_EXPIRED'
  }));

  assert.deepEqual(result, { ok: false, code: 'REQUEST_EXPIRED' });
  assert.deepEqual(events, ['getConnection', 'begin', 'commit', 'release']);
});

test('passes only the transaction-scoped query context, not the pool or connection lifecycle', async () => {
  const { pool, connection, events } = makePool();
  await createMysqlTransactionManager(pool).run(async (tx) => {
    assert.notEqual(tx, pool);
    assert.notEqual(tx, connection);
    assert.deepEqual(Object.keys(tx).sort(), ['execute', 'query']);
    await tx.execute('SELECT 1');
  });

  assert.equal(events.includes('pool-query'), false);
  assert.equal(events.some((event) => Array.isArray(event) && event[0] === 'execute'), true);
});

test('rolls back, releases, and propagates the original work error', async () => {
  const { pool, events } = makePool();
  const workError = new Error('work failed');

  await assert.rejects(
    createMysqlTransactionManager(pool).run(async () => { throw workError; }),
    (error) => error === workError
  );
  assert.deepEqual(events, ['getConnection', 'begin', 'rollback', 'release']);
});

test('reports release failure after commit but returns the committed result', async () => {
  const releaseError = new Error('release failed');
  const { pool, events } = makePool({ releaseError });
  const diagnostics = [];

  const result = await managerWithDiagnostics(pool, diagnostics).run(async () => ({ ok: true }));

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ['getConnection', 'begin', 'commit', 'release']);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].error, releaseError);
  assert.equal(diagnostics[0].context.commitSucceeded, true);
  assert.equal(diagnostics[0].context.originalError, undefined);
});

test('attempts rollback after commit failure and releases the connection', async () => {
  const commitError = new Error('commit failed');
  const { pool, events } = makePool({ commitError });

  await assert.rejects(
    createMysqlTransactionManager(pool).run(async () => 'result'),
    (error) => error === commitError
  );
  assert.deepEqual(events, ['getConnection', 'begin', 'commit', 'rollback', 'release']);
});

test('preserves work error if rollback and release fail, and reports release failure', async () => {
  const workError = new Error('work failed');
  const rollbackError = new Error('rollback failed');
  const releaseError = new Error('release failed');
  const { pool, events } = makePool({ rollbackError, releaseError });
  const diagnostics = [];

  await assert.rejects(
    managerWithDiagnostics(pool, diagnostics).run(async () => { throw workError; }),
    (error) => error === workError
  );
  assert.deepEqual(events, ['getConnection', 'begin', 'rollback', 'release']);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].error, releaseError);
  assert.equal(diagnostics[0].context.commitSucceeded, false);
  assert.equal(diagnostics[0].context.originalError, workError);
});

test('releases the connection if beginTransaction fails', async () => {
  const beginError = new Error('begin failed');
  const { pool, events } = makePool({ beginError });

  await assert.rejects(
    createMysqlTransactionManager(pool).run(async () => 'unreachable'),
    (error) => error === beginError
  );
  assert.deepEqual(events, ['getConnection', 'begin', 'release']);
});
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityController } from '../../app/controllers/controller.activity.js';

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function poolWithTransaction(execute) {
  const calls = [];
  const connection = {
    async query() { throw Object.assign(new Error('D not migrated'), {code:'ER_NO_SUCH_TABLE'}); },
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, params) { calls.push({ sql, params }); return execute(sql, params); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); }
  };
  return { calls, pool: { async query(sql, params) { calls.push({ sql, params }); return [[], []]; }, async getConnection() { return connection; } } };
}

test('lists activities with parameterized plan, state and responsible filters', async () => {
  let observed;
  const pool = { query: async (sql, params) => { if (!sql.includes('FROM actividad ') && !sql.endsWith('FROM actividad ORDER BY id_actividad')) return [[], []]; observed = { sql, params }; return [[{ id_actividad: 2 }], []]; }, getConnection() {} };
  const res = response();
  await createActivityController(pool).list({ query: { planId: '7', estado: 'En proceso', responsable: 'Ana' } }, res);
  assert.deepEqual(observed.params, [7, 'En proceso', '%Ana%']);
  assert.match(observed.sql, /id_plan = \? AND estado = \? AND responsable LIKE \?/);
  assert.equal(res.body[0].id_actividad, 2);
});

test('rejects malformed filters without querying', async () => {
  let queries = 0;
  const pool = { async query() { queries++; return [[], []]; }, getConnection() {} };
  const res = response();
  await createActivityController(pool).list({ query: { planId: '1 OR 1=1' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(queries, 0);
});

test('returns activity detail by parameterized signed integer ID', async () => {
  let query;
  const pool = { async query(sql, params) { if (!sql.includes('FROM actividad WHERE')) return [[], []]; query = { sql, params }; return [[{ id_actividad: 6, id_plan: 4 }], []]; }, getConnection() {} };
  const res = response();
  await createActivityController(pool).getById({ params: { id: '6' } }, res);
  assert.equal(res.body.id_actividad, 6);
  assert.deepEqual(query.params, [6]);
  assert.match(query.sql, /WHERE id_actividad = \?/);
});

test('returns 404 for missing activity detail', async () => {
  const pool = { async query() { return [[], []]; }, getConnection() {} };
  const res = response();
  await createActivityController(pool).getById({ params: { id: '404' } }, res);
  assert.equal(res.statusCode, 404);
});

test('creates an activity linked to an existing plan and writes history atomically', async () => {
  const { pool, calls } = poolWithTransaction(async (sql) => {
    if (sql.startsWith('SELECT')) return [[{ id_plan: 7 }], []];
    if (sql.startsWith('INSERT INTO actividad')) return [{ insertId: 12 }, []];
    return [{ insertId: 1 }, []];
  });
  const res = response();
  await createActivityController(pool).create({ usuario: { sub: '21' }, body: { id_plan: '7', descripcion: 'Entregar informe', responsable: 'Ana', fecha_inicio: '2026-01-01', fecha_fin: '2026-01-31', estado: 'En proceso' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.id_actividad, 12);
  assert.equal(calls[1].params[0], 7);
  assert.match(calls[1].sql, /FOR UPDATE/);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
  assert.equal(calls.some((call) => typeof call === 'object' && call.sql.startsWith('INSERT INTO historico')), true);
});

test('rejects impossible or reversed dates before opening a transaction', async () => {
  const { pool, calls } = poolWithTransaction(async () => [[], []]);
  const controller = createActivityController(pool);
  for (const body of [
    { id_plan: 7, fecha_inicio: '2026-02-30' },
    { id_plan: 7, fecha_inicio: '2026-03-02', fecha_fin: '2026-03-01' }
  ]) {
    const res = response();
    await controller.create({ usuario: { sub: '21' }, body }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.deepEqual(calls, []);
});

test('returns 404 for missing plan and never inserts an orphan activity', async () => {
  const { pool, calls } = poolWithTransaction(async () => [[], []]);
  const res = response();
  await createActivityController(pool).create({ usuario: { sub: '21' }, body: { id_plan: 7 } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls.some((call) => typeof call === 'object' && call.sql.startsWith('INSERT INTO actividad')), false);
  assert.equal(calls.includes('commit'), true);
});

test('updates a locked activity and records history in the same transaction', async () => {
  const { pool, calls } = poolWithTransaction(async (sql) => sql.startsWith('SELECT')
    ? [[{ id_actividad: 12, id_plan: 7, descripcion: 'Old' }], []] : [{ affectedRows: 1 }, []]);
  const res = response();
  await createActivityController(pool).update({ usuario: { sub: '21' }, params: { id: '12' }, body: { descripcion: 'New', responsable: 'Ana' } }, res);
  assert.equal(res.body.descripcion, 'New');
  assert.equal(calls.some((call) => typeof call === 'object' && call.sql.startsWith('UPDATE actividad')), true);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('rolls back activity creation if historical logging fails', async () => {
  const { pool, calls } = poolWithTransaction(async (sql) => {
    if (sql.startsWith('SELECT')) return [[{ id_plan: 7 }], []];
    if (sql.startsWith('INSERT INTO actividad')) return [{ insertId: 12 }, []];
    throw new Error('private persistence diagnostic');
  });
  const res = response();
  await createActivityController(pool).create({ usuario: { sub: '21' }, body: { id_plan: 7 } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
  assert.doesNotMatch(JSON.stringify(res.body), /private persistence diagnostic/);
});

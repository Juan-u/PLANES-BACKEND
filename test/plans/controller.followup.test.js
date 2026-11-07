import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFollowupController } from '../../app/controllers/controller.followup.js';

const openPeriod = { id_periodo: 3, anio: 2026, trimestre: 1, fecha_inicio: '2026-01-01', fecha_fin: '2026-03-31', estado: 'open' };
function res() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function transactional(execute) {
  const calls = [];
  const connection = { async query(){throw Object.assign(new Error(),{code:'ER_NO_SUCH_TABLE'});}, async beginTransaction() { calls.push('begin'); }, async execute(sql, params) { calls.push({ sql, params }); return execute(sql, params); }, async commit() { calls.push('commit'); }, async rollback() { calls.push('rollback'); }, release() { calls.push('release'); } };
  const pool = { async query(sql, params) { calls.push({ poolQuery: sql, params }); return [[], []]; }, async execute(sql, params) { calls.push({ poolExecute: sql, params }); return [{ insertId: 3, affectedRows: 1 }, []]; }, async getConnection() { return connection; } };
  return { pool, calls };
}

test('creates a period transactionally and writes its history', async () => {
  const { pool, calls } = transactional(async () => [{ insertId: 3 }, []]);
  const response = res();
  await createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'UNIT-FIXTURE-ONLY'})}).createPeriod({ usuario: { sub: '12' }, body: { anio: '2026', trimestre: '1', fecha_inicio: '2026-01-01', fecha_fin: '2026-03-31' } }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.id_periodo, 3);
  assert.equal(calls.some((c) => typeof c === 'object' && c.sql?.startsWith('INSERT INTO historico')), true);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('rejects invalid quarter dates before opening a transaction', async () => {
  const { pool, calls } = transactional(async () => [[], []]);
  const response = res();
  await createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'UNIT-FIXTURE-ONLY'})}).createPeriod({ usuario: { sub: '12' }, body: { anio: 2026, trimestre: 5, fecha_inicio: '2026-01-01', fecha_fin: '2026-03-31' } }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(calls, []);
});

test('records an activity follow-up with pending review and atomic history', async () => {
  const { pool, calls } = transactional(async (sql) => {
    if (sql.includes('FROM periodo_seguimiento')) return [[openPeriod], []];
    if (sql.includes('FROM actividad')) return [[{ id_actividad: 8, fecha_inicio: '2026-01-01', id_plan: 4 }], []];
    if (sql.includes("estado = 'pending'")) return [[], []];
    if (sql.startsWith('INSERT INTO seguimiento_actividad')) return [{ insertId: 19 }, []];
    return [{ insertId: 1 }, []];
  });
  const response = res();
  await createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'UNIT-FIXTURE-ONLY'})}).createFollowup({ usuario: { sub: '12' }, params: { id: '8' }, body: { id_periodo: '3', porcentaje: '67.5', observaciones: 'Novedad' } }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.estado, 'pending');
  assert.equal(response.body.porcentaje, 67.5);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('cannot submit a duplicate pending follow-up for an activity and period', async () => {
  const { pool, calls } = transactional(async (sql) => {
    if (sql.includes('FROM periodo_seguimiento')) return [[openPeriod], []];
    if (sql.includes('FROM actividad')) return [[{ id_actividad: 8, fecha_inicio: '2026-01-01' }], []];
    return [[{ id_seguimiento: 18 }], []];
  });
  const response = res();
  await createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'UNIT-FIXTURE-ONLY'})}).createFollowup({ usuario: { sub: '12' }, params: { id: '8' }, body: { id_periodo: 3, porcentaje: 20 } }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(calls.some((c) => typeof c === 'object' && c.sql?.startsWith('INSERT INTO seguimiento_actividad')), false);
});

test('blocks self-approval and leaves pending follow-up untouched', async () => {
  const { pool, calls } = transactional(async (sql) => sql.includes('FROM seguimiento_actividad')
    ? [[{ id_seguimiento: 19, estado: 'pending', creado_por: 12 }], []] : [[], []]);
  const response = res();
  await createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'UNIT-FIXTURE-ONLY'})}).decideFollowup({ usuario: { sub: '12' }, params: { id: '19' }, body: { resultado: 'approved', motivo: 'Validado' } }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(calls.some((c) => typeof c === 'object' && c.sql?.startsWith('UPDATE seguimiento_actividad')), false);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('approval decision, follow-up state and history are in the same transaction', async () => {
  const { pool, calls } = transactional(async (sql) => {
    if (sql.includes('FROM seguimiento_actividad')) return [[{ id_seguimiento: 19, estado: 'pending', creado_por: 12 }], []];
    if(sql.includes('FROM periodo_seguimiento'))return [[openPeriod],[]];
    if (sql.startsWith('UPDATE seguimiento_actividad')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO seguimiento_decision')) return [{ insertId: 7 }, []];
    return [{ insertId: 1 }, []];
  });
  const response = res();
  await createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'UNIT-FIXTURE-ONLY'})}).decideFollowup({ usuario: { sub: '13' }, params: { id: '19' }, body: { resultado: 'approved', motivo: 'Revisado' } }, response);
  assert.equal(response.body.resultado, 'approved');
  assert.ok(calls.findIndex((c) => typeof c === 'object' && c.sql?.startsWith('UPDATE seguimiento_actividad')) < calls.findIndex((c) => typeof c === 'object' && c.sql?.startsWith('INSERT INTO seguimiento_decision')));
  assert.ok(calls.findIndex((c) => typeof c === 'object' && c.sql?.startsWith('INSERT INTO seguimiento_decision')) < calls.findIndex((c) => typeof c === 'object' && c.sql?.startsWith('INSERT INTO historico')));
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('summary reuses the approved-progress and quarterly-coverage calculation service', async () => {
  const pool = { async query(sql) {
    if (sql.includes('FROM periodo_seguimiento')) return [[openPeriod], []];
    return [[{ id_actividad: 1, porcentaje_aprobado: 50, pendiente: 0 }, { id_actividad: 2, porcentaje_aprobado: null, pendiente: 1 }], []];
  }, getConnection() {} };
  const response = res();
  await createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'UNIT-FIXTURE-ONLY'})}).summary({ params: { id: '3' } }, response);
  assert.equal(response.body.activitiesDue, 2);
  assert.equal(response.body.activitiesApproved, 1);
  assert.equal(response.body.activitiesPending, 1);
  assert.deepEqual(response.body.summary, { promedioAvance: 50, coberturaTrimestral: 50 });
});

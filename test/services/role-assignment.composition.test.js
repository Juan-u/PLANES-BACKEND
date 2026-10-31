import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createRoleAssignmentComposition } from '../../app/services/role-assignment.composition.js';

const REQUEST = '550e8400-e29b-41d4-a716-446655440000';
const EVENT = '8f14e45f-ea8a-4f8a-9f3e-9c0a1b2c3d4e';
const NOW = '2026-10-29T12:00:00.000Z';
const END = '2026-11-30T12:00:00.000Z';
const DB_NOW = '2026-10-29 12:00:00.000';
const DB_END = '2026-11-30 12:00:00.000';

function options(overrides = {}) {
  return {
    pool: { async getConnection() { throw new Error('Should not connect during composition.'); } },
    clock: { now: () => NOW },
    ids: { next: async () => REQUEST },
    approvalWindowMs: 86_400_000,
    ...overrides
  };
}
function pendingRequestRow() {
  return {
    id_solicitud: REQUEST, tipo_accion: 'assign', id_usuario_solicitante: 11,
    id_usuario_objetivo: 22, id_rol: 7, id_scope_ref: 101,
    id_asignacion_objetivo: null, id_asignacion_resultado: null,
    vigente_desde: DB_NOW, vigente_hasta: DB_END, estado: 'pending_approval',
    motivo: 'Reason', solicitada_en: DB_NOW, vence_en: '2026-10-30 12:00:00.000'
  };
}
function makePool(handler) {
  const events = [];
  const calls = [];
  let acquisitions = 0;
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async release() { events.push('release'); },
    async execute(sql, params) {
      calls.push({ sql, params });
      return handler(sql, params);
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return handler(sql, params);
    }
  };
  const pool = {
    async getConnection() { acquisitions += 1; return connection; }
  };
  return { pool, connection, calls, events, get acquisitions() { return acquisitions; } };
}

test('constructs an inactive service without exposing repositories or connecting', () => {
  const stubPool = { async getConnection() { throw new Error('Must remain unused.'); } };
  const composed = createRoleAssignmentComposition(options({ pool: stubPool }));
  assert.deepEqual(Object.keys(composed), ['service']);
  assert.equal(Object.isFrozen(composed.service), true);
  assert.deepEqual(Object.keys(composed.service).sort(),
    ['assignRole', 'decideChange', 'getAssignmentStatus', 'revokeRole']);
});

test('uses the supplied pool and external clock and ID provider through the existing factory', async () => {
  let idCount = 0;
  const idValues = [REQUEST, EVENT];
  const db = makePool((sql) => {
    if (sql === 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE') return [[{ mutex_id: 1 }], []];
    if (sql.includes('SELECT EXISTS (')) return [[{ authorized: 1 }], []];
    if (sql.includes('FROM rol AS r')) return [[{
      id_rol: 7, clasificacion_privilegio: 'privileged',
      permite_vigencia_indefinida: 0, requiere_ambito: 1
    }], []];
    if (sql.includes('FROM rol_scope_ref AS sr')) return [[{
      id_scope_ref: 101, ref_kind: 'number', ref_value: '12', activo: 1, allowed_role_id: 7
    }], []];
    if (sql.startsWith('SELECT id_asignacion FROM rol_asignacion')) return [[], []];
    if (sql.includes('FROM rol_configuracion')) return [[{
      clasificacion_privilegio: 'privileged', requiere_ambito: 1
    }], []];
    if (sql.startsWith('SELECT id_solicitud FROM rol_solicitud')) return [[], []];
    if (sql.startsWith('INSERT INTO rol_solicitud')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.startsWith('SELECT id_solicitud, tipo_accion')) return [[pendingRequestRow()], []];
    if (sql.includes('FROM rol_decision')) return [[], []];
    if (sql.includes('FROM rol_scope_ref')) return [[{
      id_scope_ref: 101, ref_kind: 'number', ref_value: '12'
    }], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected SQL through composed repositories: ' + sql);
  });
  const clock = { now: () => NOW };
  const ids = { next: async () => idValues[idCount++] };
  const composed = createRoleAssignmentComposition({
    pool: db.pool, clock, ids, approvalWindowMs: 86_400_000
  });

  assert.equal(db.acquisitions, 0);
  const result = await composed.service.assignRole({ actorId: 11 }, {
    targetUserId: 22, roleId: 7, scopeRef: 12, validUntil: END, reason: 'Reason'
  });

  assert.deepEqual(result, { ok: true, result: 'pending_approval', requestId: REQUEST });
  assert.equal(idCount, 2);
  assert.equal(db.acquisitions, 1);
  assert.deepEqual(db.events, ['begin', 'commit', 'release']);
  assert.equal(db.calls[0].sql, 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE');
  assert.equal(db.calls.filter((x) => x.sql === 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE').length, 1);
  assert.ok(db.calls.some((x) => x.sql.includes('FROM rol_scope_ref AS sr')));
  assert.ok(db.calls.some((x) => x.sql.includes('FROM rol_configuracion')));
  assert.ok(db.calls.some((x) => x.sql.includes('FROM rol_solicitud')));
  assert.ok(db.calls.some((x) => x.sql.includes('FROM rol_decision')));
  assert.ok(db.calls.some((x) => x.sql.includes('INSERT INTO rol_auditoria')));
  assert.equal(db.calls.some((x) => x.sql.includes('rol_delegacion')), false);
});

test('does not hide a persistence failure beyond the existing service contract', async () => {
  const failure = new Error('authorization storage unavailable');
  const db = makePool((sql) => {
    if (sql === 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE') return [[{ mutex_id: 1 }], []];
    if (sql.includes('SELECT EXISTS (')) throw failure;
    throw new Error('No later query should run.');
  });
  let id = 0;
  const composed = createRoleAssignmentComposition(options({
    pool: db.pool, ids: { next: async () => [REQUEST, EVENT][id++] }
  }));
  const result = await composed.service.assignRole({ actorId: 11 }, {
    targetUserId: 22, roleId: 7, reason: 'Reason'
  });
  assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_FAILED' });
  assert.deepEqual(db.events, ['begin', 'rollback', 'release']);
  assert.equal(db.calls[0].sql, 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE');
});


test('missing persistent mutex row aborts and rolls back before any authorization query', async () => {
  const db = makePool((sql) => {
    if (sql === 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE') return [[], []];
    throw new Error('No later query is permitted.');
  });
  let id = 0;
  const composed = createRoleAssignmentComposition(options({
    pool: db.pool, ids: { next: async () => [REQUEST, EVENT][id++] }
  }));
  const result = await composed.service.assignRole({ actorId: 11 }, {
    targetUserId: 22, roleId: 7, reason: 'Reason'
  });
  assert.deepEqual(result, { ok: false, code: 'MUTEX_ROW_MISSING' });
  assert.deepEqual(db.events, ['begin', 'rollback', 'release']);
  assert.equal(db.calls.length, 1);
});

test('validates required external configuration and propagates construction errors', () => {
  assert.throws(() => createRoleAssignmentComposition(null), TypeError);
  assert.throws(() => createRoleAssignmentComposition(options({ pool: null })), TypeError);
  assert.throws(() => createRoleAssignmentComposition(options({ clock: null })), /clock with now/);
  assert.throws(() => createRoleAssignmentComposition(options({ ids: null })), /ID provider with next/);
  assert.throws(() => createRoleAssignmentComposition(options({ approvalWindowMs: 0 })), /approvalWindowMs/);
  assert.throws(() => createRoleAssignmentComposition(options({ approvalWindowMs: 1.5 })), /approvalWindowMs/);
});

test('composition source uses the existing factory and has no global database import', async () => {
  const path = fileURLToPath(new URL('../../app/services/role-assignment.composition.js', import.meta.url));
  const source = await readFile(path, 'utf8');
  assert.match(source, /createRoleAssignmentServiceWithPool/);
  assert.match(source, /const mutex = createAuthorizationMutexRepository\(\);/);
  assert.equal((source.match(/createAuthorizationMutexRepository\(\)/g) || []).length, 1);
  assert.match(source, /const service = createRoleAssignmentServiceWithPool[\s\S]*?\{[\s\S]*?mutex,/);
  assert.doesNotMatch(source, /return Object\.freeze\(\{\s*service,\s*repositories/);
  assert.doesNotMatch(source, /from ['"][^'"]*db\.js['"]/i);
  assert.doesNotMatch(source, /createMysqlTransactionManager/);
  assert.doesNotMatch(source, /getConnection\(\)/);

  const indexPath = fileURLToPath(new URL('../../index.js', import.meta.url));
  const indexSource = await readFile(indexPath, 'utf8');
  assert.match(indexSource, /ENABLE_ROLE_PERMISSION_ROUTES === 'true'/);
  assert.match(indexSource, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(indexSource, /createRoleCapabilitiesRouter/);
  assert.match(indexSource, /crearRouterPlanes/);
  assert.match(indexSource, /M03\.plans\.read/);
  assert.match(indexSource, /createActivityRouter/);
  assert.match(indexSource, /M04\.activities\.read/);
  assert.match(indexSource, /createReadModelsRouter/);
  assert.match(indexSource, /M13\.evidence\.read/);
  assert.match(indexSource, /M12\.reports\.export/);
  assert.match(indexSource, /createFollowupRouter/);
  assert.match(indexSource, /M05\.followup\.approve/);
  assert.match(indexSource, /createEvidenceRouter/);
  assert.match(indexSource, /M13\.evidence\.upload/);
  assert.match(indexSource, /NODE_ENV === 'production'/);
  assert.match(indexSource, /createRoleAssignmentRouter/);
});

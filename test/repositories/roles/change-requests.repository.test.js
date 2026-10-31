import { testMutex, markProtectedTestTransaction } from './test-mutex.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChangeRequestsRepositoryError,
  createChangeRequestsRepository
} from '../../../app/repositories/roles/change-requests.repository.js';

const REQUEST = '550e8400-e29b-41d4-a716-446655440000';
const ASSIGNMENT = '8f14e45f-ea8a-4f8a-9f3e-9c0a1b2c3d4e';
const NOW = '2026-10-29T12:00:00.000Z';
const EXPIRY = '2026-10-30T12:00:00.000Z';
const FROM = '2026-10-30T12:00:00.000Z';
const UNTIL = '2026-11-30T12:00:00.000Z';
function settings(classification = 'privileged', requiresScope = 0) {
  return { clasificacion_privilegio: classification, requiere_ambito: requiresScope };
}
function assignment(overrides = {}) {
  return {
    id_asignacion: ASSIGNMENT, id_usuario: 22, id_rol: 7, id_scope_ref: null, creado_por: 11, motivo: 'Request reason',
    vigente_desde: '2026-10-29 12:00:00.000', vigente_hasta: '2026-11-30 12:00:00.000',
    estado: 'active', ref_kind: null, ref_value: null, ...overrides
  };
}
function request(overrides = {}) {
  return {
    id_solicitud: REQUEST, tipo_accion: 'assign', id_usuario_solicitante: 11,
    id_usuario_objetivo: 22, id_rol: 7, id_scope_ref: null,
    id_asignacion_objetivo: null, id_asignacion_resultado: null,
    vigente_desde: '2026-10-30 12:00:00.000', vigente_hasta: '2026-11-30 12:00:00.000',
    estado: 'pending_approval', motivo: 'Request reason',
    solicitada_en: '2026-10-29 11:00:00.000', vence_en: '2026-10-30 12:00:00.000',
    ...overrides
  };
}
function makeTx(handler) {
  const calls = [];
  const tx = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      return handler(sql, params, calls.length - 1);
    }
  };
  return { tx: markProtectedTestTransaction(tx), calls };
}
function scopeRefs() {
  const calls = [];
  return {
    calls,
    async resolveForRole(scopeRef, roleId, tx) {
      calls.push({ scopeRef, roleId, tx });
      return { idScopeRef: scopeRef === 12 ? 101 : 102, scopeRef };
    }
  };
}
const roleConfigQuery = (sql) => sql.includes('FROM rol_configuracion');

test('finds an equivalent pending assignment by user, role, scope and exact validity', async () => {
  const refs = scopeRefs();
  const { tx, calls } = makeTx((sql) => {
    if (roleConfigQuery(sql)) return [[settings('privileged', 1)], []];
    if (sql.includes('FROM rol_solicitud')) return [[{ id_solicitud: REQUEST }], []];
    return [[], []];
  });
  const exists = await createChangeRequestsRepository({ scopeRefs: refs, mutex: testMutex }).hasEquivalentPending({
    action: 'assign', targetUserId: 22, roleId: 7, scopeRef: 12,
    validFrom: FROM, validUntil: UNTIL, requestedBy: 11
  }, tx);
  assert.equal(exists, true);
  assert.equal(refs.calls[0].tx, tx);
  assert.deepEqual(calls.at(-1).params, [22, 7, 101, '2026-10-30 12:00:00.000', '2026-11-30 12:00:00.000']);
  assert.match(calls.at(-1).sql, /tipo_accion = 'assign'/);
});

test('does not confuse pending assignments with pending revocations', async () => {
  const { tx, calls } = makeTx((sql) => roleConfigQuery(sql) ? [[settings()], []] : [[], []]);
  const repo = createChangeRequestsRepository({ mutex: testMutex });
  const key = { targetUserId: 22, roleId: 7, scopeRef: null, validFrom: FROM, validUntil: UNTIL };
  assert.equal(await repo.hasEquivalentPending({ ...key, action: 'assign' }, tx), false);
  assert.equal(await repo.hasEquivalentPending({ ...key, action: 'revoke', assignmentId: ASSIGNMENT }, tx), false);
  const requestQueries = calls.filter((x) => x.sql.includes('FROM rol_solicitud'));
  assert.equal(requestQueries.length, 2);
  assert.match(requestQueries[0].sql, /tipo_accion = 'assign'/);
  assert.match(requestQueries[1].sql, /tipo_accion = 'revoke'/);
  assert.deepEqual(requestQueries[1].params, [ASSIGNMENT]);
});

test('creates an assignment request with only schema columns and pending state', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (roleConfigQuery(sql)) return [[settings()], []];
    if (sql.startsWith('INSERT INTO rol_solicitud')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  const result = await createChangeRequestsRepository({ mutex: testMutex }).createPending({
    requestId: REQUEST, action: 'assign', targetUserId: 22, roleId: 7, scopeRef: null,
    validFrom: FROM, validUntil: UNTIL, requestedBy: 11, requestedAt: NOW,
    expiresAt: EXPIRY, status: 'pending_approval', reason: '  Assignment request  '
  }, tx);
  assert.deepEqual(result, { requestId: REQUEST, status: 'pending_approval' });
  const insert = calls.find((x) => x.sql.startsWith('INSERT INTO rol_solicitud'));
  assert.deepEqual(insert.params, [REQUEST, 11, 22, 7, null, '2026-10-30 12:00:00.000',
    '2026-11-30 12:00:00.000', 'Assignment request', '2026-10-29 12:00:00.000', '2026-10-30 12:00:00.000']);
  assert.match(insert.sql, /id_asignacion_objetivo, id_asignacion_resultado/);
});

test('creates a revocation request before locking and revalidating its target assignment', async () => {
  let assignmentReads = 0;
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_asignacion AS a')) { assignmentReads += 1; return [[assignment()], []]; }
    if (roleConfigQuery(sql)) return [[settings()], []];
    if (sql.startsWith('INSERT INTO rol_solicitud')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE rol_solicitud')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  const result = await createChangeRequestsRepository({ mutex: testMutex }).createPending({
    requestId: REQUEST, action: 'revoke', assignmentId: ASSIGNMENT,
    targetUserId: 22, roleId: 7, scopeRef: null, requestedBy: 11,
    requestedAt: NOW, expiresAt: EXPIRY, status: 'pending_approval', reason: 'Revoke request'
  }, tx);
  assert.deepEqual(result, { requestId: REQUEST, status: 'pending_approval' });
  const insertIndex = calls.findIndex((x) => x.sql.startsWith('INSERT INTO rol_solicitud'));
  const assignmentReadsInOrder = calls.filter((x) => x.sql.includes('FROM rol_asignacion AS a'));
  assert.equal(assignmentReads, 2);
  assert.equal(assignmentReadsInOrder.length, 2);
  assert.doesNotMatch(assignmentReadsInOrder[0].sql, /FOR UPDATE/);
  assert.match(assignmentReadsInOrder[1].sql, /FOR UPDATE/);
  assert.ok(insertIndex >= 0 && calls.indexOf(assignmentReadsInOrder[1]) > insertIndex);
  assert.deepEqual(calls[insertIndex].params, [REQUEST, 11, 22, 7, null,
    '2026-10-29 12:00:00.000', '2026-11-30 12:00:00.000', 'Revoke request',
    '2026-10-29 12:00:00.000', '2026-10-30 12:00:00.000']);
  assert.ok(calls[insertIndex].sql.includes("VALUES (?, 'assign', ?, ?, ?, ?, NULL, NULL, ?, ?, 'pending_approval'"));
  assert.doesNotMatch(calls[insertIndex].sql, /id_asignacion_objetivo[^\n]*\?/);
  const conversionIndex = calls.findIndex((x) => x.sql.includes("SET tipo_accion = 'revoke'"));
  assert.ok(conversionIndex > insertIndex);
  assert.ok(conversionIndex > calls.indexOf(assignmentReadsInOrder[1]));
  assert.deepEqual(calls[conversionIndex].params, [ASSIGNMENT, REQUEST]);
});

test('rolls back by propagating when the revocation target changed after request insertion', async () => {
  let assignmentReads = 0;
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_asignacion AS a')) {
      assignmentReads += 1;
      return [[assignment(assignmentReads === 1 ? {} : { estado: 'revoked' })], []];
    }
    if (roleConfigQuery(sql)) return [[settings()], []];
    if (sql.startsWith('INSERT INTO rol_solicitud')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE rol_solicitud')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  await assert.rejects(createChangeRequestsRepository({ mutex: testMutex }).createPending({
    requestId: REQUEST, action: 'revoke', assignmentId: ASSIGNMENT,
    targetUserId: 22, roleId: 7, scopeRef: null, requestedBy: 11,
    requestedAt: NOW, expiresAt: EXPIRY, status: 'pending_approval', reason: 'Revoke request'
  }, tx), (error) => error.code === 'ASSIGNMENT_TARGET_CHANGED');
  const insertIndex = calls.findIndex((x) => x.sql.startsWith('INSERT INTO rol_solicitud'));
  const lockIndex = calls.findIndex((x) => x.sql.includes('FROM rol_asignacion AS a') && /FOR UPDATE/.test(x.sql));
  assert.ok(insertIndex >= 0 && lockIndex > insertIndex);
  assert.equal(calls.some((x) => x.sql.includes("SET tipo_accion = 'revoke'")), false);
});

test('getById provides a non-locking request preview', async () => {
  const { tx, calls } = makeTx((sql) => sql.includes('FROM rol_solicitud') ? [[request()], []] : [[], []]);
  const result = await createChangeRequestsRepository({ mutex: testMutex }).getById(REQUEST, tx);
  assert.equal(result.requestId, REQUEST);
  assert.equal(result.roleId, 7);
  assert.doesNotMatch(calls[0].sql, /FOR UPDATE/);
});
test('getByIdForUpdate locks and maps an assignment request to the service contract', async () => {
  const { tx, calls } = makeTx((sql) => sql.includes('FROM rol_solicitud')
    ? [[request()], []] : [[], []]);
  const result = await createChangeRequestsRepository({ mutex: testMutex }).getByIdForUpdate(REQUEST, tx);
  assert.deepEqual(result, {
    requestId: REQUEST, action: 'assign', requestedBy: 11, requestedAt: '2026-10-29T11:00:00.000Z',
    expiresAt: EXPIRY, targetUserId: 22, roleId: 7, scopeRef: null, assignmentId: null,
    validFrom: FROM, validUntil: UNTIL, status: 'pending_approval', reason: 'Request reason'
  });
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[0].params, [REQUEST]);
});

test('returns null for an unknown request', async () => {
  const { tx } = makeTx(() => [[], []]);
  assert.equal(await createChangeRequestsRepository({ mutex: testMutex }).getByIdForUpdate(REQUEST, tx), null);
});

test('hydrates revocation target data from the assignment row without duplicating it in request storage', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_solicitud')) return [[request({
      tipo_accion: 'revoke', id_usuario_objetivo: null, id_rol: null, id_scope_ref: null,
      id_asignacion_objetivo: ASSIGNMENT, id_asignacion_resultado: null,
      vigente_desde: null, vigente_hasta: null
    })], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignment({
      id_scope_ref: 101, ref_kind: 'number', ref_value: '12'
    })], []];
    return [[], []];
  });
  const result = await createChangeRequestsRepository({ mutex: testMutex }).getByIdForUpdate(REQUEST, tx);
  assert.deepEqual({
    action: result.action, assignmentId: result.assignmentId, targetUserId: result.targetUserId,
    roleId: result.roleId, scopeRef: result.scopeRef, validFrom: result.validFrom,
    validUntil: result.validUntil
  }, {
    action: 'revoke', assignmentId: ASSIGNMENT, targetUserId: 22, roleId: 7,
    scopeRef: 12, validFrom: null, validUntil: null
  });
  assert.ok(calls[0].sql.includes('FOR UPDATE'));
  assert.ok(calls[1].sql.includes('FROM rol_asignacion AS a'));
  assert.ok(calls[1].sql.includes('FOR UPDATE'));
});

test('rejects a revocation request whose target assignment does not exist', async () => {
  const { tx } = makeTx((sql) => sql.includes('FROM rol_solicitud')
    ? [[request({ tipo_accion: 'revoke', id_usuario_objetivo: null, id_rol: null, id_scope_ref: null,
      id_asignacion_objetivo: ASSIGNMENT, id_asignacion_resultado: null,
      vigente_desde: null, vigente_hasta: null })], []] : [[], []]);
  await assert.rejects(createChangeRequestsRepository({ mutex: testMutex }).getByIdForUpdate(REQUEST, tx),
    (error) => error.code === 'ASSIGNMENT_TARGET_NOT_FOUND');
});

test('approves a pending request, inserts one decision and changes request state in the same tx', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_solicitud')) return [[request({ id_asignacion_resultado: ASSIGNMENT })], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignment({
      vigente_desde: '2026-10-30 12:00:00.000'
    })], []];
    if (sql.startsWith('INSERT INTO rol_decision')) return [{ affectedRows: 1, insertId: 19 }, []];
    if (sql.startsWith('UPDATE rol_solicitud')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  assert.equal(await createChangeRequestsRepository({ mutex: testMutex }).decideIfPending(REQUEST, {
    status: 'approved', decisionActorType: 'user', decidedBy: 33, decidedAt: NOW, reason: 'Approved'
  }, tx), true);
  const insertIndex = calls.findIndex((x) => x.sql.startsWith('INSERT INTO rol_decision'));
  const updateIndex = calls.findIndex((x) => x.sql.startsWith('UPDATE rol_solicitud'));
  assert.ok(insertIndex >= 0 && updateIndex > insertIndex);
  assert.deepEqual(calls[insertIndex].params, [REQUEST, 'user', 33, 'approved', '2026-10-29 12:00:00.000', 'Approved']);
  assert.equal(calls.every((x) => x.tx === undefined), true);
});

test('rejects a pending request and records the rejecting user decision', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_solicitud')) return [[request()], []];
    if (sql.startsWith('INSERT INTO rol_decision')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE rol_solicitud')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  assert.equal(await createChangeRequestsRepository({ mutex: testMutex }).decideIfPending(REQUEST, {
    status: 'rejected', decisionActorType: 'user', decidedBy: 33, decidedAt: NOW, reason: 'Rejected'
  }, tx), true);
  assert.deepEqual(calls.find((x) => x.sql.startsWith('INSERT INTO rol_decision')).params,
    [REQUEST, 'user', 33, 'rejected', '2026-10-29 12:00:00.000', 'Rejected']);
});

test('does not decide an already decided request twice', async () => {
  let inserts = 0;
  const { tx } = makeTx((sql) => sql.includes('FROM rol_solicitud')
    ? [[request({ estado: 'approved' })], []]
    : sql.startsWith('INSERT INTO rol_decision') ? (inserts++, [{ affectedRows: 1 }, []]) : [[], []]);
  assert.equal(await createChangeRequestsRepository({ mutex: testMutex }).decideIfPending(REQUEST, {
    status: 'rejected', decisionActorType: 'user', decidedBy: 33, decidedAt: NOW, reason: 'Second decision'
  }, tx), false);
  assert.equal(inserts, 0);
});

test('records a system expiration only after expiry and with a null user actor', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_solicitud')) return [[request({ vence_en: '2026-10-29 11:00:00.000' })], []];
    if (sql.startsWith('INSERT INTO rol_decision')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE rol_solicitud')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  assert.equal(await createChangeRequestsRepository({ mutex: testMutex }).decideIfPending(REQUEST, {
    status: 'expired', decisionActorType: 'system', decidedBy: null, decidedAt: NOW,
    reason: 'approval_window_expired'
  }, tx), true);
  assert.deepEqual(calls.find((x) => x.sql.startsWith('INSERT INTO rol_decision')).params,
    [REQUEST, 'system', null, 'expired', '2026-10-29 12:00:00.000', 'approval_window_expired']);
});

test('rejects self-approval and does not insert a decision', async () => {
  let inserted = false;
  const { tx } = makeTx((sql) => sql.includes('FROM rol_solicitud') ? [[request()], []]
    : sql.startsWith('INSERT INTO rol_decision') ? (inserted = true, [{ affectedRows: 1 }, []]) : [[], []]);
  await assert.rejects(createChangeRequestsRepository({ mutex: testMutex }).decideIfPending(REQUEST, {
    status: 'rejected', decisionActorType: 'user', decidedBy: 11, decidedAt: NOW, reason: 'same person'
  }, tx), (error) => error.code === 'SELF_APPROVAL_DENIED');
  assert.equal(inserted, false);
});

test('propagates persistence errors unchanged', async () => {
  const expected = new Error('query failed');
  const tx = markProtectedTestTransaction({ async execute() { throw expected; } });
  await assert.rejects(createChangeRequestsRepository({ mutex: testMutex }).getByIdForUpdate(REQUEST, tx),
    (error) => error === expected);
});

test('requires and uses the supplied transaction only', async () => {
  const repo = createChangeRequestsRepository({ mutex: testMutex });
  let calls = 0;
  const tx = markProtectedTestTransaction({ async execute() { calls += 1; return [[], []]; } });
  await assert.rejects(repo.getByIdForUpdate(REQUEST),
    (error) => error instanceof ChangeRequestsRepositoryError && error.code === 'TRANSACTION_REQUIRED');
  assert.equal(calls, 0);
  await repo.getByIdForUpdate(REQUEST, tx);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(repo).sort(),
    ['createPending', 'decideIfPending', 'getById', 'getByIdForUpdate', 'hasEquivalentPending']);
});

test('returns exactly the change request fields consumed by the service', async () => {
  const { tx } = makeTx((sql) => sql.includes('FROM rol_solicitud') ? [[request()], []] : [[], []]);
  const result = await createChangeRequestsRepository({ mutex: testMutex }).getByIdForUpdate(REQUEST, tx);
  assert.deepEqual(Object.keys(result).sort(), [
    'action', 'assignmentId', 'expiresAt', 'reason', 'requestId', 'requestedAt',
    'requestedBy', 'roleId', 'scopeRef', 'status', 'targetUserId', 'validFrom', 'validUntil'
  ]);
  assert.equal(result.action, 'assign');
  assert.equal(result.status, 'pending_approval');
});

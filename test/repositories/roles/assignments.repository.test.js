import { testMutex, markProtectedTestTransaction } from './test-mutex.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AssignmentsRepositoryError,
  createAssignmentsRepository
} from '../../../app/repositories/roles/assignments.repository.js';

const ID = '8f14e45f-ea8a-4f8a-9f3e-9c0a1b2c3d4e';
const REQUEST = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-29T12:00:00.000Z';
const FUTURE = '2026-10-30T12:00:00.000Z';
const FUTURE_END = '2026-11-30T12:00:00.000Z';

function config(classification = 'ordinary', options = {}) {
  return {
    clasificacion_privilegio: classification,
    permite_vigencia_indefinida: options.open ?? 1,
    requiere_ambito: options.scope ?? 0
  };
}
function assignmentRow(overrides = {}) {
  return {
    id_asignacion: ID, id_usuario: 22, id_rol: 7, id_scope_ref: null,
    vigente_desde: '2026-10-29 12:00:00.000', vigente_hasta: '2026-11-30 12:00:00.000',
    estado: 'active', creado_por: 11, creado_en: '2026-10-29 12:00:00.000', motivo: 'Reason',
    revocado_por: null, revocado_en: null, motivo_revocacion: null, ref_kind: null, ref_value: null,
    ...overrides
  };
}
function pendingAssignRow(overrides = {}) {
  return {
    id_solicitud: REQUEST, tipo_accion: 'assign', id_usuario_solicitante: 11,
    id_usuario_objetivo: 22, id_rol: 7, id_scope_ref: null,
    id_asignacion_objetivo: null, id_asignacion_resultado: null,
    vigente_desde: '2026-10-30 12:00:00.000', vigente_hasta: '2026-11-30 12:00:00.000',
    estado: 'pending_approval', vence_en: '2026-10-30 12:00:00.000',
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
function scopeResolver() {
  const calls = [];
  return {
    calls,
    async resolveForRole(scopeRef, roleId, tx) {
      calls.push({ scopeRef, roleId, tx });
      return { idScopeRef: scopeRef === 12 ? 101 : 102, scopeRef };
    }
  };
}
function isAssignmentRead(sql) { return sql.includes('FROM rol_asignacion AS a'); }

test('hasEquivalent finds an exact existing tuple using the transaction', async () => {
  const scopeRefs = scopeResolver();
  const { tx, calls } = makeTx((sql) => sql.includes('SELECT id_asignacion FROM rol_asignacion')
    ? [[{ id_asignacion: ID }], []] : [[], []]);
  const result = await createAssignmentsRepository({ scopeRefs, mutex: testMutex }).hasEquivalent({
    targetUserId: 22, roleId: 7, scopeRef: 12, validFrom: NOW, validUntil: FUTURE_END
  }, tx);
  assert.equal(result, true);
  assert.equal(scopeRefs.calls[0].tx, tx);
  assert.deepEqual(calls.at(-1).params, [22, 7, 101, '2026-10-29 12:00:00.000', '2026-11-30 12:00:00.000']);
  assert.match(calls.at(-1).sql, /estado IN \('active', 'scheduled'\)/);
});

test('hasEquivalent preserves number and string scopeRef identity', async () => {
  const scopeRefs = scopeResolver();
  const { tx, calls } = makeTx(() => [[], []]);
  const repo = createAssignmentsRepository({ scopeRefs, mutex: testMutex });
  const key = { targetUserId: 22, roleId: 7, validFrom: NOW, validUntil: FUTURE_END };
  await repo.hasEquivalent({ ...key, scopeRef: 12 }, tx);
  await repo.hasEquivalent({ ...key, scopeRef: '12' }, tx);
  assert.deepEqual(scopeRefs.calls.map((x) => x.scopeRef), [12, '12']);
  assert.equal(calls[0].params[2], 101);
  assert.equal(calls[1].params[2], 102);
});

test('creates an ordinary assignment with schema-mapped values', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_configuracion')) return [[config()], []];
    if (sql.startsWith('INSERT INTO rol_asignacion')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  const result = await createAssignmentsRepository({ mutex: testMutex }).create({
    assignmentId: ID, userId: 22, roleId: 7, scopeRef: null, validFrom: NOW,
    validUntil: FUTURE_END, status: 'active', createdBy: 11, createdAt: NOW, reason: '  approved  '
  }, tx);
  assert.deepEqual(result, { assignmentId: ID });
  const insert = calls.find((x) => x.sql.startsWith('INSERT INTO rol_asignacion'));
  assert.deepEqual(insert.params, [ID, 22, 7, null, '2026-10-29 12:00:00.000',
    '2026-11-30 12:00:00.000', 'active', 11, '2026-10-29 12:00:00.000', 'approved']);
  assert.ok(calls.every((x) => Array.isArray(x.params)));
});

test('creates a privileged assignment only against a matching pending request and links result', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_configuracion')) return [[config('privileged')], []];
    if (sql.includes('FROM rol_solicitud')) return [[pendingAssignRow()], []];
    if (sql.startsWith('SELECT id_decision')) return [[], []];
    if (sql.startsWith('INSERT INTO rol_asignacion')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE rol_solicitud')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  const result = await createAssignmentsRepository({ mutex: testMutex }).create({
    assignmentId: ID, userId: 22, roleId: 7, scopeRef: null, validFrom: FUTURE,
    validUntil: FUTURE_END, status: 'scheduled', createdBy: 11, createdAt: NOW, reason: 'Approved request',
    approvedBy: 33, approvalRequestId: REQUEST
  }, tx);
  assert.deepEqual(result, { assignmentId: ID });
  assert.ok(calls.some((x) => x.sql.includes('FOR UPDATE') && x.sql.includes('rol_solicitud')));
  assert.ok(calls.some((x) => x.sql.startsWith('UPDATE rol_solicitud') && x.params[0] === ID));
});

test('rejects privileged assignment without approval metadata before insert', async () => {
  const { tx, calls } = makeTx((sql) => sql.includes('FROM rol_configuracion')
    ? [[config('privileged')], []] : [[], []]);
  await assert.rejects(
    createAssignmentsRepository({ mutex: testMutex }).create({
      assignmentId: ID, userId: 22, roleId: 7, validFrom: NOW, validUntil: FUTURE_END,
      status: 'active', createdBy: 11, createdAt: NOW, reason: 'No approval'
    }, tx),
    (error) => error.code === 'APPROVAL_REQUIRED'
  );
  assert.equal(calls.some((x) => x.sql.startsWith('INSERT INTO')), false);
});

test('getById returns service contract fields and reconstructs numeric scopeRef', async () => {
  const { tx, calls } = makeTx((sql) => isAssignmentRead(sql)
    ? [[assignmentRow({ id_scope_ref: 101, ref_kind: 'number', ref_value: '12' })], []] : [[], []]);
  const result = await createAssignmentsRepository({ mutex: testMutex }).getById(ID, tx);
  assert.deepEqual(result, {
    assignmentId: ID, userId: 22, roleId: 7, scopeRef: 12, validFrom: NOW,
    validUntil: FUTURE_END, status: 'active', createdBy: 11, createdAt: NOW,
    reason: 'Reason', revokedBy: null, revokedAt: null, revocationReason: null
  });
  assert.equal(calls.length, 1);
});

test('getById reconstructs textual scopeRef without trimming', async () => {
  const { tx } = makeTx((sql) => isAssignmentRead(sql)
    ? [[assignmentRow({ id_scope_ref: 102, ref_kind: 'string', ref_value: ' 12 ' })], []] : [[], []]);
  assert.equal((await createAssignmentsRepository({ mutex: testMutex }).getById(ID, tx)).scopeRef, ' 12 ');
});

test('getById returns null when the assignment is absent', async () => {
  const { tx } = makeTx(() => [[], []]);
  assert.equal(await createAssignmentsRepository({ mutex: testMutex }).getById(ID, tx), null);
});

test('revokes an active ordinary assignment without deleting history', async () => {
  let reads = 0;
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_asignacion AS a')) {
      reads += 1;
      return [[assignmentRow()], []];
    }
    if (sql.includes('FROM rol_configuracion')) return [[config()], []];
    if (sql.startsWith('UPDATE rol_asignacion')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  const result = await createAssignmentsRepository({ mutex: testMutex }).revoke({
    assignmentId: ID, revokedBy: 11, revokedAt: NOW, reason: 'Removal'
  }, tx);
  assert.deepEqual(result, { assignmentId: ID, status: 'revoked' });
  assert.equal(reads, 2);
  assert.ok(calls.some((x) => x.sql.includes('FOR UPDATE')));
  assert.ok(calls.some((x) => x.sql.startsWith('UPDATE rol_asignacion')));
  assert.equal(calls.some((x) => x.sql.startsWith('DELETE')), false);
});

test('privileged revocation requires a distinct approver and matching pending request', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignmentRow()], []];
    if (sql.includes('FROM rol_configuracion')) return [[config('privileged')], []];
    if (sql.includes('FROM rol_solicitud')) return [[{
      id_solicitud: REQUEST, tipo_accion: 'revoke', id_usuario_solicitante: 11,
      id_asignacion_objetivo: ID, id_asignacion_resultado: null,
      estado: 'pending_approval', vence_en: '2026-10-30 12:00:00.000'
    }], []];
    if (sql.startsWith('SELECT id_decision')) return [[], []];
    if (sql.includes('FOR UPDATE')) return [[assignmentRow()], []];
    if (sql.startsWith('UPDATE rol_asignacion')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  const result = await createAssignmentsRepository({ mutex: testMutex }).revoke({
    assignmentId: ID, revokedBy: 11, revokedAt: NOW, reason: 'Removal',
    approvedBy: 33, approvalRequestId: REQUEST
  }, tx);
  assert.deepEqual(result, { assignmentId: ID, status: 'revoked' });
  assert.equal(calls.some((x) => x.sql.includes('SET id_asignacion_resultado')), false);
});

test('does not revoke an already revoked assignment a second time', async () => {
  const { tx, calls } = makeTx((sql) => sql.includes('FROM rol_asignacion AS a')
    ? [[assignmentRow({ estado: 'revoked' })], []] : [[], []]);
  assert.equal(await createAssignmentsRepository({ mutex: testMutex }).revoke({
    assignmentId: ID, revokedBy: 11, revokedAt: NOW, reason: 'Again'
  }, tx), null);
  assert.equal(calls.length, 1);
});

test('rejects assignment states outside the SQL model', async () => {
  const { tx } = makeTx((sql) => sql.includes('FROM rol_configuracion') ? [[config()], []] : [[], []]);
  await assert.rejects(
    createAssignmentsRepository({ mutex: testMutex }).create({
      assignmentId: ID, userId: 22, roleId: 7, validFrom: NOW, validUntil: FUTURE_END,
      status: 'expired', createdBy: 11, createdAt: NOW, reason: 'No'
    }, tx),
    (error) => error.code === 'INVALID_ASSIGNMENT_STATUS'
  );
});

test('propagates transaction query failures unchanged', async () => {
  const expected = new Error('persistence failed');
  const tx = markProtectedTestTransaction({ async execute() { throw expected; } });
  await assert.rejects(
    createAssignmentsRepository({ mutex: testMutex }).hasEquivalent({
      targetUserId: 22, roleId: 7, scopeRef: null, validFrom: NOW, validUntil: FUTURE_END
    }, tx),
    (error) => error === expected
  );
});

test('requires and uses the supplied transaction and exposes no global connection', async () => {
  const repo = createAssignmentsRepository({ mutex: testMutex });
  let count = 0;
  const tx = markProtectedTestTransaction({ async execute() { count += 1; return [[], []]; } });
  await assert.rejects(repo.getById(ID), (error) =>
    error instanceof AssignmentsRepositoryError && error.code === 'TRANSACTION_REQUIRED');
  assert.equal(count, 0);
  await repo.getById(ID, tx);
  assert.equal(count, 1);
  assert.deepEqual(Object.keys(repo).sort(), ['create', 'getById', 'hasEquivalent', 'revoke']);
});

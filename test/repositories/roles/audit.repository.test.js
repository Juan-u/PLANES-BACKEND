import { testMutex, markProtectedTestTransaction } from './test-mutex.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuditRepositoryError,
  createAuditRepository
} from '../../../app/repositories/roles/audit.repository.js';

const EVENT = '8f14e45f-ea8a-4f8a-9f3e-9c0a1b2c3d4e';
const REQUEST = '550e8400-e29b-41d4-a716-446655440000';
const ASSIGNMENT = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTHER_REQUEST = 'd9428888-122b-4ef9-ae97-08617a3b113b';
const NOW = '2026-10-29T12:00:00.000Z';

function event(overrides = {}) {
  return {
    eventId: EVENT, action: 'example_event', actorType: 'user', actorId: 11,
    occurredAt: NOW, reason: 'Audit reason', ...overrides
  };
}
function requestRow(overrides = {}) {
  return {
    id_solicitud: REQUEST, tipo_accion: 'assign', id_usuario_solicitante: 11,
    id_usuario_objetivo: 22, id_rol: 7, id_scope_ref: null,
    id_asignacion_objetivo: null, id_asignacion_resultado: null,
    estado: 'pending_approval', ...overrides
  };
}
function assignmentRow(overrides = {}) {
  return {
    id_asignacion: ASSIGNMENT, id_usuario: 22, id_rol: 7, id_scope_ref: null,
    estado: 'active', creado_por: 11, revocado_por: null, ref_kind: null, ref_value: null,
    ...overrides
  };
}
function decisionRow(overrides = {}) {
  return {
    id_solicitud: REQUEST, id_decision: 31, tipo_actor: 'user',
    id_usuario_decisor: 33, resultado: 'approved', ...overrides
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

test('appends an ordinary event with absent references left null', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  const result = await createAuditRepository({ mutex: testMutex }).append(event(), tx);
  assert.deepEqual(result, { eventId: EVENT });
  const insert = calls.find((x) => x.sql.startsWith('INSERT INTO rol_auditoria'));
  assert.deepEqual(insert.params, [
    EVENT, 'user', 11, 'example_event', null, '2026-10-29 12:00:00.000',
    'Audit reason', null, null, null, null, null, null, null, null, null, null, null
  ]);
  assert.match(insert.sql, /id_decision, id_asignacion, id_delegacion, id_permiso/);
});

test('records an event linked to an assignment and verifies its user, role and actor', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignmentRow()], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  await createAuditRepository({ mutex: testMutex }).append(event({
    action: 'role_assigned', assignmentId: ASSIGNMENT, targetUserId: 22, roleId: 7
  }), tx);
  const insert = calls.find((x) => x.sql.startsWith('INSERT INTO rol_auditoria'));
  assert.equal(insert.params[13], ASSIGNMENT);
  assert.equal(insert.params[8], 22);
  assert.equal(insert.params[9], 7);
});

test('records a request event without inventing a decision reference', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_solicitud')) return [[requestRow()], []];
    if (sql.includes('FROM rol_decision')) return [[], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  await createAuditRepository({ mutex: testMutex }).append(event({
    action: 'role_assignment_requested', requestId: REQUEST, targetUserId: 22, roleId: 7, scopeRef: null
  }), tx);
  const insert = calls.find((x) => x.sql.startsWith('INSERT INTO rol_auditoria'));
  assert.equal(insert.params[11], REQUEST);
  assert.equal(insert.params[12], null);
  assert.equal(calls.some((x) => x.sql.includes('FROM rol_decision')), true);
});

test('resolves the decision ID for an approval by its request', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_solicitud')) return [[requestRow({
      estado: 'approved', id_asignacion_resultado: ASSIGNMENT
    })], []];
    if (sql.includes('FROM rol_decision')) return [[decisionRow()], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignmentRow()], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    throw new Error('Unexpected query: ' + sql);
  });
  await createAuditRepository({ mutex: testMutex }).append(event({
    action: 'role_assignment_approved', actorId: 33, requestId: REQUEST,
    assignmentId: ASSIGNMENT, targetUserId: 22, roleId: 7
  }), tx);
  const decisionLookup = calls.find((x) => x.sql.includes('FROM rol_decision'));
  assert.deepEqual(decisionLookup.params, [REQUEST]);
  const insert = calls.find((x) => x.sql.startsWith('INSERT INTO rol_auditoria'));
  assert.equal(insert.params[12], 31);
  assert.equal(insert.params[11], REQUEST);
});

test('rejects a decision returned for a different request', async () => {
  const { tx } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_solicitud')) return [[requestRow({ estado: 'approved', id_asignacion_resultado: ASSIGNMENT })], []];
    if (sql.includes('FROM rol_decision')) return [[decisionRow({ id_solicitud: OTHER_REQUEST })], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignmentRow()], []];
    return [{ affectedRows: 1 }, []];
  });
  await assert.rejects(createAuditRepository({ mutex: testMutex }).append(event({
    action: 'role_assignment_approved', actorId: 33, requestId: REQUEST,
    assignmentId: ASSIGNMENT, targetUserId: 22, roleId: 7
  }), tx), (error) => error.code === 'DECISION_REQUEST_MISMATCH');
});

test('rejects a decision-required event when the request has no decision', async () => {
  const { tx } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_solicitud')) return [[requestRow({ estado: 'approved', id_asignacion_resultado: ASSIGNMENT })], []];
    if (sql.includes('FROM rol_decision')) return [[], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignmentRow()], []];
    return [{ affectedRows: 1 }, []];
  });
  await assert.rejects(createAuditRepository({ mutex: testMutex }).append(event({
    action: 'role_assignment_approved', actorId: 33, requestId: REQUEST,
    assignmentId: ASSIGNMENT, targetUserId: 22, roleId: 7
  }), tx), (error) => error.code === 'DECISION_REQUIRED');
});

test('preserves null optional references permitted by the model', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignmentRow({ estado: 'revoked', revocado_por: 11 })], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
  await createAuditRepository({ mutex: testMutex }).append(event({ actorType: 'system', actorId: null }), tx);
  const values = calls.find((x) => x.sql.startsWith('INSERT INTO rol_auditoria')).params;
  assert.equal(values[2], null);
  assert.deepEqual(values.slice(8, 18), [null, null, null, null, null, null, null, null, null, null]);
});

test('resolves numeric and textual scope references distinctly without changing either', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_scope_ref')) {
      const [kind, value] = calls.at(-1).params;
      return [[{ id_scope_ref: kind === 'number' ? 101 : 102, ref_kind: kind, ref_value: value }], []];
    }
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
  const repo = createAuditRepository({ mutex: testMutex });
  await repo.append(event({ scopeRef: 12 }), tx);
  await repo.append(event({ eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', scopeRef: '12' }), tx);
  const lookups = calls.filter((x) => x.sql.includes('FROM rol_scope_ref'));
  assert.deepEqual(lookups.map((x) => x.params), [['number', '12'], ['string', '12']]);
  const inserts = calls.filter((x) => x.sql.startsWith('INSERT INTO rol_auditoria'));
  assert.equal(inserts[0].params[10], 101);
  assert.equal(inserts[1].params[10], 102);
});

test('rejects duplicate event IDs before attempting a second insert', async () => {
  let inserts = 0;
  const { tx } = makeTx((sql) => sql.includes('SELECT id_evento FROM rol_auditoria')
    ? [[{ id_evento: EVENT }], []]
    : (inserts += 1, [{ affectedRows: 1 }, []]));
  await assert.rejects(createAuditRepository({ mutex: testMutex }).append(event(), tx),
    (error) => error.code === 'DUPLICATE_EVENT');
  assert.equal(inserts, 0);
});

test('propagates query failures unchanged', async () => {
  const expected = new Error('query failure');
  const tx = markProtectedTestTransaction({ async execute() { throw expected; } });
  await assert.rejects(createAuditRepository({ mutex: testMutex }).append(event(), tx), (error) => error === expected);
});

test('propagates insert failures unchanged', async () => {
  const expected = new Error('foreign key or insert failure');
  const { tx } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) throw expected;
    return [[], []];
  });
  await assert.rejects(createAuditRepository({ mutex: testMutex }).append(event(), tx), (error) => error === expected);
});

test('requires and uses only the supplied transaction', async () => {
  const repo = createAuditRepository({ mutex: testMutex });
  let calls = 0;
  const tx = markProtectedTestTransaction({ async execute(sql) { calls += 1; return sql.startsWith('INSERT INTO rol_auditoria') ? [{ affectedRows: 1 }, []] : [[], []]; } });
  await assert.rejects(repo.append(event()), (error) =>
    error instanceof AuditRepositoryError && error.code === 'TRANSACTION_REQUIRED');
  assert.equal(calls, 0);
  await repo.append(event(), tx);
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys(repo), ['append']);
});

test('rejects explicit decision IDs that are not linked to the event request', async () => {
  const { tx } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_solicitud')) return [[requestRow({ estado: 'approved' })], []];
    if (sql.includes('FROM rol_decision')) return [[], []];
    return [[], []];
  });
  await assert.rejects(createAuditRepository({ mutex: testMutex }).append(event({
    requestId: REQUEST, decisionId: 31
  }), tx), (error) => error.code === 'DECISION_NOT_FOUND');
});

test('returns the service append contract and binds all values as parameters', async () => {
  const { tx, calls } = makeTx((sql) => {
    if (sql.includes('SELECT id_evento FROM rol_auditoria')) return [[], []];
    if (sql.includes('FROM rol_asignacion AS a')) return [[assignmentRow({ estado: 'revoked', revocado_por: 11 })], []];
    if (sql.startsWith('INSERT INTO rol_auditoria')) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
  const result = await createAuditRepository({ mutex: testMutex }).append(event({
    action: 'role_revoked', assignmentId: ASSIGNMENT, targetUserId: 22, roleId: 7,
    result: 'revoked', authorizationReference: 'policy-ref', before: 'active', after: 'revoked'
  }), tx);
  assert.deepEqual(result, { eventId: EVENT });
  const insert = calls.find((x) => x.sql.startsWith('INSERT INTO rol_auditoria'));
  assert.equal((insert.sql.match(/\?/g) || []).length, 18);
  assert.equal(insert.params.length, 18);
});

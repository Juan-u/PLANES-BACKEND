const MAX_INT = 2147483647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECISION_ACTIONS = new Map([
  ['role_change_request_expired', { state: 'expired', result: 'expired', actor: 'system' }],
  ['role_change_rejected', { state: 'rejected', result: 'rejected', actor: 'user' }],
  ['role_assignment_approved', { state: 'approved', result: 'approved', actor: 'user', action: 'assign' }],
  ['role_revocation_approved', { state: 'approved', result: 'approved', actor: 'user', action: 'revoke' }]
]);
const REQUEST_ACTIONS = new Map([
  ['role_assignment_requested', { state: 'pending_approval', action: 'assign' }],
  ['role_revocation_requested', { state: 'pending_approval', action: 'revoke' }]
]);
export class AuditRepositoryError extends Error {
  constructor(code, message) { super(message); this.name = 'AuditRepositoryError'; this.code = code; }
}
function fail(code, message) { throw new AuditRepositoryError(code, message); }
function requireTx(tx, mutex) {
  if (!tx || typeof tx.execute !== 'function') fail('TRANSACTION_REQUIRED', 'A transaction with execute() is required.');
  if (!mutex || typeof mutex.assertHeld !== 'function') fail('MUTEX_GUARD_REQUIRED', 'A mutex guard is required.');
  mutex.assertHeld(tx);
}
function rows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) fail('INVALID_PERSISTENCE_RESULT', 'Invalid mysql2 result.');
  return result[0];
}
function affected(result) {
  const count = Array.isArray(result) ? result[0]?.affectedRows : null;
  return Number.isSafeInteger(count) ? count : null;
}
function intId(value, name, nullable = false) {
  if (value == null && nullable) return null;
  const number = typeof value === 'number' ? value :
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_INT) {
    fail('INVALID_IDENTIFIER', name + ' must be a positive signed INT.');
  }
  return number;
}
function uuid(value, name, nullable = false) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || !UUID_V4.test(value)) fail('INVALID_IDENTIFIER', name + ' must be a lowercase UUID v4.');
  return value;
}
function nonEmpty(value, name, maxLength = Infinity) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    fail('INVALID_AUDIT_EVENT', name + ' is missing or exceeds its schema limit.');
  }
  return value;
}
function optionalText(value, name, maxLength = Infinity) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > maxLength) fail('INVALID_AUDIT_EVENT', name + ' must be text within its schema limit.');
  return value;
}
function instant(value, name) {
  if (typeof value !== 'string' && !(value instanceof Date)) fail('INVALID_AUDIT_EVENT', name + ' must be an ISO instant.');
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) fail('INVALID_AUDIT_EVENT', name + ' must include an ISO timezone.');
    const year = +match[1], month = +match[2], day = +match[3];
    const hour = +match[4], minute = +match[5], second = +match[6];
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
        hour > 23 || minute > 59 || second > 59 ||
        (match[8] !== 'Z' && (+value.slice(-5, -3) > 23 || +value.slice(-2) > 59))) {
      fail('INVALID_AUDIT_EVENT', name + ' is not a real calendar instant.');
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('INVALID_AUDIT_EVENT', name + ' is invalid.');
  return date;
}
function sqlDate(date) { return date.toISOString().slice(0, 23).replace('T', ' '); }
function fromSqlDate(value, name) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== 'string') fail('INVALID_PERSISTENCE_RESULT', name + ' is invalid.');
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(date.getTime())) fail('INVALID_PERSISTENCE_RESULT', name + ' is invalid.');
  return date.toISOString();
}
function scopeInput(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return { kind: 'number', value: String(value), original: value };
  }
  if (typeof value === 'string' && value.trim() !== '') return { kind: 'string', value, original: value };
  fail('INVALID_SCOPE_REFERENCE', 'scopeRef must be a positive integer or a non-empty string.');
}
function scopeValue(row) {
  if (row.id_scope_ref == null) return null;
  if (row.ref_kind === 'string' && typeof row.ref_value === 'string') return row.ref_value;
  if (row.ref_kind === 'number' && typeof row.ref_value === 'string' && /^[1-9]\d*$/.test(row.ref_value)) {
    const number = Number(row.ref_value);
    if (Number.isSafeInteger(number)) return number;
  }
  fail('INVALID_PERSISTENCE_RESULT', 'Stored scopeRef cannot be reconstructed exactly.');
}
function compareOptionalNumber(input, actual, name) {
  if (input === undefined) return;
  const expected = input == null ? null : intId(input, name);
  if (expected !== actual) fail('AUDIT_REFERENCE_MISMATCH', name + ' does not match its referenced record.');
}

export function createAuditRepository({ mutex } = {}) {
  async function findScope(scopeRef, tx) {
    if (scopeRef == null) return null;
    const encoded = scopeInput(scopeRef);
    const found = rows(await tx.execute(
      `SELECT id_scope_ref, ref_kind, ref_value
         FROM rol_scope_ref
        WHERE ref_kind = ? AND BINARY ref_value = BINARY ?
        LIMIT 2`, [encoded.kind, encoded.value]));
    if (found.length !== 1 || found[0].ref_kind !== encoded.kind || found[0].ref_value !== encoded.value) {
      fail('SCOPE_REFERENCE_NOT_FOUND', 'The exact scopeRef does not resolve to one stored reference.');
    }
    return intId(found[0].id_scope_ref, 'id_scope_ref');
  }
  async function loadAssignment(id, tx) {
    if (id == null) return null;
    const found = rows(await tx.execute(
      `SELECT a.id_asignacion, a.id_usuario, a.id_rol, a.id_scope_ref, a.estado,
              a.creado_por, a.revocado_por, sr.ref_kind, sr.ref_value
         FROM rol_asignacion AS a
         LEFT JOIN rol_scope_ref AS sr ON sr.id_scope_ref = a.id_scope_ref
        WHERE a.id_asignacion = ?
        LIMIT 1`, [uuid(id, 'assignmentId')]));
    if (found.length === 0) fail('ASSIGNMENT_REFERENCE_NOT_FOUND', 'The audit assignment reference does not exist.');
    if (found.length !== 1) fail('INVALID_PERSISTENCE_RESULT', 'Assignment reference is not unique.');
    const row = found[0];
    return {
      id: row.id_asignacion, userId: intId(row.id_usuario, 'id_usuario'),
      roleId: intId(row.id_rol, 'id_rol'),
      scopeId: row.id_scope_ref == null ? null : intId(row.id_scope_ref, 'id_scope_ref'),
      scopeRef: scopeValue(row), status: row.estado,
      createdBy: intId(row.creado_por, 'creado_por'),
      revokedBy: row.revocado_por == null ? null : intId(row.revocado_por, 'revocado_por')
    };
  }
  async function loadRequest(id, tx) {
    if (id == null) return null;
    const found = rows(await tx.execute(
      `SELECT id_solicitud, tipo_accion, id_usuario_solicitante, id_usuario_objetivo, id_rol,
              id_scope_ref, id_asignacion_objetivo, id_asignacion_resultado, estado
         FROM rol_solicitud WHERE id_solicitud = ? LIMIT 1`, [uuid(id, 'requestId')]));
    if (found.length === 0) fail('REQUEST_REFERENCE_NOT_FOUND', 'The audit request reference does not exist.');
    if (found.length !== 1) fail('INVALID_PERSISTENCE_RESULT', 'Request reference is not unique.');
    const row = found[0];
    return {
      id: row.id_solicitud, action: row.tipo_accion,
      requesterId: intId(row.id_usuario_solicitante, 'id_usuario_solicitante'),
      targetUserId: row.id_usuario_objetivo == null ? null : intId(row.id_usuario_objetivo, 'id_usuario_objetivo'),
      roleId: row.id_rol == null ? null : intId(row.id_rol, 'id_rol'),
      scopeId: row.id_scope_ref == null ? null : intId(row.id_scope_ref, 'id_scope_ref'),
      targetAssignmentId: row.id_asignacion_objetivo,
      resultAssignmentId: row.id_asignacion_resultado, state: row.estado
    };
  }
  async function decisionForRequest(request, requestedDecisionId, expected, event, tx) {
    if (!request) {
      if (requestedDecisionId != null) fail('DECISION_REQUEST_REQUIRED', 'A decision reference requires its request.');
      return null;
    }
    const decisionId = requestedDecisionId == null ? null : intId(requestedDecisionId, 'decisionId');
    const sql = decisionId == null
      ? `SELECT id_solicitud, id_decision, tipo_actor, id_usuario_decisor, resultado
           FROM rol_decision WHERE id_solicitud = ? LIMIT 2`
      : `SELECT id_solicitud, id_decision, tipo_actor, id_usuario_decisor, resultado
           FROM rol_decision WHERE id_solicitud = ? AND id_decision = ? LIMIT 2`;
    const params = decisionId == null ? [request.id] : [request.id, decisionId];
    const found = rows(await tx.execute(sql, params));
    if (found.length > 1) fail('INVALID_PERSISTENCE_RESULT', 'A request has multiple decision records.');
    const decision = found[0] ?? null;
    if (decision && decision.id_solicitud !== request.id) fail('DECISION_REQUEST_MISMATCH', 'Decision belongs to a different request.');
    if (decisionId != null && !decision) fail('DECISION_NOT_FOUND', 'The requested decision does not belong to the request.');
    if (expected && !decision) fail('DECISION_REQUIRED', 'This audit event requires a recorded decision.');
    if (!expected && decision) fail('AUDIT_REQUEST_STATE_MISMATCH', 'A request event must not be linked to a later decision.');
    if (expected && decision) {
      if (request.state !== expected.state || request.action !== expected.action && expected.action != null ||
          decision.resultado !== expected.result || decision.tipo_actor !== expected.actor) {
        fail('AUDIT_REQUEST_STATE_MISMATCH', 'Request and decision do not match the audit event.');
      }
      if (expected.actor === 'system') {
        if (decision.id_usuario_decisor != null || event.actorId != null) fail('AUDIT_ACTOR_MISMATCH', 'System decision must have no user actor.');
      } else if (intId(decision.id_usuario_decisor, 'id_usuario_decisor') !== intId(event.actorId, 'actorId')) {
        fail('AUDIT_ACTOR_MISMATCH', 'Audit actor does not match the recorded decision actor.');
      }
    }
    return decision ? intId(decision.id_decision, 'id_decision') : null;
  }

  return Object.freeze({
    async append(event, tx) {
      requireTx(tx, mutex);
      if (!event || typeof event !== 'object') fail('INVALID_AUDIT_EVENT', 'Audit event is required.');
      const eventId = uuid(event.eventId, 'eventId');
      const action = nonEmpty(event.action, 'action', 64);
      const actorType = event.actorType;
      if (!['user', 'system'].includes(actorType)) fail('INVALID_AUDIT_EVENT', 'actorType must be user or system.');
      const actorId = actorType === 'user' ? intId(event.actorId, 'actorId') :
        event.actorId == null ? null : fail('INVALID_AUDIT_EVENT', 'System audit events cannot have a user actor.');
      const occurredAt = instant(event.occurredAt, 'occurredAt');
      const reason = nonEmpty(event.reason, 'reason');
      const result = event.result == null ? null : nonEmpty(event.result, 'result', 20);
      const authorizationReference = optionalText(event.authorizationReference, 'authorizationReference');
      const before = optionalText(event.before, 'before');
      const after = optionalText(event.after, 'after');
      const requestId = uuid(event.requestId, 'requestId', true);
      const assignmentId = uuid(event.assignmentId, 'assignmentId', true);
      const suppliedDecisionId = event.decisionId == null ? null : intId(event.decisionId, 'decisionId');
      const delegationId = event.delegationId == null ? null : intId(event.delegationId, 'delegationId');
      const permissionId = event.permissionId == null ? null : intId(event.permissionId, 'permissionId');
      const eventTargetUserId = event.targetUserId == null ? null : intId(event.targetUserId, 'targetUserId');
      const eventRoleId = event.roleId == null ? null : intId(event.roleId, 'roleId');

      const duplicate = rows(await tx.execute(
        `SELECT id_evento FROM rol_auditoria WHERE id_evento = ? LIMIT 1`, [eventId]));
      if (duplicate.length) fail('DUPLICATE_EVENT', 'An audit event with this ID already exists.');

      const request = await loadRequest(requestId, tx);
      const expectedDecision = DECISION_ACTIONS.get(action) ?? null;
      const expectedRequest = REQUEST_ACTIONS.get(action) ?? null;
      if (expectedRequest && (!request || request.action !== expectedRequest.action || request.state !== expectedRequest.state)) {
        fail('AUDIT_REQUEST_STATE_MISMATCH', 'Request does not match the requested audit event.');
      }
      if (expectedDecision && !request) fail('REQUEST_REFERENCE_REQUIRED', 'This audit event requires a request.');
      const decisionId = await decisionForRequest(request, suppliedDecisionId, expectedDecision, event, tx);

      let linkedAssignmentId = assignmentId;
      if (!linkedAssignmentId && request) {
        if (action === 'role_assignment_approved') linkedAssignmentId = request.resultAssignmentId;
        if (request.action === 'revoke') linkedAssignmentId = request.targetAssignmentId;
      }
      const assignment = await loadAssignment(linkedAssignmentId, tx);
      if (linkedAssignmentId && !assignment) fail('ASSIGNMENT_REFERENCE_NOT_FOUND', 'Assignment reference does not exist.');

      let targetUserId = eventTargetUserId;
      let roleId = eventRoleId;
      let scopeId;
      let hasScopeId = false;
      if (Object.hasOwn(event, 'scopeRef')) {
        scopeId = await findScope(event.scopeRef, tx);
        hasScopeId = true;
      }
      if (assignment) {
        if (targetUserId != null && targetUserId !== assignment.userId) fail('AUDIT_REFERENCE_MISMATCH', 'Target user does not match the assignment.');
        if (roleId != null && roleId !== assignment.roleId) fail('AUDIT_REFERENCE_MISMATCH', 'Role does not match the assignment.');
        if (hasScopeId && scopeId !== assignment.scopeId) fail('AUDIT_REFERENCE_MISMATCH', 'Scope does not match the assignment.');
        targetUserId ??= assignment.userId;
        roleId ??= assignment.roleId;
        if (!hasScopeId) { scopeId = assignment.scopeId; hasScopeId = true; }
        if (action === 'role_assigned' && assignment.createdBy !== actorId) fail('AUDIT_ACTOR_MISMATCH', 'Creator does not match the audit actor.');
        if ((action === 'role_revoked' || action === 'role_revocation_approved') &&
            (assignment.status !== 'revoked' || assignment.revokedBy !== actorId)) {
          fail('AUDIT_ACTOR_MISMATCH', 'Revocation does not match the recorded actor.');
        }
        if (action === 'role_assignment_approved' &&
            (assignment.status !== 'active' && assignment.status !== 'scheduled')) {
          fail('AUDIT_REFERENCE_MISMATCH', 'Approved assignment is not in an assignable state.');
        }
      }
      if (request) {
        if (request.action === 'assign') {
          if (targetUserId != null && targetUserId !== request.targetUserId) fail('AUDIT_REFERENCE_MISMATCH', 'Target user does not match the request.');
          if (roleId != null && roleId !== request.roleId) fail('AUDIT_REFERENCE_MISMATCH', 'Role does not match the request.');
          if (hasScopeId && scopeId !== request.scopeId) fail('AUDIT_REFERENCE_MISMATCH', 'Scope does not match the request.');
          targetUserId ??= request.targetUserId;
          roleId ??= request.roleId;
          if (!hasScopeId) { scopeId = request.scopeId; hasScopeId = true; }
        } else if (request.action === 'revoke') {
          if (request.targetAssignmentId !== (assignment?.id ?? assignmentId)) fail('AUDIT_REFERENCE_MISMATCH', 'Revocation target does not match the request.');
          if (!assignment) fail('ASSIGNMENT_REFERENCE_NOT_FOUND', 'Revocation request target is missing.');
          if (targetUserId != null && targetUserId !== assignment.userId) fail('AUDIT_REFERENCE_MISMATCH', 'Target user does not match the revocation target.');
          if (roleId != null && roleId !== assignment.roleId) fail('AUDIT_REFERENCE_MISMATCH', 'Role does not match the revocation target.');
          if (hasScopeId && scopeId !== assignment.scopeId) fail('AUDIT_REFERENCE_MISMATCH', 'Scope does not match the revocation target.');
          targetUserId ??= assignment.userId;
          roleId ??= assignment.roleId;
          if (!hasScopeId) { scopeId = assignment.scopeId; hasScopeId = true; }
        }
        if (expectedRequest && actorId !== request.requesterId) fail('AUDIT_ACTOR_MISMATCH', 'Request actor does not match its requester.');
        if (expectedDecision && expectedDecision.action === 'assign' &&
            (request.resultAssignmentId == null || request.resultAssignmentId !== assignment?.id)) {
          fail('AUDIT_REFERENCE_MISMATCH', 'Approved assignment is not the request result.');
        }
      }

      if (assignmentId != null && linkedAssignmentId !== assignmentId) fail('AUDIT_REFERENCE_MISMATCH', 'Assignment reference does not match the request.');
      const scopeRefId = hasScopeId ? scopeId : null;
      const insert = await tx.execute(
        `INSERT INTO rol_auditoria
          (id_evento, tipo_actor, id_usuario_actor, accion, resultado, ocurrida_en, motivo,
           referencia_autorizacion, id_usuario_objetivo, id_rol, id_scope_ref, id_solicitud,
           id_decision, id_asignacion, id_delegacion, id_permiso, antes, despues)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, actorType, actorId, action, result, sqlDate(occurredAt), reason,
          authorizationReference, targetUserId, roleId, scopeRefId, requestId, decisionId,
          linkedAssignmentId, delegationId, permissionId, before, after]);
      if (affected(insert) !== 1) fail('AUDIT_INSERT_FAILED', 'Audit event was not inserted.');
      return { eventId };
    }
  });
}

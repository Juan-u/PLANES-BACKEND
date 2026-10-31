const MAX_INT = 2147483647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ChangeRequestsRepositoryError extends Error {
  constructor(code, message) { super(message); this.name = 'ChangeRequestsRepositoryError'; this.code = code; }
}
function fail(code, message) { throw new ChangeRequestsRepositoryError(code, message); }
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
  const value = Array.isArray(result) ? result[0]?.affectedRows : null;
  return Number.isSafeInteger(value) ? value : null;
}
function dbInt(value, name) {
  const n = typeof value === 'number' ? value :
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_INT) fail('INVALID_IDENTIFIER', name + ' must be a positive signed INT.');
  return n;
}
function uuid(value, name) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) fail('INVALID_IDENTIFIER', name + ' must be a lowercase UUID v4.');
  return value;
}
function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_VALUE', name + ' must be non-empty.');
  return value.trim();
}
function instant(value, name, nullable = false) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' && !(value instanceof Date)) fail('INVALID_DATE', name + ' must be an ISO instant.');
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) fail('INVALID_DATE', name + ' must include an ISO timezone.');
    const year = +match[1], month = +match[2], day = +match[3];
    const hour = +match[4], minute = +match[5], second = +match[6];
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
        hour > 23 || minute > 59 || second > 59 ||
        (match[8] !== 'Z' && (+value.slice(-5, -3) > 23 || +value.slice(-2) > 59))) {
      fail('INVALID_DATE', name + ' is not a real calendar instant.');
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('INVALID_DATE', name + ' is invalid.');
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
function nullableBool(value, name) {
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  fail('ROLE_CONFIGURATION_REQUIRED', name + ' is missing or invalid.');
}
function exactInt(a, b) {
  try { return dbInt(a, 'id') === dbInt(b, 'id'); } catch { return false; }
}
function scopeValue(row) {
  if (row.id_scope_ref == null) return null;
  if (row.ref_kind === 'string' && typeof row.ref_value === 'string') return row.ref_value;
  if (row.ref_kind === 'number' && typeof row.ref_value === 'string' && /^[1-9]\d*$/.test(row.ref_value)) {
    const n = Number(row.ref_value);
    if (Number.isSafeInteger(n)) return n;
  }
  fail('INVALID_PERSISTENCE_RESULT', 'Stored scopeRef cannot be reconstructed without changing its type.');
}
function comparableDate(value, name) {
  return value == null ? null : instant(fromSqlDate(value, name), name).getTime();
}
function matchNullableDate(dbValue, inputValue, name) {
  const left = comparableDate(dbValue, name);
  const right = inputValue == null ? null : instant(inputValue, name).getTime();
  return left === right;
}

export function createChangeRequestsRepository({ scopeRefs, mutex } = {}) {
  async function roleSettings(roleId, tx) {
    const found = rows(await tx.execute(
      `SELECT clasificacion_privilegio, requiere_ambito
         FROM rol_configuracion WHERE id_rol = ? LIMIT 1`, [roleId]));
    if (found.length !== 1) fail('ROLE_CONFIGURATION_REQUIRED', 'Role configuration is required.');
    const item = found[0];
    if (item.clasificacion_privilegio !== 'privileged') fail('ROLE_NOT_PRIVILEGED', 'Change requests require a privileged role.');
    return { requiresScope: nullableBool(item.requiere_ambito, 'requiere_ambito') };
  }
  async function resolveScope(scopeRef, roleId, tx, required) {
    if (scopeRef == null) {
      if (required) fail('SCOPE_REQUIRED', 'This role requires a scope reference.');
      return null;
    }
    if (!scopeRefs || typeof scopeRefs.resolveForRole !== 'function') fail('SCOPE_RESOLVER_REQUIRED', 'A scope reference resolver is required.');
    const resolved = await scopeRefs.resolveForRole(scopeRef, roleId, tx);
    if (!resolved || !Number.isSafeInteger(resolved.idScopeRef) || resolved.idScopeRef < 1 || resolved.scopeRef !== scopeRef) {
      fail('SCOPE_REFERENCE_MISMATCH', 'The scope resolver returned an invalid or changed reference.');
    }
    return resolved;
  }
  async function loadAssignment(assignmentId, tx, lock = false) {
    const sql = `SELECT a.id_asignacion, a.id_usuario, a.id_rol, a.id_scope_ref, a.vigente_desde,
                        a.vigente_hasta, a.estado, a.creado_por, a.motivo, sr.ref_kind, sr.ref_value
                   FROM rol_asignacion AS a
                   LEFT JOIN rol_scope_ref AS sr ON sr.id_scope_ref = a.id_scope_ref
                  WHERE a.id_asignacion = ? LIMIT 1` + (lock ? ' FOR UPDATE' : '');
    const found = rows(await tx.execute(sql, [uuid(assignmentId, 'assignmentId')]));
    if (found.length === 0) return null;
    if (found.length !== 1) fail('INVALID_PERSISTENCE_RESULT', 'Assignment target is not unique.');
    const a = found[0];
    return {
      assignmentId: a.id_asignacion, userId: dbInt(a.id_usuario, 'id_usuario'),
      roleId: dbInt(a.id_rol, 'id_rol'), scopeRef: scopeValue(a),
      validFrom: fromSqlDate(a.vigente_desde, 'vigente_desde'),
      validUntil: a.vigente_hasta == null ? null : fromSqlDate(a.vigente_hasta, 'vigente_hasta'),
      status: a.estado
    };
  }
  function sameAssignmentSnapshot(a, b) {
    return a && b && a.assignmentId === b.assignmentId && a.userId === b.userId &&
      a.roleId === b.roleId && a.scopeRef === b.scopeRef && a.validFrom === b.validFrom &&
      a.validUntil === b.validUntil && a.status === b.status;
  }

  async function requestRow(requestId, tx, lock = false) {
    const sql = `SELECT id_solicitud, tipo_accion, id_usuario_solicitante, id_usuario_objetivo,
                        id_rol, id_scope_ref, id_asignacion_objetivo, id_asignacion_resultado,
                        vigente_desde, vigente_hasta, estado, motivo, solicitada_en, vence_en
                   FROM rol_solicitud WHERE id_solicitud = ? LIMIT 1` + (lock ? ' FOR UPDATE' : '');
    const found = rows(await tx.execute(sql, [uuid(requestId, 'requestId')]));
    if (found.length === 0) return null;
    if (found.length !== 1) fail('INVALID_PERSISTENCE_RESULT', 'Request ID is not unique.');
    return found[0];
  }
  async function hydrate(row, tx, lockAssignment) {
    const requestId = row.id_solicitud;
    const action = row.tipo_accion;
    if (action === 'assign') {
      if (row.id_usuario_objetivo == null || row.id_rol == null || row.id_asignacion_objetivo != null) {
        fail('INVALID_PERSISTENCE_RESULT', 'Assignment request fields contradict the schema.');
      }
      const scope = row.id_scope_ref == null ? null : await scopeValueForId(row.id_scope_ref, tx);
      return {
        requestId, action, requestedBy: dbInt(row.id_usuario_solicitante, 'id_usuario_solicitante'),
        requestedAt: fromSqlDate(row.solicitada_en, 'solicitada_en'), expiresAt: fromSqlDate(row.vence_en, 'vence_en'),
        targetUserId: dbInt(row.id_usuario_objetivo, 'id_usuario_objetivo'), roleId: dbInt(row.id_rol, 'id_rol'),
        scopeRef: scope, assignmentId: null,
        validFrom: fromSqlDate(row.vigente_desde, 'vigente_desde'),
        validUntil: row.vigente_hasta == null ? null : fromSqlDate(row.vigente_hasta, 'vigente_hasta'),
        status: row.estado, reason: row.motivo
      };
    }
    if (action !== 'revoke' || row.id_asignacion_objetivo == null ||
        row.id_usuario_objetivo != null || row.id_rol != null || row.id_scope_ref != null ||
        row.id_asignacion_resultado != null || row.vigente_desde != null || row.vigente_hasta != null) {
      fail('INVALID_PERSISTENCE_RESULT', 'Revocation request fields contradict the schema.');
    }
    const assignment = await loadAssignment(row.id_asignacion_objetivo, tx, lockAssignment);
    if (!assignment || assignment.assignmentId !== row.id_asignacion_objetivo) {
      fail('ASSIGNMENT_TARGET_NOT_FOUND', 'The revocation target assignment does not exist.');
    }
    return {
      requestId, action, requestedBy: dbInt(row.id_usuario_solicitante, 'id_usuario_solicitante'),
      requestedAt: fromSqlDate(row.solicitada_en, 'solicitada_en'), expiresAt: fromSqlDate(row.vence_en, 'vence_en'),
      targetUserId: assignment.userId, roleId: assignment.roleId, scopeRef: assignment.scopeRef,
      assignmentId: assignment.assignmentId, validFrom: null, validUntil: null,
      status: row.estado, reason: row.motivo
    };
  }
  async function scopeValueForId(idScopeRef, tx) {
    const found = rows(await tx.execute(
      `SELECT ref_kind, ref_value FROM rol_scope_ref WHERE id_scope_ref = ? LIMIT 1`,
      [dbInt(idScopeRef, 'id_scope_ref')]));
    if (found.length !== 1) fail('INVALID_PERSISTENCE_RESULT', 'Scope reference for request does not exist.');
    return scopeValue({ id_scope_ref: idScopeRef, ...found[0] });
  }

  return Object.freeze({
    async hasEquivalentPending(change, tx) {
      requireTx(tx, mutex);
      if (!change || typeof change !== 'object' || !['assign', 'revoke'].includes(change.action)) {
        fail('INVALID_REQUEST', 'A supported change action is required.');
      }
      if (change.action === 'assign') {
        const userId = dbInt(change.targetUserId, 'targetUserId');
        const roleId = dbInt(change.roleId, 'roleId');
        const settings = await roleSettings(roleId, tx);
        const scope = await resolveScope(change.scopeRef ?? null, roleId, tx, settings.requiresScope);
        const from = instant(change.validFrom, 'validFrom');
        const until = instant(change.validUntil, 'validUntil', true);
        if (until && until.getTime() <= from.getTime()) fail('INVALID_VALIDITY', 'validUntil must follow validFrom.');
        const found = rows(await tx.execute(
          `SELECT id_solicitud FROM rol_solicitud
            WHERE estado = 'pending_approval' AND tipo_accion = 'assign'
              AND id_usuario_objetivo = ? AND id_rol = ? AND id_scope_ref <=> ?
              AND vigente_desde = ? AND vigente_hasta <=> ? LIMIT 1`,
          [userId, roleId, scope?.idScopeRef ?? null, sqlDate(from), until ? sqlDate(until) : null]));
        return found.length > 0;
      }
      const assignmentId = uuid(change.assignmentId, 'assignmentId');
      const found = rows(await tx.execute(
        `SELECT id_solicitud FROM rol_solicitud
          WHERE estado = 'pending_approval' AND tipo_accion = 'revoke'
            AND id_asignacion_objetivo = ? LIMIT 1`, [assignmentId]));
      return found.length > 0;
    },

    async createPending(fields, tx) {
      requireTx(tx, mutex);
      if (!fields || typeof fields !== 'object') fail('INVALID_REQUEST', 'Request fields are required.');
      const requestId = uuid(fields.requestId, 'requestId');
      const requestedBy = dbInt(fields.requestedBy, 'requestedBy');
      const requestedAt = instant(fields.requestedAt, 'requestedAt');
      const expiresAt = instant(fields.expiresAt, 'expiresAt');
      if (expiresAt.getTime() <= requestedAt.getTime()) fail('INVALID_VALIDITY', 'expiresAt must follow requestedAt.');
      if (fields.status !== 'pending_approval') fail('INVALID_REQUEST_STATUS', 'New requests must be pending_approval.');
      const why = nonEmpty(fields.reason, 'reason');
      if (!['assign', 'revoke'].includes(fields.action)) fail('INVALID_REQUEST_ACTION', 'Unsupported request action.');

      if (fields.action === 'assign') {
        const userId = dbInt(fields.targetUserId, 'targetUserId');
        const roleId = dbInt(fields.roleId, 'roleId');
        const settings = await roleSettings(roleId, tx);
        const scope = await resolveScope(fields.scopeRef ?? null, roleId, tx, settings.requiresScope);
        const from = instant(fields.validFrom, 'validFrom');
        const until = instant(fields.validUntil, 'validUntil', true);
        if (from.getTime() < requestedAt.getTime() || (until && until.getTime() <= from.getTime())) {
          fail('INVALID_VALIDITY', 'Assignment validity must be coherent with its request.');
        }
        await tx.execute(
          `INSERT INTO rol_solicitud
            (id_solicitud, tipo_accion, id_usuario_solicitante, id_usuario_objetivo, id_rol,
             id_scope_ref, id_asignacion_objetivo, id_asignacion_resultado, vigente_desde, vigente_hasta,
             estado, motivo, solicitada_en, vence_en)
           VALUES (?, 'assign', ?, ?, ?, ?, NULL, NULL, ?, ?, 'pending_approval', ?, ?, ?)`,
          [requestId, requestedBy, userId, roleId, scope?.idScopeRef ?? null,
            sqlDate(from), until ? sqlDate(until) : null, why, sqlDate(requestedAt), sqlDate(expiresAt)]);
        return { requestId, status: 'pending_approval' };
      }

      const assignmentId = uuid(fields.assignmentId, 'assignmentId');
      const targetPreview = await loadAssignment(assignmentId, tx, false);
      if (!targetPreview || targetPreview.assignmentId !== assignmentId) fail('ASSIGNMENT_TARGET_NOT_FOUND', 'The revocation target assignment does not exist.');
      if (!['active', 'scheduled'].includes(targetPreview.status)) fail('ASSIGNMENT_NOT_REVOCABLE', 'The target assignment is not revocable.');
      const settings = await roleSettings(targetPreview.roleId, tx);
      let targetScopeId = null;
      if (targetPreview.scopeRef == null && settings.requiresScope) fail('SCOPE_REQUIRED', 'The target role requires a scope.');
      if (targetPreview.scopeRef != null) {
        const resolved = await resolveScope(targetPreview.scopeRef, targetPreview.roleId, tx, settings.requiresScope);
        targetScopeId = resolved.idScopeRef;
      }
      const previewStart = instant(targetPreview.validFrom, 'validFrom');
      const previewEnd = targetPreview.validUntil == null ? null : instant(targetPreview.validUntil, 'validUntil');
      if (previewEnd && requestedAt.getTime() >= previewEnd.getTime()) fail('ASSIGNMENT_NOT_REVOCABLE', 'The target assignment has expired.');

      // A direct revoke INSERT checks the assignment FK before creating/locking
      // its request row, which would invert request -> assignment in InnoDB.
      // Create a valid, uncommitted assignment-shaped request first (without an
      // assignment FK), then lock/revalidate the target, and convert the row to
      // its final revoke shape. No intermediate state can be committed by this
      // repository; any failure rejects and rolls the whole transaction back.
      await tx.execute(
        `INSERT INTO rol_solicitud
          (id_solicitud, tipo_accion, id_usuario_solicitante, id_usuario_objetivo, id_rol,
           id_scope_ref, id_asignacion_objetivo, id_asignacion_resultado, vigente_desde, vigente_hasta,
           estado, motivo, solicitada_en, vence_en)
         VALUES (?, 'assign', ?, ?, ?, ?, NULL, NULL, ?, ?, 'pending_approval', ?, ?, ?)`,
        [requestId, requestedBy, targetPreview.userId, targetPreview.roleId, targetScopeId,
          sqlDate(previewStart), previewEnd ? sqlDate(previewEnd) : null, why,
          sqlDate(requestedAt), sqlDate(expiresAt)]);

      const targetLocked = await loadAssignment(assignmentId, tx, true);
      if (!sameAssignmentSnapshot(targetPreview, targetLocked)) {
        fail('ASSIGNMENT_TARGET_CHANGED', 'The revocation target changed while the request was being created.');
      }
      if (!['active', 'scheduled'].includes(targetLocked.status)) fail('ASSIGNMENT_NOT_REVOCABLE', 'The target assignment is no longer revocable.');
      const lockedEnd = targetLocked.validUntil == null ? null : instant(targetLocked.validUntil, 'validUntil');
      if (lockedEnd && requestedAt.getTime() >= lockedEnd.getTime()) fail('ASSIGNMENT_NOT_REVOCABLE', 'The target assignment has expired.');

      const converted = await tx.execute(
        `UPDATE rol_solicitud
            SET tipo_accion = 'revoke', id_usuario_objetivo = NULL, id_rol = NULL, id_scope_ref = NULL,
                id_asignacion_objetivo = ?, id_asignacion_resultado = NULL, vigente_desde = NULL, vigente_hasta = NULL
          WHERE id_solicitud = ? AND tipo_accion = 'assign' AND estado = 'pending_approval'
            AND id_asignacion_objetivo IS NULL`, [assignmentId, requestId]);
      if (affected(converted) !== 1) fail('REQUEST_NOT_PENDING', 'The request could not be converted to a revocation.');
      return { requestId, status: 'pending_approval' };
    },

    async getById(requestId, tx) {
      requireTx(tx, mutex);
      const row = await requestRow(requestId, tx, false);
      if (!row) return null;
      return hydrate(row, tx, false);
    },

    async getByIdForUpdate(requestId, tx) {
      requireTx(tx, mutex);
      const row = await requestRow(requestId, tx, true);
      if (!row) return null;
      return hydrate(row, tx, row.tipo_accion === 'revoke');
    },

    async decideIfPending(requestId, decision, tx) {
      requireTx(tx, mutex);
      const id = uuid(requestId, 'requestId');
      if (!decision || typeof decision !== 'object') fail('INVALID_DECISION', 'Decision fields are required.');
      const status = decision.status;
      const actorType = decision.decisionActorType;
      if (!['approved', 'rejected', 'expired'].includes(status)) fail('INVALID_DECISION', 'Unsupported decision status.');
      if ((actorType === 'system' && (status !== 'expired' || decision.decidedBy != null)) ||
          (actorType === 'user' && (!['approved', 'rejected'].includes(status) || decision.decidedBy == null)) ||
          !['system', 'user'].includes(actorType)) fail('INVALID_DECISION', 'Decision actor and result do not match the SQL rules.');
      const decidedBy = actorType === 'user' ? dbInt(decision.decidedBy, 'decidedBy') : null;
      const decidedAt = instant(decision.decidedAt, 'decidedAt');
      const why = nonEmpty(decision.reason, 'reason');
      const row = await requestRow(id, tx, true);
      if (!row || row.estado !== 'pending_approval') return false;
      const expires = instant(fromSqlDate(row.vence_en, 'vence_en'), 'vence_en');
      if (status === 'expired' && decidedAt.getTime() < expires.getTime()) {
        fail('REQUEST_NOT_EXPIRED', 'System expiration cannot precede the request expiry.');
      }
      if (actorType === 'user' && decidedAt.getTime() >= expires.getTime()) return false;
      if (actorType === 'user' && exactInt(row.id_usuario_solicitante, decidedBy)) {
        fail('SELF_APPROVAL_DENIED', 'The requester cannot decide their own request.');
      }

      if (status === 'approved') {
        if (row.tipo_accion === 'assign') {
          if (row.id_asignacion_resultado == null) fail('APPROVAL_RESULT_REQUIRED', 'An approved assignment request must have a result assignment.');
          const assignment = await loadAssignment(row.id_asignacion_resultado, tx, true);
          if (!assignment || assignment.assignmentId !== row.id_asignacion_resultado ||
              !exactInt(assignment.userId, row.id_usuario_objetivo) || !exactInt(assignment.roleId, row.id_rol) ||
              !matchNullableDate(row.vigente_desde, assignment.validFrom, 'vigente_desde') ||
              !matchNullableDate(row.vigente_hasta, assignment.validUntil, 'vigente_hasta')) {
            fail('APPROVAL_RESULT_MISMATCH', 'The linked assignment does not match the request.');
          }
          const scopeDb = row.id_scope_ref == null ? null : await scopeValueForId(row.id_scope_ref, tx);
          if (scopeDb !== assignment.scopeRef) fail('APPROVAL_RESULT_MISMATCH', 'The linked assignment scope does not match the request.');
        } else if (row.tipo_accion === 'revoke') {
          if (row.id_asignacion_objetivo == null) fail('INVALID_PERSISTENCE_RESULT', 'Revocation target is missing.');
          const assignment = await loadAssignment(row.id_asignacion_objetivo, tx, true);
          if (!assignment || assignment.status !== 'revoked') fail('APPROVAL_RESULT_MISMATCH', 'The target assignment was not revoked in this transaction.');
        } else fail('INVALID_PERSISTENCE_RESULT', 'Unknown request action.');
      } else if (row.id_asignacion_resultado != null) {
        fail('INVALID_PERSISTENCE_RESULT', 'A rejected or expired request cannot have a result assignment.');
      }

      await tx.execute(
        `INSERT INTO rol_decision (id_solicitud, tipo_actor, id_usuario_decisor, resultado, decidida_en, motivo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, actorType, decidedBy, status, sqlDate(decidedAt), why]);
      const updated = await tx.execute(
        `UPDATE rol_solicitud SET estado = ?
          WHERE id_solicitud = ? AND estado = 'pending_approval'`,
        [status, id]);
      if (affected(updated) !== 1) fail('REQUEST_NOT_PENDING', 'The pending request changed during decision.');
      return true;
    }
  });
}

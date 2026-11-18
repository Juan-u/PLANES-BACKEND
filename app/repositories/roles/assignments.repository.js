const MAX_INT = 2147483647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class AssignmentsRepositoryError extends Error {
  constructor(code, message) { super(message); this.name = 'AssignmentsRepositoryError'; this.code = code; }
}
function fail(code, message) { throw new AssignmentsRepositoryError(code, message); }
function txRequired(tx, mutex) {
  if (!tx || typeof tx.execute !== 'function') fail('TRANSACTION_REQUIRED', 'A transaction with execute() is required.');
  if (!mutex || typeof mutex.assertHeld !== 'function') fail('MUTEX_GUARD_REQUIRED', 'A mutex guard is required.');
  mutex.assertHeld(tx);
}
function rows(result) { if (!Array.isArray(result) || !Array.isArray(result[0])) fail('INVALID_PERSISTENCE_RESULT', 'Invalid mysql2 result.'); return result[0]; }
function affected(result) { const n = Array.isArray(result) ? result[0]?.affectedRows : null; return Number.isSafeInteger(n) ? n : null; }
function dbInt(value, name) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_INT) fail('INVALID_IDENTIFIER', name + ' must be a positive signed INT.');
  return n;
}
function uuid(value, name) { if (typeof value !== 'string' || !UUID_V4.test(value)) fail('INVALID_IDENTIFIER', name + ' must be a lowercase UUID v4.'); return value; }
function reason(value) { if (typeof value !== 'string' || value.trim() === '') fail('INVALID_REASON', 'A non-empty reason is required.'); return value.trim(); }
function instant(value, name, nullable = false) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' && !(value instanceof Date)) fail('INVALID_VALIDITY', name + ' must be an ISO instant.');
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m) fail('INVALID_VALIDITY', name + ' must include an ISO timezone.');
    const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +m[6];
    const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (mo < 1 || mo > 12 || d < 1 || d > days[mo - 1] || h > 23 || mi > 59 || s > 59 ||
        (m[8] !== 'Z' && (+value.slice(-5, -3) > 23 || +value.slice(-2) > 59))) fail('INVALID_VALIDITY', name + ' is not a real calendar instant.');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('INVALID_VALIDITY', name + ' is invalid.');
  return date;
}
function sqlDate(date) { return date.toISOString().slice(0, 23).replace('T', ' '); }
function fromSqlDate(value, name) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== 'string') fail('INVALID_PERSISTENCE_RESULT', name + ' is invalid.');
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(d.getTime())) fail('INVALID_PERSISTENCE_RESULT', name + ' is invalid.');
  return d.toISOString();
}
function bool(value, name) {
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  fail('ROLE_CONFIGURATION_REQUIRED', name + ' is missing or invalid.');
}
function sameInt(a, b) { try { return dbInt(a, 'id') === dbInt(b, 'id'); } catch { return false; } }
function scopeValue(row) {
  if (row.id_scope_ref == null) return null;
  if (row.ref_kind === 'string' && typeof row.ref_value === 'string') return row.ref_value;
  if (row.ref_kind === 'number' && typeof row.ref_value === 'string' && /^[1-9]\d*$/.test(row.ref_value)) {
    const n = Number(row.ref_value); if (Number.isSafeInteger(n)) return n;
  }
  fail('INVALID_PERSISTENCE_RESULT', 'Stored scopeRef cannot be reconstructed exactly.');
}
function dateEqual(dbValue, iso, name) {
  const a = dbValue == null ? null : instant(fromSqlDate(dbValue, name), name);
  const b = iso == null ? null : instant(iso, name);
  return a?.getTime() === b?.getTime() || (a === null && b === null);
}
function approvalMatch(row, fields, requester, scopeId) {
  if (row.estado !== 'pending_approval' || row.tipo_accion !== 'assign' || row.id_asignacion_resultado != null ||
      !sameInt(row.id_usuario_solicitante, requester)) fail('APPROVAL_REQUIRED', 'A matching pending approval request is required.');
  if (instant(fromSqlDate(row.vence_en, 'vence_en'), 'request expiry').getTime() <= instant(fields.createdAt, 'operation time').getTime()) fail('APPROVAL_EXPIRED', 'The request has expired.');
  if (!sameInt(row.id_usuario_objetivo, fields.userId) || !sameInt(row.id_rol, fields.roleId) ||
      Number(row.id_scope_ref ?? 0) !== Number(scopeId ?? 0) ||
      !dateEqual(row.vigente_desde, fields.validFrom, 'vigente_desde') || !dateEqual(row.vigente_hasta, fields.validUntil, 'vigente_hasta')) {
    fail('APPROVAL_MISMATCH', 'The pending request does not match the assignment.');
  }
}
export function createAssignmentsRepository({ scopeRefs, mutex } = {}) {
  async function resolveScope(scopeRef, roleId, tx, required) {
    if (scopeRef == null) { if (required) fail('SCOPE_REQUIRED', 'This role requires a scope reference.'); return null; }
    if (!scopeRefs || typeof scopeRefs.resolveForRole !== 'function') fail('SCOPE_RESOLVER_REQUIRED', 'Scope resolver is required.');
    const ref = await scopeRefs.resolveForRole(scopeRef, roleId, tx);
    if (!ref || !Number.isSafeInteger(ref.idScopeRef) || ref.idScopeRef < 1 || ref.scopeRef !== scopeRef) fail('SCOPE_REFERENCE_MISMATCH', 'The scope resolver returned an invalid or changed reference.');
    return ref;
  }
  async function resolveResource(resource, roleId, tx) {
    if (!scopeRefs || typeof scopeRefs.resolveResourceForRole !== 'function') {
      fail('SCOPE_RESOLVER_REQUIRED', 'Typed resource scope resolver is required.');
    }
    const ref = await scopeRefs.resolveResourceForRole(resource, roleId, tx);
    if (!ref || !Number.isSafeInteger(ref.idScopeRef) || ref.idScopeRef < 1 ||
        typeof ref.scopeRef !== 'string' || ref.resourceType !== resource.type ||
        ref.resourceId !== Number(resource.id)) {
      fail('SCOPE_RESOURCE_MISMATCH', 'The resource resolver returned a mismatched scope.');
    }
    return ref;
  }
  async function configFor(roleId, tx) {
    const found = rows(await tx.execute(
      `SELECT clasificacion_privilegio, permite_vigencia_indefinida, requiere_ambito FROM rol_configuracion WHERE id_rol = ? LIMIT 1`, [roleId]));
    if (found.length !== 1) fail('ROLE_CONFIGURATION_REQUIRED', 'Role configuration is required.');
    const c = found[0];
    if (!['ordinary', 'privileged'].includes(c.clasificacion_privilegio)) fail('ROLE_CLASSIFICATION_REQUIRED', 'Role classification is missing.');
    return { classification: c.clasificacion_privilegio, open: bool(c.permite_vigencia_indefinida, 'permite_vigencia_indefinida'),
      scoped: bool(c.requiere_ambito, 'requiere_ambito') };
  }
  async function requestForUpdate(requestId, tx) {
    const found = rows(await tx.execute(
      `SELECT id_solicitud, tipo_accion, id_usuario_solicitante, id_usuario_objetivo, id_rol, id_scope_ref,
              id_asignacion_objetivo, id_asignacion_resultado, vigente_desde, vigente_hasta, estado, vence_en
         FROM rol_solicitud WHERE id_solicitud = ? LIMIT 1 FOR UPDATE`, [uuid(requestId, 'approvalRequestId')]));
    if (found.length !== 1) fail('APPROVAL_REQUIRED', 'Approval request does not exist.');
    if (rows(await tx.execute('SELECT id_decision FROM rol_decision WHERE id_solicitud = ? LIMIT 1', [requestId])).length) {
      fail('APPROVAL_ALREADY_DECIDED', 'Approval request already has a decision.');
    }
    return found[0];
  }
  async function read(assignmentId, tx, lock = false) {
    const sql = `SELECT a.id_asignacion, a.id_usuario, a.id_rol, a.id_scope_ref, a.vigente_desde, a.vigente_hasta,
                        a.estado, a.creado_por, a.creado_en, a.motivo, a.revocado_por, a.revocado_en,
                        a.motivo_revocacion, sr.ref_kind, sr.ref_value
                   FROM rol_asignacion AS a LEFT JOIN rol_scope_ref AS sr ON sr.id_scope_ref = a.id_scope_ref
                  WHERE a.id_asignacion = ? LIMIT 1` + (lock ? ' FOR UPDATE' : '');
    const found = rows(await tx.execute(sql, [uuid(assignmentId, 'assignmentId')]));
    if (!found.length) return null;
    if (found.length !== 1) fail('INVALID_PERSISTENCE_RESULT', 'Assignment ID is not unique.');
    const a = found[0];
    return { assignmentId: a.id_asignacion, userId: Number(a.id_usuario), roleId: Number(a.id_rol),
      scopeRef: scopeValue(a), validFrom: fromSqlDate(a.vigente_desde, 'vigente_desde'),
      validUntil: a.vigente_hasta == null ? null : fromSqlDate(a.vigente_hasta, 'vigente_hasta'), status: a.estado,
      createdBy: Number(a.creado_por), createdAt: fromSqlDate(a.creado_en, 'creado_en'), reason: a.motivo,
      revokedBy: a.revocado_por == null ? null : Number(a.revocado_por),
      revokedAt: a.revocado_en == null ? null : fromSqlDate(a.revocado_en, 'revocado_en'), revocationReason: a.motivo_revocacion ?? null };
  }
  return Object.freeze({
    async resolveResource(resource, roleId, tx) {
      txRequired(tx, mutex);
      return resolveResource(resource, roleId, tx);
    },
    async listResourcesForRole(roleId, tx) {
      txRequired(tx, mutex);
      if (!scopeRefs || typeof scopeRefs.listResourcesForRole !== 'function') {
        fail('SCOPE_RESOLVER_REQUIRED', 'Typed resource scope resolver is required.');
      }
      return scopeRefs.listResourcesForRole(roleId, tx);
    },
    async hasEquivalent(key, tx) {
      txRequired(tx, mutex);
      if (!key || typeof key !== 'object') fail('INVALID_ASSIGNMENT', 'Assignment key is required.');
      const userId = dbInt(key.targetUserId, 'targetUserId'), roleId = dbInt(key.roleId, 'roleId');
      const from = instant(key.validFrom, 'validFrom'), until = instant(key.validUntil, 'validUntil', true);
      if (until && until.getTime() <= from.getTime()) fail('INVALID_VALIDITY', 'validUntil must follow validFrom.');
      const scope = await resolveScope(key.scopeRef ?? null, roleId, tx, false);
      const found = rows(await tx.execute(
        `SELECT id_asignacion FROM rol_asignacion WHERE id_usuario = ? AND id_rol = ? AND id_scope_ref <=> ?
            AND vigente_desde = ? AND vigente_hasta <=> ? AND estado IN ('active', 'scheduled') LIMIT 1`,
        [userId, roleId, scope?.idScopeRef ?? null, sqlDate(from), until ? sqlDate(until) : null]));
      return found.length > 0;
    },
    async create(fields, tx) {
      txRequired(tx, mutex);
      if (!fields || typeof fields !== 'object') fail('INVALID_ASSIGNMENT', 'Assignment fields are required.');
      const assignmentId = uuid(fields.assignmentId, 'assignmentId'), userId = dbInt(fields.userId, 'userId');
      const roleId = dbInt(fields.roleId, 'roleId'), createdBy = dbInt(fields.createdBy, 'createdBy');
      const createdAt = instant(fields.createdAt, 'createdAt'), from = instant(fields.validFrom, 'validFrom');
      const until = instant(fields.validUntil, 'validUntil', true), why = reason(fields.reason);
      if (until && until.getTime() <= from.getTime()) fail('INVALID_VALIDITY', 'validUntil must follow validFrom.');
      if (!['active', 'scheduled'].includes(fields.status) ||
          fields.status !== (from.getTime() > createdAt.getTime() ? 'scheduled' : 'active')) fail('INVALID_ASSIGNMENT_STATUS', 'Invalid status for assignment dates.');
      const config = await configFor(roleId, tx);
      if (until === null && !config.open) fail('OPEN_ENDED_ASSIGNMENT_DISABLED', 'Open-ended assignments are disabled.');
      const scope = await resolveScope(fields.scopeRef ?? null, roleId, tx, config.scoped);
      const hasApproval = fields.approvedBy != null || fields.approvalRequestId != null;
      if (config.classification === 'privileged' && !hasApproval) fail('APPROVAL_REQUIRED', 'Privileged assignments require second approval.');
      if (config.classification === 'ordinary' && hasApproval) fail('UNEXPECTED_APPROVAL', 'Ordinary assignments cannot carry approval metadata.');
      if (config.classification === 'privileged') {
        const approver = dbInt(fields.approvedBy, 'approvedBy');
        if (approver === createdBy) fail('SELF_APPROVAL_DENIED', 'Requester cannot approve their own assignment.');
        const req = await requestForUpdate(fields.approvalRequestId, tx);
        approvalMatch(req, fields, createdBy, scope?.idScopeRef ?? null);
      }
      await tx.execute(
        `INSERT INTO rol_asignacion (id_asignacion, id_usuario, id_rol, id_scope_ref, vigente_desde, vigente_hasta,
           estado, creado_por, creado_en, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [assignmentId, userId, roleId, scope?.idScopeRef ?? null, sqlDate(from), until ? sqlDate(until) : null,
          fields.status, createdBy, sqlDate(createdAt), why]);
      if (config.classification === 'privileged') {
        const linked = await tx.execute(
          `UPDATE rol_solicitud SET id_asignacion_resultado = ? WHERE id_solicitud = ? AND tipo_accion = 'assign'
            AND estado = 'pending_approval' AND id_asignacion_resultado IS NULL`, [assignmentId, fields.approvalRequestId]);
        if (affected(linked) !== 1) fail('REQUEST_NOT_PENDING', 'Approval request result could not be linked.');
      }
      return { assignmentId };
    },
    async getById(assignmentId, tx) { txRequired(tx, mutex); return read(assignmentId, tx); },
    async revoke(fields, tx) {
      txRequired(tx, mutex);
      if (!fields || typeof fields !== 'object') fail('INVALID_ASSIGNMENT', 'Revocation fields are required.');
      const assignmentId = uuid(fields.assignmentId, 'assignmentId'), requester = dbInt(fields.revokedBy, 'revokedBy');
      const revokedAt = instant(fields.revokedAt, 'revokedAt'), why = reason(fields.reason);
      const current = await read(assignmentId, tx);
      if (!current || !['active', 'scheduled'].includes(current.status)) return null;
      const config = await configFor(dbInt(current.roleId, 'roleId'), tx);
      const hasApproval = fields.approvedBy != null || fields.approvalRequestId != null;
      if (config.classification === 'privileged' && !hasApproval) fail('APPROVAL_REQUIRED', 'Privileged revocations require second approval.');
      if (config.classification === 'ordinary' && hasApproval) fail('UNEXPECTED_APPROVAL', 'Ordinary revocations cannot carry approval metadata.');
      let effectiveActor = requester;
      if (config.classification === 'privileged') {
        const approver = dbInt(fields.approvedBy, 'approvedBy');
        if (approver === requester) fail('SELF_APPROVAL_DENIED', 'Requester cannot approve their own revocation.');
        const req = await requestForUpdate(fields.approvalRequestId, tx);
        if (req.estado !== 'pending_approval' || req.tipo_accion !== 'revoke' || req.id_asignacion_resultado != null ||
            req.id_asignacion_objetivo !== assignmentId || !sameInt(req.id_usuario_solicitante, requester)) {
          fail('APPROVAL_MISMATCH', 'Pending request does not match this revocation.');
        }
        if (instant(fromSqlDate(req.vence_en, 'vence_en'), 'request expiry').getTime() <= revokedAt.getTime()) fail('APPROVAL_EXPIRED', 'The request has expired.');
        effectiveActor = approver;
      }
      const locked = await read(assignmentId, tx, true);
      if (!locked || !['active', 'scheduled'].includes(locked.status)) return null;
      const result = await tx.execute(
        `UPDATE rol_asignacion SET estado = 'revoked', revocado_por = ?, revocado_en = ?, motivo_revocacion = ?
          WHERE id_asignacion = ? AND estado IN ('active', 'scheduled')
            AND revocado_por IS NULL AND revocado_en IS NULL AND motivo_revocacion IS NULL`,
        [effectiveActor, sqlDate(revokedAt), why, assignmentId]);
      if (affected(result) !== 1) return null;
      return { assignmentId, status: 'revoked' };
    }
  });
}

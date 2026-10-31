const CLASSES = new Set(['ordinary', 'privileged']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPOSITORY_ERROR_NAMES = new Set([
  'RoleCatalogRepositoryError', 'ScopeRefResolutionError', 'AssignmentsRepositoryError',
  'ChangeRequestsRepositoryError', 'AuditRepositoryError', 'AuthorizationRepositoryError'
]);
const ACTION = { assign: 'assign-role', revoke: 'revoke-role', approve: 'approve-role-change' };
const validId = (x) => (typeof x === 'string' && x.trim() !== '') ||
  (typeof x === 'number' && Number.isSafeInteger(x) && x > 0);
function normalizedId(x) {
  if (!validId(x)) return null;
  const value = String(x).trim();
  if (/^\d+$/.test(value)) {
    const canonical = value.replace(/^0+(?=\d)/, '');
    const numeric = Number(canonical);
    if (Number.isSafeInteger(numeric) && numeric > 0) return String(numeric);
  }
  return value;
}
const reasonOk = (x) => typeof x === 'string' && x.trim() !== '';

function instant(x) {
  if (x instanceof Date && Number.isFinite(x.getTime())) return x.getTime();
  if (typeof x !== 'string') return null;
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|([+-])(\d\d):(\d\d))$/.exec(x);
  if (!parts) return null;
  const [, y, m, d, h, min, sec, zone, , offH, offM] = parts;
  const year = Number(y), month = Number(m), day = Number(d);
  const hour = Number(h), minute = Number(min), second = Number(sec);
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
      hour > 23 || minute > 59 || second > 59 ||
      (zone !== 'Z' && (Number(offH) > 23 || Number(offM) > 59))) return null;
  const n = Date.parse(x);
  return Number.isFinite(n) ? n : null;
}
const fail = (code) => ({ ok: false, code });

function statusOf(a, now) {
  if (!a || !['active', 'scheduled', 'expired', 'revoked'].includes(a.status)) return null;
  if (a.status === 'revoked') return 'revoked';
  const from = instant(a.validFrom);
  const until = a.validUntil == null ? null : instant(a.validUntil);
  if (from === null || (a.validUntil != null && until === null)) return null;
  if (until !== null && now >= until) return 'expired';
  return now < from ? 'scheduled' : 'active';
}
const REQUEST_SNAPSHOT_FIELDS = [
  'requestId', 'action', 'requestedBy', 'requestedAt', 'expiresAt', 'targetUserId',
  'roleId', 'scopeRef', 'assignmentId', 'validFrom', 'validUntil', 'status', 'reason'
];
const ASSIGNMENT_SNAPSHOT_FIELDS = [
  'assignmentId', 'userId', 'roleId', 'scopeRef', 'validFrom', 'validUntil', 'status'
];
function sameRequestSnapshot(a, b) {
  return REQUEST_SNAPSHOT_FIELDS.every((field) => Object.is(a?.[field], b?.[field]));
}
function sameAssignmentSnapshot(a, b) {
  return ASSIGNMENT_SNAPSHOT_FIELDS.every((field) => Object.is(a?.[field], b?.[field]));
}
function methods(obj, names) {
  return obj && names.every((n) => typeof obj[n] === 'function');
}
function ready(d) {
  return methods(d.authorization, ['canManageRole']) &&
    methods(d.roleCatalog, ['getById']) &&
    methods(d.assignments, ['hasEquivalent', 'create', 'getById', 'revoke']) &&
    methods(d.changeRequests, ['hasEquivalentPending', 'createPending', 'getById', 'getByIdForUpdate', 'decideIfPending']) &&
    methods(d.audit, ['append']) && methods(d.transactions, ['run']) &&
    methods(d.mutex, ['withLock', 'assertHeld']) &&
    methods(d.clock, ['now']) && methods(d.ids, ['next']) &&
    Number.isSafeInteger(d.approvalWindowMs) && d.approvalWindowMs > 0;
}

/**
 * Storage/framework-independent. Each operation receives (trustedActorContext, payload).
 * The adapter must construct that context from authenticated server state; actorId in
 * the payload is ignored. Persistence adapters must perform duplicate checks and writes
 * under a transaction with suitable locking/unique constraints, and append audits using
 * that same transaction. Any failed write/audit must reject so the whole unit rolls back.
 */
export function createRoleAssignmentService(deps = {}) {
  const available = ready(deps);
  function abort(code) {
    const e = new Error(code);
    e.assignmentCode = code;
    throw e;
  }
  async function transact(fn) {
    if (!available) return fail('DEPENDENCIES_UNAVAILABLE');
    try {
      return await deps.transactions.run((rawTx) => deps.mutex.withLock(rawTx, async (tx) => {
        deps.mutex.assertHeld(tx);
        return fn(tx);
      }));
    } catch (e) {
      const mutexCode = e?.name === 'AuthorizationMutexRepositoryError' ? e.code : null;
      const repositoryCode = REPOSITORY_ERROR_NAMES.has(e?.name) && typeof e?.code === 'string'
        ? e.code : null;
      return fail(e?.assignmentCode || mutexCode || repositoryCode || 'PERSISTENCE_FAILED');
    }
  }
  async function now() {
    const n = instant(await deps.clock.now());
    if (n === null) abort('CLOCK_UNAVAILABLE');
    return n;
  }
  async function nextId() {
    const x = await deps.ids.next();
    if (typeof x !== 'string' || !UUID_V4.test(x)) abort('IDENTIFIER_UNAVAILABLE');
    return x;
  }
  async function permitted(context, tx) {
    return await deps.authorization.canManageRole(context, tx) === true;
  }
  function validateRole(id, role) {
    if (!role || role.id !== id || !CLASSES.has(role.classification)) {
      abort('ROLE_CLASSIFICATION_REQUIRED');
    }
    if (typeof role.allowOpenEndedAssignment !== 'boolean') abort('VALIDITY_POLICY_REQUIRED');
    return role;
  }
  async function getRole(id, tx) {
    return validateRole(id, await deps.roleCatalog.getById(id, tx));
  }
  function dates(input, role, at) {
    const from = input.validFrom == null ? at : instant(input.validFrom);
    const until = input.validUntil == null ? null : instant(input.validUntil);
    if (from === null || from < at ||
        (input.validUntil != null && until === null) ||
        (until !== null && until <= from) ||
        (until === null && role.allowOpenEndedAssignment !== true)) return null;
    return { validFrom: new Date(from).toISOString(),
      validUntil: until === null ? null : new Date(until).toISOString(),
      status: from > at ? 'scheduled' : 'active' };
  }
  async function audit(event, tx) {
    await deps.audit.append({ eventId: await nextId(), ...event }, tx);
  }
  async function createAssignment(fields, tx) {
    const assignmentId = await nextId();
    const saved = await deps.assignments.create({ assignmentId, ...fields }, tx);
    if (!saved || saved.assignmentId !== assignmentId) abort('PERSISTENCE_FAILED');
    return saved;
  }

  async function assignRole(actorContext, input = {}) {
    if (!available) return fail('DEPENDENCIES_UNAVAILABLE');
    const actorId = actorContext?.actorId;
    if (!validId(actorId) || ![input.targetUserId, input.roleId].every(validId)) return fail('INVALID_IDENTIFIER');
    if (normalizedId(actorId) === normalizedId(input.targetUserId)) return fail('SELF_ASSIGNMENT_DENIED');
    if (!reasonOk(input.reason)) return fail('REASON_REQUIRED');
    if (input.scopeRef != null && !validId(input.scopeRef)) return fail('INVALID_SCOPE_REFERENCE');

    return transact(async (tx) => {
      const at = await now();
      const auth = { actorId, operation: ACTION.assign,
        targetUserId: input.targetUserId, roleId: input.roleId, scopeRef: input.scopeRef ?? null };
      if (!await permitted(auth, tx)) abort('AUTHORITY_REQUIRED');
      const role = await getRole(input.roleId, tx);
      const validity = dates(input, role, at);
      if (!validity) abort('INVALID_VALIDITY');
      const key = { targetUserId: input.targetUserId, roleId: input.roleId,
        scopeRef: input.scopeRef ?? null, validFrom: validity.validFrom, validUntil: validity.validUntil };
      if (await deps.assignments.hasEquivalent(key, tx) !== false) abort('DUPLICATE_ASSIGNMENT');

      const change = { action: 'assign', targetUserId: input.targetUserId, roleId: input.roleId,
        scopeRef: input.scopeRef ?? null, validFrom: validity.validFrom, validUntil: validity.validUntil,
        requestedBy: actorId, requestedAt: new Date(at).toISOString(), reason: input.reason.trim() };
      if (role.classification === 'privileged') {
        if (await deps.changeRequests.hasEquivalentPending(change, tx) !== false) abort('DUPLICATE_REQUEST');
        const requestId = await nextId();
        const saved = await deps.changeRequests.createPending({ requestId, ...change,
          status: 'pending_approval', expiresAt: new Date(at + deps.approvalWindowMs).toISOString() }, tx);
        if (!saved || saved.requestId !== requestId || saved.status !== 'pending_approval') abort('PERSISTENCE_FAILED');
        await audit({ action: 'role_assignment_requested', actorType: 'user', requestId, actorId,
          targetUserId: input.targetUserId, roleId: input.roleId, scopeRef: input.scopeRef ?? null,
          reason: input.reason.trim(), occurredAt: new Date(at).toISOString() }, tx);
        return { ok: true, result: 'pending_approval', requestId };
      }

      const assignment = await createAssignment({
        userId: input.targetUserId, roleId: input.roleId, scopeRef: input.scopeRef ?? null,
        ...validity, createdBy: actorId, createdAt: new Date(at).toISOString(),
        reason: input.reason.trim()
      }, tx);
      await audit({ action: 'role_assigned', assignmentId: assignment.assignmentId,
        actorType: 'user', actorId, targetUserId: input.targetUserId, roleId: input.roleId,
        scopeRef: input.scopeRef ?? null, reason: input.reason.trim(),
        occurredAt: new Date(at).toISOString() }, tx);
      return { ok: true, result: validity.status, assignmentId: assignment.assignmentId };
    });
  }

  async function revokeRole(actorContext, input = {}) {
    if (!available) return fail('DEPENDENCIES_UNAVAILABLE');
    const actorId = actorContext?.actorId;
    if (!validId(actorId) || !validId(input.assignmentId)) return fail('INVALID_IDENTIFIER');
    if (!reasonOk(input.reason)) return fail('REASON_REQUIRED');

    return transact(async (tx) => {
      const at = await now();
      const preview = await deps.assignments.getById(input.assignmentId, tx);
      if (!preview || preview.assignmentId !== input.assignmentId) abort('ASSIGNMENT_NOT_FOUND');
      // Preview reads are non-locking. Acquire the role lock first, then re-read
      // and compare the assignment before authorization or any assignment lock/write.
      const role = await getRole(preview.roleId, tx);
      const assignment = await deps.assignments.getById(input.assignmentId, tx);
      if (!assignment || !sameAssignmentSnapshot(preview, assignment)) abort('ASSIGNMENT_CHANGED');
      if (!['active', 'scheduled'].includes(statusOf(assignment, at))) abort('ASSIGNMENT_NOT_REVOCABLE');
      const auth = { actorId, operation: ACTION.revoke,
        targetUserId: assignment.userId, roleId: assignment.roleId,
        scopeRef: assignment.scopeRef ?? null, assignmentId: assignment.assignmentId };
      if (!await permitted(auth, tx)) abort('AUTHORITY_REQUIRED');

      const change = { action: 'revoke', assignmentId: assignment.assignmentId,
        targetUserId: assignment.userId, roleId: assignment.roleId,
        scopeRef: assignment.scopeRef ?? null, requestedBy: actorId,
        requestedAt: new Date(at).toISOString(), reason: input.reason.trim() };
      if (role.classification === 'privileged') {
        if (await deps.changeRequests.hasEquivalentPending(change, tx) !== false) abort('DUPLICATE_REQUEST');
        const requestId = await nextId();
        const saved = await deps.changeRequests.createPending({ requestId, ...change,
          status: 'pending_approval', expiresAt: new Date(at + deps.approvalWindowMs).toISOString() }, tx);
        if (!saved || saved.requestId !== requestId || saved.status !== 'pending_approval') abort('PERSISTENCE_FAILED');
        await audit({ action: 'role_revocation_requested', requestId,
          assignmentId: assignment.assignmentId, actorType: 'user', actorId,
          targetUserId: assignment.userId, roleId: assignment.roleId,
          scopeRef: assignment.scopeRef ?? null, reason: input.reason.trim(),
          occurredAt: new Date(at).toISOString() }, tx);
        return { ok: true, result: 'pending_approval', requestId };
      }

      const changed = await deps.assignments.revoke({ assignmentId: assignment.assignmentId,
        revokedBy: actorId, revokedAt: new Date(at).toISOString(),
        reason: input.reason.trim() }, tx);
      if (!changed || changed.status !== 'revoked') abort('PERSISTENCE_FAILED');
      await audit({ action: 'role_revoked', assignmentId: assignment.assignmentId,
        actorType: 'user', actorId, targetUserId: assignment.userId, roleId: assignment.roleId,
        scopeRef: assignment.scopeRef ?? null, reason: input.reason.trim(),
        occurredAt: new Date(at).toISOString() }, tx);
      return { ok: true, result: 'revoked', assignmentId: assignment.assignmentId };
    });
  }

  async function decideChange(actorContext, input = {}) {
    if (!available) return fail('DEPENDENCIES_UNAVAILABLE');
    const actorId = actorContext?.actorId;
    if (!validId(actorId) || !validId(input.requestId)) return fail('INVALID_IDENTIFIER');
    if (!['approve', 'reject'].includes(input.decision)) return fail('INVALID_DECISION');
    if (!reasonOk(input.reason)) return fail('REASON_REQUIRED');

    return transact(async (tx) => {
      const at = await now();
      const preview = await deps.changeRequests.getById(input.requestId, tx);
      if (!preview || preview.requestId !== input.requestId) abort('REQUEST_NOT_FOUND');

      // The preliminary read is non-locking. Lock the role before the request,
      // then re-read the request and its revocation target under their locks.
      const roleLock = await deps.roleCatalog.getById(preview.roleId, tx);
      if (!roleLock || roleLock.id !== preview.roleId) abort('ROLE_CLASSIFICATION_REQUIRED');

      const req = await deps.changeRequests.getByIdForUpdate(input.requestId, tx);
      if (!req || req.requestId !== input.requestId) abort('REQUEST_NOT_FOUND');
      if (!sameRequestSnapshot(preview, req)) abort('REQUEST_CHANGED');
      if (req.status !== 'pending_approval') abort('REQUEST_NOT_PENDING');
      if (!validId(req.requestedBy) || normalizedId(req.requestedBy) === normalizedId(actorId)) abort('SELF_APPROVAL_DENIED');

      const expires = instant(req.expiresAt);
      if (expires === null) abort('REQUEST_EXPIRY_INVALID');
      if (at >= expires) {
        if (await deps.changeRequests.decideIfPending(req.requestId, {
          status: 'expired', decisionActorType: 'system', decidedBy: null, decidedAt: new Date(at).toISOString(),
          reason: 'approval_window_expired'
        }, tx) !== true) abort('REQUEST_NOT_PENDING');
        await audit({ action: 'role_change_request_expired', actorType: 'system', requestId: req.requestId,
          actorId: null, targetUserId: req.targetUserId, roleId: req.roleId,
          reason: 'approval_window_expired', occurredAt: new Date(at).toISOString() }, tx);
        return fail('REQUEST_EXPIRED');
      }

      const approvalContext = { actorId, operation: ACTION.approve,
        targetUserId: req.targetUserId, roleId: req.roleId,
        scopeRef: req.scopeRef ?? null, assignmentId: req.assignmentId ?? null,
        requestId: req.requestId };
      if (!await permitted(approvalContext, tx)) abort('AUTHORITY_REQUIRED');

      if (input.decision === 'reject') {
        if (await deps.changeRequests.decideIfPending(req.requestId, {
          status: 'rejected', decisionActorType: 'user', decidedBy: actorId, decidedAt: new Date(at).toISOString(),
          reason: input.reason.trim()
        }, tx) !== true) abort('REQUEST_NOT_PENDING');
        await audit({ action: 'role_change_rejected', actorType: 'user', requestId: req.requestId,
          actorId, targetUserId: req.targetUserId, roleId: req.roleId,
          reason: input.reason.trim(), occurredAt: new Date(at).toISOString() }, tx);
        return { ok: true, result: 'rejected', requestId: req.requestId };
      }

      const originalOp = req.action === 'assign' ? ACTION.assign :
        req.action === 'revoke' ? ACTION.revoke : null;
      if (!originalOp) abort('REQUEST_ACTION_INVALID');
      if (!await permitted({ actorId: req.requestedBy, operation: originalOp,
        targetUserId: req.targetUserId, roleId: req.roleId,
        scopeRef: req.scopeRef ?? null, assignmentId: req.assignmentId ?? null }, tx)) {
        abort('REQUESTER_AUTHORITY_REVOKED');
      }
      // roleLock was acquired before the request lock and remains held through
      // the transaction, so use that validated row instead of issuing a role
      // locking read after the request has been locked.
      const role = validateRole(req.roleId, roleLock);
      if (role.classification !== 'privileged') abort('ROLE_CLASSIFICATION_CHANGED');

      if (req.action === 'assign') {
        const from = instant(req.validFrom);
        const until = req.validUntil == null ? null : instant(req.validUntil);
        if (from === null || from < at ||
            (req.validUntil != null && until === null) ||
            (until !== null && until <= from) ||
            (until === null && role.allowOpenEndedAssignment !== true)) abort('REQUEST_VALIDITY_INVALID');
        const duplicate = await deps.assignments.hasEquivalent({
          targetUserId: req.targetUserId, roleId: req.roleId,
          scopeRef: req.scopeRef ?? null, validFrom: req.validFrom,
          validUntil: req.validUntil ?? null
        }, tx);
        if (duplicate !== false) abort('DUPLICATE_ASSIGNMENT');
        const assignment = await createAssignment({
          userId: req.targetUserId, roleId: req.roleId, scopeRef: req.scopeRef ?? null,
          validFrom: new Date(from).toISOString(),
          validUntil: until === null ? null : new Date(until).toISOString(),
          status: from > at ? 'scheduled' : 'active',
          createdBy: req.requestedBy, createdAt: new Date(at).toISOString(),
          reason: req.reason, approvedBy: actorId, approvalRequestId: req.requestId
        }, tx);
        if (await deps.changeRequests.decideIfPending(req.requestId, {
          status: 'approved', decisionActorType: 'user', decidedBy: actorId, decidedAt: new Date(at).toISOString(),
          reason: input.reason.trim()
        }, tx) !== true) abort('REQUEST_NOT_PENDING');
        await audit({ action: 'role_assignment_approved', actorType: 'user', requestId: req.requestId,
          assignmentId: assignment.assignmentId, actorId,
          targetUserId: req.targetUserId, roleId: req.roleId,
          reason: input.reason.trim(), occurredAt: new Date(at).toISOString() }, tx);
        return { ok: true, result: from > at ? 'scheduled' : 'approved',
          requestId: req.requestId, assignmentId: assignment.assignmentId };
      }

      if (req.action === 'revoke') {
        const assignment = await deps.assignments.getById(req.assignmentId, tx);
        if (!assignment || assignment.assignmentId !== req.assignmentId ||
            assignment.userId !== req.targetUserId || assignment.roleId !== req.roleId) {
          abort('ASSIGNMENT_NOT_FOUND');
        }
        if (!['active', 'scheduled'].includes(statusOf(assignment, at))) abort('ASSIGNMENT_NOT_REVOCABLE');
        const changed = await deps.assignments.revoke({
          assignmentId: assignment.assignmentId, revokedBy: req.requestedBy,
          revokedAt: new Date(at).toISOString(), reason: req.reason,
          approvedBy: actorId, approvalRequestId: req.requestId
        }, tx);
        if (!changed || changed.status !== 'revoked') abort('PERSISTENCE_FAILED');
        if (await deps.changeRequests.decideIfPending(req.requestId, {
          status: 'approved', decisionActorType: 'user', decidedBy: actorId, decidedAt: new Date(at).toISOString(),
          reason: input.reason.trim()
        }, tx) !== true) abort('REQUEST_NOT_PENDING');
        await audit({ action: 'role_revocation_approved', actorType: 'user', requestId: req.requestId,
          assignmentId: assignment.assignmentId, actorId,
          targetUserId: req.targetUserId, roleId: req.roleId,
          reason: input.reason.trim(), occurredAt: new Date(at).toISOString() }, tx);
        return { ok: true, result: 'revoked', requestId: req.requestId, assignmentId: assignment.assignmentId };
      }
      abort('REQUEST_ACTION_INVALID');
    });
  }

  return {
    assignRole, revokeRole, decideChange,
    getAssignmentStatus(assignment, at = deps.clock?.now?.()) {
      const ms = instant(at);
      return ms === null ? null : statusOf(assignment, ms);
    }
  };
}

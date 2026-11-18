const MAX_SIGNED_INT = 2_147_483_647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const STATUS_BY_CODE = new Map([
  ['INVALID_IDENTIFIER', 400], ['INVALID_DECISION', 400],
  ['INVALID_VALIDITY', 400], ['INVALID_SCOPE_REFERENCE', 400],
  ['INVALID_SCOPE_RESOURCE', 400],
  ['INVALID_ROLE_ID', 400], ['SCOPE_REQUIRED', 400],
  ['REASON_REQUIRED', 400], ['SELF_ASSIGNMENT_DENIED', 400],
  ['AUTHORITY_REQUIRED', 403], ['REQUESTER_AUTHORITY_REVOKED', 403],
  ['SCOPE_REFERENCE_INACTIVE', 403], ['SCOPE_NOT_ALLOWED_FOR_ROLE', 403],
  ['SCOPE_REFERENCE_NOT_FOUND', 422], ['SCOPE_REFERENCE_MISMATCH', 422],
  ['SCOPE_RESOURCE_NOT_FOUND', 422], ['SCOPE_RESOURCE_MISMATCH', 422],
  ['SCOPE_RESOURCE_AMBIGUOUS', 422],
  ['ASSIGNMENT_NOT_FOUND', 404], ['REQUEST_NOT_FOUND', 404],
  ['DUPLICATE_ASSIGNMENT', 409], ['DUPLICATE_REQUEST', 409],
  ['ASSIGNMENT_CHANGED', 409], ['REQUEST_CHANGED', 409],
  ['REQUEST_NOT_PENDING', 409], ['REQUEST_NOT_REVOCABLE', 409],
  ['REQUEST_EXPIRED', 409], ['ASSIGNMENT_NOT_REVOCABLE', 409],
  ['REQUEST_VALIDITY_INVALID', 409], ['REQUEST_ACTION_INVALID', 409],
  ['APPROVAL_REQUIRED', 409], ['PROTECTED_SCOPE_AUTHORITY_ASSIGNMENT', 403],
  ['ROLE_CLASSIFICATION_REQUIRED', 503], ['ROLE_CONFIGURATION_REQUIRED', 503],
  ['VALIDITY_POLICY_REQUIRED', 503], ['DEPENDENCIES_UNAVAILABLE', 503],
  ['PERSISTENCE_FAILED', 503], ['CLOCK_UNAVAILABLE', 503],
  ['IDENTIFIER_UNAVAILABLE', 503]
]);

function actorFromVerifiedRequest(req) {
  const subject = req?.usuario?.sub;
  if (typeof subject !== 'string' || !/^\d+$/.test(subject)) return null;
  const actorId = Number(subject);
  return Number.isSafeInteger(actorId) && actorId > 0 && actorId <= MAX_SIGNED_INT
    ? Object.freeze({ actorId }) : null;
}

function respond(res, result, successStatus) {
  if (result?.ok === true) return res.status(successStatus).json(result);
  const code = typeof result?.code === 'string' ? result.code : 'PERSISTENCE_FAILED';
  return res.status(STATUS_BY_CODE.get(code) ?? 503).json({ ok: false, code });
}

function only(source, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

function bodyObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function databaseId(value) {
  const number = typeof value === 'number' ? value :
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_SIGNED_INT;
}

function validScopeResource(value) {
  return bodyObject(value) &&
    ['plan', 'activity'].includes(value.type) &&
    databaseId(value.id) &&
    Object.keys(value).every((key) => ['type', 'id'].includes(key));
}

function validReason(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function invalid(res, code) {
  return res.status(400).json({ ok: false, code });
}

/** HTTP adapter only. The caller must run a trusted authenticator before handlers. */
export function createRoleAssignmentController(service) {
  if (!service || typeof service.assignRole !== 'function' ||
      typeof service.listAssignableResources !== 'function' ||
      typeof service.revokeRole !== 'function' || typeof service.decideChange !== 'function') {
    throw new TypeError('A complete role-assignment service is required.');
  }

  async function invoke(req, res, actor, operation, payload, successStatus) {
    try {
      return respond(res, await operation(actor, payload), successStatus);
    } catch {
      return res.status(503).json({ ok: false, code: 'PERSISTENCE_FAILED' });
    }
  }

  return Object.freeze({
    assign(req, res) {
      const actor = actorFromVerifiedRequest(req);
      if (!actor) return res.status(401).json({ ok: false, code: 'AUTHENTICATION_REQUIRED' });
      if (!bodyObject(req.body)) return invalid(res, 'INVALID_REQUEST_BODY');
      const payload = only(req.body, ['targetUserId', 'roleId', 'scopeResource', 'validFrom', 'validUntil', 'reason']);
      if (!databaseId(payload.targetUserId) || !databaseId(payload.roleId)) return invalid(res, 'INVALID_IDENTIFIER');
      if (payload.scopeResource != null && !validScopeResource(payload.scopeResource)) return invalid(res, 'INVALID_SCOPE_RESOURCE');
      if (!validReason(payload.reason)) return invalid(res, 'REASON_REQUIRED');
      return invoke(req, res, actor, service.assignRole.bind(service), payload, 201);
    },
    listAssignableResources(req, res) {
      const actor = actorFromVerifiedRequest(req);
      if (!actor) return res.status(401).json({ ok: false, code: 'AUTHENTICATION_REQUIRED' });
      if (!databaseId(req.query?.targetUserId) || !databaseId(req.query?.roleId)) {
        return invalid(res, 'INVALID_IDENTIFIER');
      }
      return invoke(req, res, actor, service.listAssignableResources.bind(service), {
        targetUserId: req.query.targetUserId,
        roleId: req.query.roleId
      }, 200);
    },
    revoke(req, res) {
      const actor = actorFromVerifiedRequest(req);
      if (!actor) return res.status(401).json({ ok: false, code: 'AUTHENTICATION_REQUIRED' });
      if (!UUID_V4.test(req.params?.assignmentId ?? '')) return invalid(res, 'INVALID_IDENTIFIER');
      if (!bodyObject(req.body)) return invalid(res, 'INVALID_REQUEST_BODY');
      if (!validReason(req.body.reason)) return invalid(res, 'REASON_REQUIRED');
      return invoke(req, res, actor, service.revokeRole.bind(service),
        { assignmentId: req.params?.assignmentId, reason: req.body?.reason }, 200);
    },
    decide(req, res) {
      const actor = actorFromVerifiedRequest(req);
      if (!actor) return res.status(401).json({ ok: false, code: 'AUTHENTICATION_REQUIRED' });
      if (!UUID_V4.test(req.params?.requestId ?? '')) return invalid(res, 'INVALID_IDENTIFIER');
      if (!bodyObject(req.body)) return invalid(res, 'INVALID_REQUEST_BODY');
      if (!['approve', 'reject'].includes(req.body.decision)) return invalid(res, 'INVALID_DECISION');
      if (!validReason(req.body.reason)) return invalid(res, 'REASON_REQUIRED');
      return invoke(req, res, actor, service.decideChange.bind(service),
        { requestId: req.params?.requestId, decision: req.body?.decision, reason: req.body?.reason }, 200);
    }
  });
}

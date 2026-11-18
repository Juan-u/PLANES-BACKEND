const MAX_INT = 2_147_483_647;
const UUID_SUBJECT = /^[1-9]\d{0,9}$/;
function actor(req) {
  const value = req?.usuario?.sub;
  if (typeof value !== 'string' || !UUID_SUBJECT.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= MAX_INT ? Object.freeze({ actorId: id }) : null;
}
function id(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_INT;
}
const STATUS = new Map([
  ['AUTHENTICATION_REQUIRED', 401], ['AUTHORITY_REQUIRED', 403], ['ROLE_NOT_FOUND', 404], ['PERMISSION_NOT_FOUND', 404],
  ['ROLE_ALREADY_EXISTS', 409], ['SYSTEM_ADMIN_ROLE_PROTECTED', 409], ['SYSTEM_PERMISSION_PROTECTED', 409],
  ['PERMISSION_NOT_CONFIGURED', 409], ['INVALID_ROLE_CONFIGURATION', 400], ['INVALID_PERMISSION_SET', 400],
  ['INVALID_PERMISSION', 400], ['INVALID_ROLE_NAME', 400], ['INVALID_ROLE_DESCRIPTION', 400], ['INVALID_REASON', 400],
  ['INVALID_ROLE_ID', 400], ['INVALID_TARGET_USER_ID', 400], ['PERSISTENCE_FAILED', 503],
  ['INVALID_RESOURCE_TYPE', 400], ['INVALID_RESOURCE_ID', 400],
  ['ROLE_SCOPE_REQUIRED', 409], ['SCOPE_RESOURCE_NOT_FOUND', 404],
  ['SCOPE_REFERENCE_INACTIVE', 409], ['SCOPE_RESOURCE_ALREADY_ENABLED', 409],
  ['INVALID_VALID_FROM', 400], ['INVALID_VALID_UNTIL', 400], ['INVALID_INSTITUTIONAL_REFERENCE', 400],
  ['INVALID_REQUEST_ID', 400], ['INVALID_DECISION', 400], ['TARGET_USER_NOT_ACTIVE', 409],
  ['ACTOR_NOT_ACTIVE', 403],
  ['SCOPE_AUTHORITY_ROLE_NOT_READY', 409], ['SCOPE_AUTHORITY_ROLE_CONFIGURATION_CONFLICT', 409],
  ['SCOPE_AUTHORITY_ROLE_PROTECTED', 409], ['INITIAL_SCOPE_AUTHORITY_ALREADY_EXISTS', 409],
  ['INITIAL_SCOPE_AUTHORITY_REQUEST_NOT_FOUND', 404], ['INITIAL_SCOPE_AUTHORITY_ALREADY_DECIDED', 409],
  ['INDEPENDENT_APPROVAL_REQUIRED', 403], ['INSTITUTIONAL_REFERENCE_MISMATCH', 409],
  ['ASSIGNMENT_CONFLICT', 409], ['SCOPE_RESOURCE_AMBIGUOUS', 409], ['INVALID_VALIDITY', 400]
]);
function result(res, output, status = 200) {
  if (output?.ok) return res.status(status).json(output);
  const code = output?.code ?? 'PERSISTENCE_FAILED';
  return res.status(STATUS.get(code) ?? 503).json({ ok: false, code });
}
function body(req) { return req.body && typeof req.body === 'object' && !Array.isArray(req.body); }

export function createRoleAdministrationController(service) {
  const names = ['getCapabilities', 'listCatalog', 'listPermissions', 'listAssignments', 'listRequests',
    'listScopeResources', 'enableScopeResource', 'createRole', 'updateRoleConfiguration',
    'setRolePermissions', 'setPermissionActive', 'listInitialScopeAuthorityRequests',
    'requestInitialScopeAuthority', 'decideInitialScopeAuthority'];
  if (!service || names.some((name) => typeof service[name] !== 'function')) throw new TypeError('A complete protected role-administration service is required.');
  const invoke = async (res, call, status = 200) => {
    try { return result(res, await call(), status); }
    catch { return res.status(503).json({ ok: false, code: 'PERSISTENCE_FAILED' }); }
  };
  return Object.freeze({
    getCapabilities: (req, res) => { const a = actor(req); return a ? invoke(res, () => service.getCapabilities(a)) : result(res, { code: 'AUTHENTICATION_REQUIRED' }); },
    listCatalog: (req, res) => { const a = actor(req); return a ? invoke(res, () => service.listCatalog(a)) : result(res, { code: 'AUTHENTICATION_REQUIRED' }); },
    listPermissions: (req, res) => { const a = actor(req); return a ? invoke(res, () => service.listPermissions(a)) : result(res, { code: 'AUTHENTICATION_REQUIRED' }); },
    listRequests: (req, res) => { const a = actor(req); return a ? invoke(res, () => service.listRequests(a)) : result(res, { code: 'AUTHENTICATION_REQUIRED' }); },
    listScopeResources: (req, res) => {
      const a = actor(req);
      return a ? invoke(res, () => service.listScopeResources(a)) : result(res, {code: 'AUTHENTICATION_REQUIRED'});
    },
    listInitialScopeAuthorityRequests: (req, res) => {
      const a = actor(req);
      return a ? invoke(res, () => service.listInitialScopeAuthorityRequests(a)) : result(res, {code: 'AUTHENTICATION_REQUIRED'});
    },
    requestInitialScopeAuthority: (req, res) => {
      const a = actor(req);
      if (!a) return result(res, {code: 'AUTHENTICATION_REQUIRED'});
      if (!body(req) || !id(req.body.targetUserId)) return res.status(400).json({ok: false, code: 'INVALID_TARGET_USER_ID'});
      if (!id(req.body.planId)) return res.status(400).json({ok: false, code: 'INVALID_RESOURCE_ID'});
      if (typeof req.body.institutionalReference !== 'string') return res.status(400).json({ok: false, code: 'INVALID_INSTITUTIONAL_REFERENCE'});
      if (typeof req.body.reason !== 'string') return res.status(400).json({ok: false, code: 'INVALID_REASON'});
      if ((req.body.validFrom != null && typeof req.body.validFrom !== 'string') ||
          typeof req.body.validUntil !== 'string') return res.status(400).json({ok: false, code: 'INVALID_VALIDITY'});
      return invoke(res, () => service.requestInitialScopeAuthority(a, req.body), 201);
    },
    decideInitialScopeAuthority: (req, res) => {
      const a = actor(req);
      if (!a) return result(res, {code: 'AUTHENTICATION_REQUIRED'});
      if (!id(req.params?.requestId) && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.params?.requestId ?? '')) {
        return res.status(400).json({ok: false, code: 'INVALID_REQUEST_ID'});
      }
      if (!body(req) || !['approve', 'reject'].includes(req.body.decision) ||
          typeof req.body.institutionalReference !== 'string' || typeof req.body.reason !== 'string') {
        return res.status(400).json({ok: false, code: 'INVALID_DECISION'});
      }
      return invoke(res, () => service.decideInitialScopeAuthority(a, req.params.requestId, req.body));
    },
    enableScopeResource: (req, res) => {
      const a = actor(req); if (!a) return result(res, {code: 'AUTHENTICATION_REQUIRED'});
      if (!body(req) || !id(req.body.roleId) || !id(req.body.resourceId) ||
          !['plan', 'activity'].includes(req.body.resourceType) || typeof req.body.reason !== 'string') {
        return res.status(400).json({ok: false, code: 'INVALID_RESOURCE_ID'});
      }
      return invoke(res, () => service.enableScopeResource(a, {
        roleId: req.body.roleId,
        resourceType: req.body.resourceType,
        resourceId: req.body.resourceId,
        reason: req.body.reason
      }), 201);
    },
    listAssignments: (req, res) => {
      const a = actor(req); if (!a) return result(res, { code: 'AUTHENTICATION_REQUIRED' });
      if (!id(req.params?.userId)) return res.status(400).json({ ok: false, code: 'INVALID_TARGET_USER_ID' });
      return invoke(res, () => service.listAssignments(a, req.params.userId));
    },
    createRole: (req, res) => {
      const a = actor(req); if (!a) return result(res, { code: 'AUTHENTICATION_REQUIRED' });
      if (!body(req)) return res.status(400).json({ ok: false, code: 'INVALID_BODY' });
      return invoke(res, () => service.createRole(a, req.body), 201);
    },
    updateRoleConfiguration: (req, res) => {
      const a = actor(req); if (!a) return result(res, { code: 'AUTHENTICATION_REQUIRED' });
      if (!id(req.params?.roleId) || !body(req)) return res.status(400).json({ ok: false, code: 'INVALID_ROLE_ID' });
      return invoke(res, () => service.updateRoleConfiguration(a, req.params.roleId, req.body));
    },
    setRolePermissions: (req, res) => {
      const a = actor(req); if (!a) return result(res, { code: 'AUTHENTICATION_REQUIRED' });
      if (!id(req.params?.roleId) || !body(req) || !Array.isArray(req.body.permissionCodes) || typeof req.body.reason !== 'string') {
        return res.status(400).json({ ok: false, code: 'INVALID_PERMISSION_SET' });
      }
      return invoke(res, () => service.setRolePermissions(a, req.params.roleId, req.body.permissionCodes, req.body.reason));
    },
    setPermissionActive: (req, res) => {
      const a = actor(req); if (!a) return result(res, { code: 'AUTHENTICATION_REQUIRED' });
      if (!body(req) || typeof req.body.active !== 'boolean' || typeof req.body.reason !== 'string') return res.status(400).json({ ok: false, code: 'INVALID_PERMISSION' });
      return invoke(res, () => service.setPermissionActive(a, req.params?.code, req.body.active, req.body.reason));
    }
  });
}

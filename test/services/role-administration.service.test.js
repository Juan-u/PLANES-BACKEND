import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoleAdministrationService } from '../../app/services/role-administration.service.js';
import { ROLE_PERMISSION_CATALOG } from '../../app/config/role-permission-matrix.js';

function make({ authorized = 0, responses = [] } = {}) {
  const events = [];
  let responseIndex = 0;
  const pool = { async getConnection() {
    events.push('connect');
    return {
      async beginTransaction() { events.push('begin'); },
      async commit() { events.push('commit'); },
      async rollback() { events.push('rollback'); },
      release() { events.push('release'); },
      async execute(sql, params) {
        events.push({ sql, params });
        if (/rol_autorizacion_mutex/.test(sql)) return [[{ mutex_id: 1 }], []];
        if (/AS authorized/.test(sql)) return [[{ authorized }], []];
        return [responses[responseIndex++] ?? [], []];
      },
      async query(sql, params) { return this.execute(sql, params); }
    };
  } };
  const service = createRoleAdministrationService({ pool, ids: { next: async () => '6f42e389-8390-4ed1-9ccf-327c5f1ad2d4' }, clock: { now: () => new Date('2026-01-01T00:00:00.000Z') } });
  return { service, events };
}

function makeScopeResources({ authorized = 1 } = {}) {
  const events = [];
  const pool = { async getConnection() {
    events.push('connect');
    return {
      async beginTransaction() { events.push('begin'); },
      async commit() { events.push('commit'); },
      async rollback() { events.push('rollback'); },
      release() { events.push('release'); },
      async execute(sql, params) {
        events.push({ sql, params });
        if (/rol_autorizacion_mutex/.test(sql)) return [[{ mutex_id: 1 }], []];
        if (/AS authorized/.test(sql)) return [[{ authorized }], []];
        if (/SELECT id_plan AS id, nombre AS name/.test(sql)) return [[{ id: 1, name: 'Plan institucional' }], []];
        if (/activity\.id_actividad AS id/.test(sql)) return [[{
          id: 9, planId: 1, planName: 'Plan institucional', name: 'Actividad institucional'
        }], []];
        if (/SELECT r\.nombre_rol, rc\.clasificacion_privilegio/.test(sql)) {
          return [[{ nombre_rol: 'collaborator', clasificacion_privilegio: 'ordinary', requiere_ambito: 1 }], []];
        }
        if (/WHERE id_plan = \? LIMIT 1 FOR UPDATE/.test(sql)) {
          return [[{ id: 1, name: 'Plan institucional' }], []];
        }
        if (/FROM rol_scope_recurso AS scoped/.test(sql)) return [[], []];
        if (/FROM rol_scope_permitido/.test(sql)) return [[], []];
        if (/SELECT id_evento FROM rol_auditoria/.test(sql)) return [[], []];
        if (/INSERT INTO rol_scope_ref/.test(sql)) return [{ insertId: 51 }, []];
        if (/INSERT INTO rol_auditoria/.test(sql)) return [{ affectedRows: 1 }, []];
        return [{ affectedRows: 1 }, []];
      },
      async query(sql, params) { return this.execute(sql, params); }
    };
  } };
  const service = createRoleAdministrationService({
    pool, ids: { next: async () => '6f42e389-8390-4ed1-9ccf-327c5f1ad2d4' },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') }
  });
  return { service, events };
}

test('catalog read requires explicit permission and uses the persistent mutex', async () => {
  const denied = make({ authorized: 0 });
  assert.deepEqual(await denied.service.listCatalog({ actorId: 12 }), { ok: false, code: 'AUTHORITY_REQUIRED' });
  assert.equal(denied.events.some((event) => typeof event === 'object' && /FROM rol AS r/.test(event.sql)), false);
  assert.equal(denied.events[3].params[0], 'M01.roles.read');

  const allowed = make({ authorized: 1, responses: [[], []] });
  assert.deepEqual(await allowed.service.listCatalog({ actorId: 12 }), { ok: true, roles: [] });
  assert.deepEqual(allowed.events.slice(0, 2), ['connect', 'begin']);
  assert.match(allowed.events[2].sql, /rol_autorizacion_mutex/);
  assert.deepEqual(allowed.events.slice(-2), ['commit', 'release']);
});

test('permission matrix covers M01 through M16 and grants the system profile every module operation', () => {
  assert.equal(Object.keys(ROLE_PERMISSION_CATALOG.modules).length, 16);
  assert.equal(ROLE_PERMISSION_CATALOG.roles.length, 9);
  const administrator = ROLE_PERMISSION_CATALOG.roles.find((role) => role.code === 'system_administrator');
  const expected = ROLE_PERMISSION_CATALOG.permissions.map((permission) => permission.code)
    .filter((code) => code !== 'M01.roles.manage_scope').sort();
  assert.deepEqual([...administrator.permissions].sort(), expected);
  assert.equal(administrator.permissions.includes('M01.roles.manage_scope'), false);
  assert.equal(administrator.classification, 'privileged');
  assert.equal(administrator.requiresScope, false);
  const scopeAuthority = ROLE_PERMISSION_CATALOG.roles.find((role) => role.code === 'scope_authority_manager');
  assert.deepEqual(scopeAuthority.permissions, [
    'M01.roles.manage_scope', 'assign-role', 'revoke-role', 'approve-role-change'
  ]);
  assert.equal(scopeAuthority.classification, 'ordinary');
  assert.equal(scopeAuthority.requiresScope, true);
  assert.equal(scopeAuthority.allowOpenEnded, false);
});

test('invalid actors fail closed without opening a transaction', async () => {
  const { service, events } = make();
  assert.deepEqual(await service.listCatalog({ actorId: 'not-an-id' }), { ok: false, code: 'INVALID_ACTOR_ID' });
  assert.equal(events.length, 0);
});

test('lists plans and activities as typed resources only after explicit authorization', async () => {
  const allowed = makeScopeResources();
  const result = await allowed.service.listScopeResources({ actorId: 12 });
  assert.deepEqual(result, { ok: true, resources: [
    { type: 'plan', id: 1, name: 'Plan institucional', planId: 1 },
    { type: 'activity', id: 9, name: 'Actividad institucional', planId: 1, planName: 'Plan institucional' }
  ] });
  assert.equal(allowed.events[3].params[0], 'M01.roles.manage');

  const denied = makeScopeResources({ authorized: 0 });
  assert.deepEqual(await denied.service.listScopeResources({ actorId: 12 }),
    { ok: false, code: 'AUTHORITY_REQUIRED' });
  assert.equal(denied.events.some((event) => typeof event === 'object' && /FROM plan_accion/.test(event.sql)), false);
});

test('explicitly enables a typed plan for a scoped role and audits the operation transactionally', async () => {
  const { service, events } = makeScopeResources();
  const result = await service.enableScopeResource({ actorId: 12 }, {
    roleId: 8, resourceType: 'plan', resourceId: 1, reason: 'Enable plan access'
  });
  assert.deepEqual(result, { ok: true, resource: {
    type: 'plan', id: 1, name: 'Plan institucional', planId: 1,
    scopeRef: '6f42e389-8390-4ed1-9ccf-327c5f1ad2d4'
  } });
  assert.ok(events.some((event) => typeof event === 'object' &&
    /INSERT INTO rol_scope_recurso/.test(event.sql) && event.params[1] === 'plan'));
  const audit = events.find((event) => typeof event === 'object' && /INSERT INTO rol_auditoria/.test(event.sql));
  assert.ok(audit);
  assert.equal(audit.params[3], 'role_scope_resource_enabled');
  assert.equal(audit.params[6], 'Enable plan access');
  assert.deepEqual(events.slice(-2), ['commit', 'release']);
});

test('self capability snapshot is authenticated, mutex-protected and returns permission codes only', async () => {
  const { service, events } = make({ responses: [[{ codigo: 'M01.users.read' }]] });
  assert.deepEqual(await service.getCapabilities({ actorId: 12 }), { ok: true, permissions: ['M01.users.read'] });
  assert.match(events[2].sql, /rol_autorizacion_mutex/);
  assert.match(events.find((event) => typeof event === 'object' && /SELECT DISTINCT permission\.codigo/.test(event.sql)).sql,
    /SELECT DISTINCT permission\.codigo/);
});

test('catalog permission edits reject unknown permission names and do not authorize from user.id_rol', async () => {
  const { service, events } = make({ authorized: 0 });
  const result = await service.setRolePermissions({ actorId: 12 }, 8, ['M99.root.all'], 'test');
  assert.deepEqual(result, { ok: false, code: 'INVALID_PERMISSION_SET' });
  assert.equal(events.length, 0);
});

test('invalid role fields are reported as input errors before opening a transaction', async () => {
  const { service, events } = make();
  assert.deepEqual(await service.createRole({ actorId: 12 }, { name: '  ', reason: 'test' }),
    { ok: false, code: 'INVALID_ROLE_NAME' });
  assert.deepEqual(await service.createRole({ actorId: 12 }, { name: 'valid', reason: 'test',
    classification: 'unknown', requiresScope: true, allowOpenEndedAssignment: false }),
  { ok: false, code: 'INVALID_ROLE_CONFIGURATION' });
  assert.equal(events.length, 0);
});

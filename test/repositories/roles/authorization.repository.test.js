import { testMutex, markProtectedTestTransaction } from './test-mutex.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthorizationRepositoryError,
  createAuthorizationRepository
} from '../../../app/repositories/roles/authorization.repository.js';

const BASE = {
  actorId: 11, operation: 'assign-role', targetUserId: 22, roleId: 7, scopeRef: null
};
function makeTx(value = 0) {
  const calls = [];
  const tx = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{ authorized: value }], []];
    }
  };
  return { tx: markProtectedTestTransaction(tx), calls };
}
function assertCoreAuthorizationPredicates(sql) {
  assert.match(sql, /FROM rol_asignacion AS manager_assignment/);
  assert.match(sql, /JOIN rol_permiso AS role_permission/);
  assert.match(sql, /JOIN permiso AS permission/);
  assert.match(sql, /JOIN rol_configuracion AS manager_config/);
  assert.match(sql, /JOIN rol_configuracion AS target_config/);
  assert.match(sql, /permission\.activo = 1/);
  assert.match(sql, /manager_assignment\.vigente_desde <= UTC_TIMESTAMP\(3\)/);
  assert.match(sql, /manager_assignment\.vigente_hasta IS NULL OR manager_assignment\.vigente_hasta > UTC_TIMESTAMP\(3\)/);
  assert.match(sql, /manager_assignment\.estado IN \('active', 'scheduled'\)/);
  assert.doesNotMatch(sql, /usuario\.id_rol/);
}

test('authorizes only when the query confirms a direct active permission assignment', async () => {
  const { tx, calls } = makeTx(1);
  const result = await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx);
  assert.equal(result, true);
  assertCoreAuthorizationPredicates(calls[0].sql);
  assert.deepEqual(calls[0].params, ['assign-role', 7, 11, 'assign-role']);
});

test('canAccess checks an exact module permission against a current assigned role', async () => {
  const calls = [];
  const tx = markProtectedTestTransaction({
    async execute(sql, params) { calls.push({ sql, params }); return [[{ authorized: 1 }], []]; }
  });
  const repo = createAuthorizationRepository({ mutex: testMutex });
  assert.equal(await repo.canAccess({ actorId: 11, permissionCode: 'M03.plans.read' }, tx), true);
  assert.deepEqual(calls[0].params, ['M03.plans.read', 11]);
  assert.match(calls[0].sql, /JOIN rol_permiso AS role_permission/);
  assert.match(calls[0].sql, /JOIN permiso AS permission/);
  assert.match(calls[0].sql, /assignment\.vigente_desde <= UTC_TIMESTAMP\(3\)/);
  assert.match(calls[0].sql, /approval_decision\.resultado = 'approved'/);
  assert.doesNotMatch(calls[0].sql, /usuario\.id_rol/);
});

test('canAccess fails closed for missing permissions, invalid codes and mismatched scopes', async () => {
  const calls = [];
  const tx = markProtectedTestTransaction({
    async execute(sql, params) { calls.push({ sql, params }); return [[{ authorized: 0 }], []]; }
  });
  const repo = createAuthorizationRepository({ mutex: testMutex });
  assert.equal(await repo.canAccess({ actorId: 11, permissionCode: 'M03.plans.read' }, tx), false);
  assert.equal(await repo.canAccess({ actorId: 11, permissionCode: 'admin' }, tx), false);
  assert.equal(await repo.canAccess({ actorId: 11, permissionCode: 'M03.plans.read', scopeRef: 12 }, tx), false);
  assert.deepEqual(calls[1].params, ['M03.plans.read', 11, 'number', '12']);
  assert.match(calls[1].sql, /requested_scope\.activo = 1/);
  assert.match(calls[1].sql, /permitted_scope\.id_rol = assignment\.id_rol/);
});

test('effective permission snapshot returns only currently usable permissions from assigned roles', async () => {
  const calls = [];
  const tx = markProtectedTestTransaction({ async execute(sql, params) {
    calls.push({ sql, params });
    return [[{ codigo: 'M01.users.read' }, { codigo: 'M01.users.create' }], []];
  } });
  const repo = createAuthorizationRepository({ mutex: testMutex });
  assert.deepEqual(await repo.getEffectivePermissionCodes({ actorId: 11 }, tx), ['M01.users.read', 'M01.users.create']);
  assert.deepEqual(calls[0].params, [11]);
  assert.match(calls[0].sql, /assignment\.estado IN \('active', 'scheduled'\)/);
  assert.match(calls[0].sql, /assignment\.vigente_desde <= UTC_TIMESTAMP\(3\)/);
  assert.match(calls[0].sql, /scope_ref\.activo = 1/);
  assert.match(calls[0].sql, /approval\.resultado = 'approved'/);
  assert.match(calls[0].sql, /approval\.id_usuario_decisor <> approved_request\.id_usuario_solicitante/);
  assert.doesNotMatch(calls[0].sql, /usuario\.id_rol/);
});

test('effective permission snapshot requires a protected transaction and propagates persistence failures', async () => {
  const repo = createAuthorizationRepository({ mutex: testMutex });
  await assert.rejects(repo.getEffectivePermissionCodes({ actorId: 11 }), (error) => error.code === 'TRANSACTION_REQUIRED');
  const failure = new Error('permission snapshot failed');
  const tx = markProtectedTestTransaction({ async execute() { throw failure; } });
  await assert.rejects(repo.getEffectivePermissionCodes({ actorId: 11 }, tx), failure);
});

test('canAccess requires the protected transaction and propagates query failures', async () => {
  const repo = createAuthorizationRepository({ mutex: testMutex });
  await assert.rejects(repo.canAccess({ actorId: 11, permissionCode: 'M03.plans.read' }),
    (error) => error.code === 'TRANSACTION_REQUIRED');
  const failure = new Error('query failed');
  const tx = markProtectedTestTransaction({ async execute() { throw failure; } });
  await assert.rejects(repo.canAccess({ actorId: 11, permissionCode: 'M03.plans.read' }, tx), failure);
});

test('denies when the actor has no matching role assignment', async () => {
  const { tx, calls } = makeTx(0);
  assert.equal(await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx), false);
  assert.match(calls[0].sql, /manager_assignment\.id_usuario = \?/);
});

test('denies expired assignments by enforcing current validity bounds', async () => {
  const { tx, calls } = makeTx(0);
  assert.equal(await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx), false);
  assert.match(calls[0].sql, /vigente_hasta IS NULL OR manager_assignment\.vigente_hasta > UTC_TIMESTAMP\(3\)/);
});

test('denies revoked assignments and excludes their stored state', async () => {
  const { tx, calls } = makeTx(0);
  await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx);
  assert.match(calls[0].sql, /manager_assignment\.estado IN \('active', 'scheduled'\)/);
  assert.doesNotMatch(calls[0].sql, /estado\s*=\s*'revoked'/);
});

test('denies scheduled assignments whose start is still in the future', async () => {
  const { tx, calls } = makeTx(0);
  await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx);
  assert.match(calls[0].sql, /manager_assignment\.vigente_desde <= UTC_TIMESTAMP\(3\)/);
});

test('requires exact scope equality and denies a mismatched scope', async () => {
  const { tx, calls } = makeTx(0);
  const context = { ...BASE, scopeRef: 'Dept A' };
  assert.equal(await createAuthorizationRepository({ mutex: testMutex }).canManageRole(context, tx), false);
  assert.match(calls[0].sql, /BINARY requested_scope\.ref_value = BINARY \?/);
  assert.match(calls[0].sql, /requested_scope\.id_scope_ref = manager_assignment\.id_scope_ref/);
  assert.match(calls[0].sql, /BINARY permission\.codigo = BINARY 'M01\.roles\.manage'/);
  assert.match(calls[0].sql, /FROM rol_scope_recurso AS typed_resource/);
  assert.deepEqual(calls[0].params, ['assign-role', 7, 11, 'assign-role', 'string', 'Dept A']);
});

test('global role management applies only to ordinary, non-authority roles on typed resources', async () => {
  const {tx, calls} = makeTx(0);
  await createAuthorizationRepository({mutex: testMutex}).canManageRole(
    {...BASE, scopeRef: 'plan-scope'}, tx);
  const sql = calls[0].sql;
  assert.match(sql, /BINARY permission\.codigo = BINARY 'M01\.roles\.manage'/);
  assert.match(sql, /target_config\.clasificacion_privilegio = 'ordinary'/);
  assert.match(sql, /target_role\.nombre_rol <> BINARY 'scope_authority_manager'/);
  assert.match(sql, /typed_resource\.id_scope_ref = requested_scope\.id_scope_ref/);
  assert.match(sql, /manager_assignment\.id_scope_ref IS NULL/);
});

test('keeps numeric and textual scope references distinct', async () => {
  const repo = createAuthorizationRepository({ mutex: testMutex });
  const { tx, calls } = makeTx(1);
  await repo.canManageRole({ ...BASE, scopeRef: 12 }, tx);
  await repo.canManageRole({ ...BASE, scopeRef: '12' }, tx);
  assert.deepEqual(calls.map((x) => x.params.slice(4)), [['number', '12'], ['string', '12']]);
});

test('denies when the permission is absent or inactive', async () => {
  const { tx, calls } = makeTx(0);
  assert.equal(await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx), false);
  assert.match(calls[0].sql, /permission\.activo = 1/);
  assert.match(calls[0].sql, /BINARY permission\.codigo = BINARY \?/);
});

test('denies when the role has no association to the permission', async () => {
  const { tx, calls } = makeTx(0);
  await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx);
  assert.match(calls[0].sql, /JOIN rol_permiso AS role_permission/);
  assert.match(calls[0].sql, /role_permission\.id_rol = manager_assignment\.id_rol/);
});

test('denies when role configuration is absent or invalid', async () => {
  const { tx, calls } = makeTx(0);
  await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx);
  assert.match(calls[0].sql, /JOIN rol_configuracion AS manager_config/);
  assert.match(calls[0].sql, /manager_config\.clasificacion_privilegio IN \('ordinary', 'privileged'\)/);
  assert.match(calls[0].sql, /JOIN rol_configuracion AS target_config/);
});

test('denies privileged assignments unless approved request and second decision exist', async () => {
  const { tx, calls } = makeTx(0);
  await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx);
  const sql = calls[0].sql;
  assert.match(sql, /approved_request\.estado = 'approved'/);
  assert.match(sql, /approval_decision\.resultado = 'approved'/);
  assert.match(sql, /approval_decision\.id_usuario_decisor <> approved_request\.id_usuario_solicitante/);
  assert.match(sql, /approved_request\.id_asignacion_resultado = manager_assignment\.id_asignacion/);
});

test('uses the same request key for its approval decision', async () => {
  const { tx, calls } = makeTx(1);
  const context = {
    ...BASE, operation: 'approve-role-change',
    requestId: '550e8400-e29b-41d4-a716-446655440000'
  };
  assert.equal(await createAuthorizationRepository({ mutex: testMutex }).canManageRole(context, tx), true);
  assert.match(calls[0].sql, /approval_decision\.id_solicitud = approved_request\.id_solicitud/);
  assert.match(calls[0].sql, /approval_request\.estado = 'pending_approval'/);
  assert.equal(calls[0].params[4], context.requestId);
});

test('does not activate or consult delegations', async () => {
  const { tx, calls } = makeTx(0);
  assert.equal(await createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx), false);
  assert.doesNotMatch(calls[0].sql, /rol_delegacion/);
});

test('binds revocation authorization to the target assignment', async () => {
  const { tx, calls } = makeTx(1);
  const context = {
    ...BASE, operation: 'revoke-role',
    assignmentId: '8f14e45f-ea8a-4f8a-9f3e-9c0a1b2c3d4e'
  };
  assert.equal(await createAuthorizationRepository({ mutex: testMutex }).canManageRole(context, tx), true);
  assert.match(calls[0].sql, /target_assignment\.id_asignacion = \?/);
  assert.match(calls[0].sql, /target_assignment\.id_usuario = \?/);
  assert.match(calls[0].sql, /target_assignment\.id_rol = \?/);
  assert.deepEqual(calls[0].params.slice(4), [context.assignmentId, 22, 7]);
});

test('denies unknown or structurally incomplete authorization contexts', async () => {
  const repo = createAuthorizationRepository({ mutex: testMutex });
  const { tx, calls } = makeTx(1);
  assert.equal(await repo.canManageRole({ ...BASE, operation: 'invented-operation' }, tx), false);
  assert.equal(await repo.canManageRole({ ...BASE, scopeRef: '   ' }, tx), false);
  assert.equal(await repo.canManageRole({ ...BASE, roleId: 0 }, tx), false);
  assert.equal(calls.length, 0);
});

test('propagates transaction query failures unchanged', async () => {
  const expected = new Error('permission query failure');
  const tx = markProtectedTestTransaction({ async execute() { throw expected; } });
  await assert.rejects(createAuthorizationRepository({ mutex: testMutex }).canManageRole(BASE, tx),
    (error) => error === expected);
});

test('requires the transaction passed by the service', async () => {
  const repo = createAuthorizationRepository({ mutex: testMutex });
  let calls = 0;
  const tx = markProtectedTestTransaction({ async execute() { calls += 1; return [[{ authorized: 0 }], []]; } });
  await assert.rejects(repo.canManageRole(BASE),
    (error) => error instanceof AuthorizationRepositoryError && error.code === 'TRANSACTION_REQUIRED');
  assert.equal(calls, 0);
  assert.equal(await repo.canManageRole(BASE, tx), false);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(repo), ['getEffectivePermissionCodes', 'canAccess', 'listActivityScopes', 'canManageRole']);
});

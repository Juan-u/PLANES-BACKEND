import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoleAssignmentController } from '../../app/controllers/controller.role-assignment.js';
import { createRoleAssignmentRouter } from '../../app/routes/routes.role-assignment.js';
import { createRoleAssignmentComposition } from '../../app/services/role-assignment.composition.js';

function response() {
  return { statusCode: null, body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
}

test('derives actor only from verified request state and whitelists assign payload', async () => {
  let call;
  const controller = createRoleAssignmentController({
    async assignRole(actor, payload) { call = { actor, payload }; return { ok: true, result: 'active', assignmentId: 'id' }; },
    async listAssignableResources() { return { ok: true, resources: [] }; },
    async revokeRole() {}, async decideChange() {}
  });
  const res = response();
  await controller.assign({
    usuario: { sub: '19' }, body: { actorId: 999, targetUserId: 20, roleId: 4, reason: 'approved' }
  }, res);
  assert.deepEqual(call, { actor: { actorId: 19 }, payload: { targetUserId: 20, roleId: 4, reason: 'approved' } });
  assert.equal(res.statusCode, 201);
});

test('rejects a request without verified identity and does not call the service', async () => {
  let called = false;
  const controller = createRoleAssignmentController({
    async assignRole() { called = true; return { ok: true }; },
    async listAssignableResources() { return { ok: true, resources: [] }; },
    async revokeRole() {}, async decideChange() {}
  });
  const res = response();
  await controller.assign({ body: { actorId: 19 } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test('validates database IDs, UUID path parameters, decisions and reasons before service calls', async () => {
  let calls = 0;
  const controller = createRoleAssignmentController({
    async assignRole() { calls += 1; return { ok: true }; },
    async listAssignableResources() { return { ok: true, resources: [] }; },
    async revokeRole() { calls += 1; return { ok: true }; },
    async decideChange() { calls += 1; return { ok: true }; }
  });
  const actor = { usuario: { sub: '19' } };
  const invalidAssign = response();
  await controller.assign({ ...actor, body: { targetUserId: 'twenty', roleId: 4, reason: 'valid' } }, invalidAssign);
  const invalidRevoke = response();
  await controller.revoke({ ...actor, params: { assignmentId: 'not-a-uuid' }, body: { reason: 'valid' } }, invalidRevoke);
  const invalidDecision = response();
  await controller.decide({ ...actor, params: { requestId: '00000000-0000-4000-8000-000000000001' },
    body: { decision: 'delegate', reason: 'valid' } }, invalidDecision);
  const missingReason = response();
  await controller.assign({ ...actor, body: { targetUserId: 20, roleId: 4, reason: '  ' } }, missingReason);

  assert.deepEqual([invalidAssign.statusCode, invalidAssign.body.code], [400, 'INVALID_IDENTIFIER']);
  assert.deepEqual([invalidRevoke.statusCode, invalidRevoke.body.code], [400, 'INVALID_IDENTIFIER']);
  assert.deepEqual([invalidDecision.statusCode, invalidDecision.body.code], [400, 'INVALID_DECISION']);
  assert.deepEqual([missingReason.statusCode, missingReason.body.code], [400, 'REASON_REQUIRED']);
  assert.equal(calls, 0);
});

test('maps service denials without exposing thrown persistence details', async () => {
  const controller = createRoleAssignmentController({
    async assignRole() { return { ok: false, code: 'AUTHORITY_REQUIRED' }; },
    async listAssignableResources() { return { ok: true, resources: [] }; },
    async revokeRole() { throw new Error('database diagnostic'); }, async decideChange() {}
  });
  const denied = response();
  await controller.assign({ usuario: { sub: '19' }, body: { targetUserId: 20, roleId: 4, reason: 'test' } }, denied);
  assert.deepEqual([denied.statusCode, denied.body], [403, { ok: false, code: 'AUTHORITY_REQUIRED' }]);
  const failed = response();
  await controller.revoke({ usuario: { sub: '19' }, params: { assignmentId: '00000000-0000-4000-8000-000000000001' }, body: { reason: 'x' } }, failed);
  assert.deepEqual([failed.statusCode, failed.body], [503, { ok: false, code: 'PERSISTENCE_FAILED' }]);
  assert.equal(JSON.stringify(failed.body).includes('database diagnostic'), false);
});

test('maps revocation and approval/rejection requests through the same trusted actor context', async () => {
  const calls = [];
  const controller = createRoleAssignmentController({
    async assignRole() {},
    async listAssignableResources(actor, payload) { calls.push({ operation: 'resources', actor, payload }); return { ok: true, resources: [] }; },
    async revokeRole(actor, payload) { calls.push({ operation: 'revoke', actor, payload }); return { ok: true, result: 'revoked' }; },
    async decideChange(actor, payload) { calls.push({ operation: payload.decision, actor, payload }); return { ok: true, result: payload.decision }; }
  });
  const revokeResponse = response();
  await controller.revoke({ usuario: { sub: '24' }, params: { assignmentId: '00000000-0000-4000-8000-000000000001' },
    body: { actorId: 900, assignmentId: 'forged', reason: 'remove access' } }, revokeResponse);
  const approveResponse = response();
  await controller.decide({ usuario: { sub: '25' }, params: { requestId: '00000000-0000-4000-8000-000000000002' },
    body: { actorId: 900, requestId: 'forged', decision: 'approve', reason: 'approved' } }, approveResponse);
  const rejectResponse = response();
  await controller.decide({ usuario: { sub: '26' }, params: { requestId: '00000000-0000-4000-8000-000000000003' },
    body: { decision: 'reject', reason: 'rejected' } }, rejectResponse);

  assert.deepEqual(calls, [
    { operation: 'revoke', actor: { actorId: 24 }, payload: { assignmentId: '00000000-0000-4000-8000-000000000001', reason: 'remove access' } },
    { operation: 'approve', actor: { actorId: 25 }, payload: { requestId: '00000000-0000-4000-8000-000000000002', decision: 'approve', reason: 'approved' } },
    { operation: 'reject', actor: { actorId: 26 }, payload: { requestId: '00000000-0000-4000-8000-000000000003', decision: 'reject', reason: 'rejected' } }
  ]);
  assert.deepEqual([revokeResponse.statusCode, approveResponse.statusCode, rejectResponse.statusCode], [200, 200, 200]);
});

test('lists resources from verified actor state and validates target and role IDs', async () => {
  let call;
  const controller = createRoleAssignmentController({
    async assignRole() {},
    async listAssignableResources(actor, payload) {
      call = { actor, payload };
      return { ok: true, resources: [{ type: 'plan', id: 1 }] };
    },
    async revokeRole() {}, async decideChange() {}
  });
  const valid = response();
  await controller.listAssignableResources({ usuario: { sub: '29' }, query: { targetUserId: '3', roleId: '8' } }, valid);
  assert.deepEqual(call, { actor: { actorId: 29 }, payload: { targetUserId: '3', roleId: '8' } });
  assert.deepEqual([valid.statusCode, valid.body], [200, { ok: true, resources: [{ type: 'plan', id: 1 }] }]);
  const invalid = response();
  await controller.listAssignableResources({ usuario: { sub: '29' }, query: { targetUserId: '0', roleId: '8' } }, invalid);
  assert.deepEqual([invalid.statusCode, invalid.body.code], [400, 'INVALID_IDENTIFIER']);
});

test('router uses the production JWT middleware for resource lookup and mutations', () => {
  const dependencies = createRoleAssignmentComposition({
    pool: { async getConnection() { throw new Error('Router creation must not connect.'); } },
    clock: { now: () => new Date('2026-10-30T10:00:00.000Z') },
    ids: { next: () => '00000000-0000-4000-8000-000000000001' }, approvalWindowMs: 60_000
  });
  assert.throws(() => createRoleAssignmentRouter({ service: { assignRole() {}, revokeRole() {}, decideChange() {} } }),
    /protected role-assignment composition/);
  const router = createRoleAssignmentRouter({ service: dependencies.service });
  assert.deepEqual(router.stack.map((layer) => layer.route.path), [
    '/roles/asignacion-recursos', '/roles/asignaciones', '/roles/asignaciones/:assignmentId/revocacion',
    '/roles/solicitudes/:requestId/decision'
  ]);
  assert.ok(router.stack.every((layer) => typeof layer.route.stack[0].handle === 'function'));
  assert.ok(router.stack.every((layer) => layer.route.stack.length === 2));
});

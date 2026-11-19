import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPermissionMiddleware } from '../../app/middleware/permission.middleware.js';
import { findActivity } from '../../app/services/activity-access.js';

function setup({ authorized = 1, mutexRows = [{ mutex_id: 1 }], queryError = null, scopes = [] } = {}) {
  const events = [];
  const calls = [];
  const pool = {
    async getConnection() {
      events.push('connection');
      return {
        async beginTransaction() { events.push('begin'); },
        async commit() { events.push('commit'); },
        async rollback() { events.push('rollback'); },
        release() { events.push('release'); },
        async execute(sql, params) {
          calls.push({ sql, params });
          if (queryError) throw queryError;
          if (/rol_autorizacion_mutex/.test(sql)) return [mutexRows, []];
          if (/SELECT DISTINCT resource_scope/.test(sql)) return [scopes, []];
          if (/FROM actividad WHERE id_actividad/.test(sql)) {
            const [id] = params;
            return [[{ id_plan: id === 10 ? 1 : 2, id_actividad: id }], []];
          }
          return [[{ authorized }], []];
        },
        async query(sql, params) { return this.execute(sql, params); }
      };
    }
  };
  const requirePermission = createPermissionMiddleware({ pool });
  return { events, calls, requirePermission };
}

function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headersSent = false;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.headersSent = true; res.emit('finish'); return res; };
  return res;
}

test('permission gate authenticates from verified request state and keeps mutex until controller finishes', async () => {
  const { events, calls, requirePermission } = setup();
  const req = { usuario: { sub: '17', rol: 'legacy role must not matter' } };
  const res = response();
  let reached = false;
  const done = requirePermission('M03.plans.read')(req, res, () => {
    reached = true;
    assert.deepEqual(events, ['connection', 'begin']);
    setImmediate(() => res.emit('finish'));
  });
  await done;
  assert.equal(reached, true);
  assert.deepEqual(events, ['connection', 'begin', 'commit', 'release']);
  assert.match(calls[0].sql, /rol_autorizacion_mutex/);
  assert.equal(calls[1].params[0], 'M03.plans.read');
  assert.equal(calls[1].params[1], 17);
});

test('permission gate denies missing permission and invalid identity without calling the controller', async () => {
  const { requirePermission } = setup({ authorized: 0 });
  const res = response();
  let reached = false;
  await requirePermission('M03.plans.read')({ usuario: { sub: '17' } }, res, () => { reached = true; });
  assert.equal(reached, false);
  assert.equal(res.statusCode, 403);

  const unauthenticated = response();
  await requirePermission('M03.plans.read')({}, unauthenticated, () => { reached = true; });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(reached, false);
});

test('permission gate fails closed when mutex row is missing or persistence fails', async () => {
  const missing = setup({ mutexRows: [] });
  const missingRes = response();
  await missing.requirePermission('M03.plans.read')({ usuario: { sub: '17' } }, missingRes, () => assert.fail('must not continue'));
  assert.equal(missingRes.statusCode, 503);
  assert.equal(missing.calls.length, 1);

  const broken = setup({ queryError: new Error('db failure') });
  const brokenRes = response();
  await broken.requirePermission('M03.plans.read')({ usuario: { sub: '17' } }, brokenRes, () => assert.fail('must not continue'));
  assert.equal(brokenRes.statusCode, 503);
});

test('permission middleware rejects malformed or absent permission configuration', () => {
  const { requirePermission } = setup();
  assert.throws(() => requirePermission(''), /permission code/i);
  assert.throws(() => createPermissionMiddleware({}), /pool/i);
});

test('scoped collaborator can reach own-plan operations but cannot reach another plan or global administration', async () => {
  const { calls, requirePermission } = setup({ authorized: 0, scopes: [{ id_plan: 1, id_actividad: null }] });
  const pathActivity = (req, tx) => findActivity(tx, req.params.id);
  const gate = requirePermission('M05.followup.create', { activityAccess: pathActivity });
  const own = response(), other = response(), admin = response();
  await gate({ usuario: { sub: '3' }, params: { id: '10' } }, own, () => own.json({ allowed: true }));
  await gate({ usuario: { sub: '3' }, params: { id: '20' }, body: { id_plan: 1 } }, other, () => assert.fail());
  await requirePermission('M05.followup.update')({ usuario: { sub: '3' } }, admin, () => assert.fail());
  assert.deepEqual([own.statusCode, other.statusCode, admin.statusCode], [200, 403, 403]);
  const scoped = calls.filter(({ sql }) => /SELECT DISTINCT resource_scope/.test(sql));
  assert.equal(scoped.length, 2);
  assert.deepEqual(scoped[0].params, ['M05.followup.create', 3]);
  assert.match(scoped[0].sql, /resource_scope.id_scope_ref = assignment.id_scope_ref/);
  assert.match(scoped[0].sql, /allowed_scope.id_rol = assignment.id_rol/);
  assert.match(scoped[0].sql, /active_scope.activo = 1/);
  assert.match(scoped[0].sql, /assignment.vigente_hasta > UTC_TIMESTAMP/);
});

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const secret = randomBytes(48).toString('base64url');
const authPool = { query: mock.fn(async (_sql, params) => {
  assert.deepEqual(params, [101]);
  return [[{ id_usuario: 101, estado: 'Activo', nombre_rol: 'legacy-role' }], []];
}) };
mock.module('../../app/config/auth.js', { namedExports: { JWT_SECRET: secret } });
mock.module('../../app/config/db.js', { defaultExport: authPool });

const [{ createRoleCapabilitiesRouter }, { createRoleAdministrationComposition }] = await Promise.all([
  import('../../app/routes/routes.role-administration.js'),
  import('../../app/services/role-administration.composition.js')
]);

test('verified JWT receives only own current permissions through the mutex-protected capability endpoint', async () => {
  const events = [];
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); },
    async execute(sql, params) {
      events.push({ sql, params });
      if (sql.includes('rol_autorizacion_mutex')) return [[{ mutex_id: 1 }], []];
      if (sql.includes('SELECT DISTINCT permission.codigo')) return [[{ codigo: 'M01.users.read' }], []];
      throw new Error('Unexpected authorization query.');
    },
    async query(sql, params) { return this.execute(sql, params); }
  };
  const pool = { async getConnection() { events.push('connection'); return connection; } };
  const { service } = createRoleAdministrationComposition({ pool,
    ids: { next: () => '6f42e389-8390-4ed1-9ccf-327c5f1ad2d4' }, clock: { now: () => new Date() } });
  const app = express();
  app.use(createRoleCapabilitiesRouter({ service }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const token = jwt.sign({ sub: '101', permissions: ['M99.root.all'] }, secret, { algorithm: 'HS256', expiresIn: '2h' });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/roles/capacidades`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, permissions: ['M01.users.read'] });
    assert.equal(authPool.query.mock.callCount(), 1);
    const permissionQuery = events.find((event) => typeof event === 'object' && event.sql.includes('SELECT DISTINCT permission.codigo'));
    assert.deepEqual(permissionQuery.params, [101]);
    assert.deepEqual(events.slice(0, 2), ['connection', 'begin']);
    assert.match(events[2].sql, /rol_autorizacion_mutex/);
    assert.deepEqual(events.slice(-2), ['commit', 'release']);
    const badTokenResponse = await fetch(`http://127.0.0.1:${server.address().port}/roles/capacidades`, {
      headers: { authorization: 'Bearer invalid' }
    });
    assert.equal(badTokenResponse.status, 401);
    assert.equal(authPool.query.mock.callCount(), 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

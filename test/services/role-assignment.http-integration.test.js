import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const secret = randomBytes(48).toString('base64url');
const authPool = {
  query: mock.fn(async (_sql, params) => {
    assert.deepEqual(params, [101]);
    return [[{ id_usuario: 101, estado: 'activo', nombre_rol: 'rol heredado' }], []];
  })
};
mock.module('../../app/config/auth.js', { namedExports: { JWT_SECRET: secret } });
mock.module('../../app/config/db.js', { defaultExport: authPool });

const [{ createRoleAssignmentRouter }, { createRoleAssignmentComposition }] = await Promise.all([
  import('../../app/routes/routes.role-assignment.js'),
  import('../../app/services/role-assignment.composition.js')
]);

test('JWT -> router -> service -> protected repositories denies without configured permission', async () => {
  const sqlCalls = [];
  const txEvents = [];
  const connection = {
    async beginTransaction() { txEvents.push('begin'); },
    async commit() { txEvents.push('commit'); },
    async rollback() { txEvents.push('rollback'); },
    release() { txEvents.push('release'); },
    async query(sql, params) { sqlCalls.push({ sql, params }); return [[], []]; },
    async execute(sql, params) {
      sqlCalls.push({ sql, params });
      if (sql.includes('rol_autorizacion_mutex')) return [[{ mutex_id: 1 }], []];
      if (sql.includes('FROM rol AS r')) return [[{
        id_rol: 7, clasificacion_privilegio: 'ordinary',
        permite_vigencia_indefinida: 1, requiere_ambito: 0
      }], []];
      if (sql.includes('AS authorized')) return [[{ authorized: 0 }], []];
      throw new Error('Unexpected persistence operation in deny-by-default integration test.');
    }
  };
  const pool = { async getConnection() { txEvents.push('connection'); return connection; } };
  const { service } = createRoleAssignmentComposition({
    pool,
    clock: { now: () => new Date('2026-10-30T10:00:00.000Z') },
    ids: { next: () => 'a2df4d1d-99f8-4fd2-8d78-2228d911ab30' },
    approvalWindowMs: 60_000
  });
  const app = express();
  app.use(express.json());
  app.use(createRoleAssignmentRouter({ service }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const token = jwt.sign({ sub: '101' }, secret, { algorithm: 'HS256', expiresIn: '2h' });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/roles/asignaciones`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ actorId: 999, targetUserId: 202, roleId: 7, reason: 'Request access' })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, code: 'AUTHORITY_REQUIRED' });
    assert.equal(authPool.query.mock.callCount(), 1);
    const authorizationCall = sqlCalls.find((call) => call.sql.includes('AS authorized'));
    assert.deepEqual(authorizationCall.params.slice(0, 3), ['assign-role', 7, 101]);
    assert.deepEqual(txEvents, ['connection', 'begin', 'rollback', 'release']);
    assert.equal(sqlCalls.filter((call) => call.sql.includes('rol_autorizacion_mutex')).length, 1);
    assert.equal(sqlCalls.some((call) => call.sql.startsWith('INSERT INTO') || call.sql.startsWith('UPDATE ')), false);

    const beforeInvalidToken = txEvents.length;
    const invalid = await fetch(`http://127.0.0.1:${server.address().port}/roles/asignaciones`, {
      method: 'POST', headers: { authorization: 'Bearer not-a-valid-token', 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: 202, roleId: 7, reason: 'Request access' })
    });
    assert.equal(invalid.status, 401);
    assert.equal(authPool.query.mock.callCount(), 1);
    assert.equal(txEvents.length, beforeInvalidToken);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

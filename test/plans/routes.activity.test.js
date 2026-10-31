import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const secret = randomBytes(48).toString('base64url');
const pool = { query: async () => [[{ id_usuario: 21, estado: 'activo', nombre_rol: null }], []], getConnection() {} };
mock.module('../../app/config/auth.js', { namedExports: { JWT_SECRET: secret } });
mock.module('../../app/config/db.js', { defaultExport: pool });
const { createActivityRouter } = await import('../../app/routes/routes.activity.js');

test('activity routes require all permission gates and place JWT authentication first', () => {
  const read = (_req, _res, next) => next();
  const create = (_req, _res, next) => next();
  const update = (_req, _res, next) => next();
  const router = createActivityRouter({ pool, authorizeRead: read, authorizeCreate: create, authorizeUpdate: update });
  const expected = [['/actividades', 'get', read], ['/actividades/:id', 'get', read], ['/actividades', 'post', create], ['/actividades/:id', 'put', update]];
  for (const [path, method, gate] of expected) {
    const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
    assert.equal(route.stack[0].handle.name, 'verificarToken');
    assert.equal(route.stack[1].handle, gate);
    assert.equal(typeof route.stack[2].handle, 'function');
  }
});

test('router fails closed when any activity permission gate is missing', () => {
  assert.throws(() => createActivityRouter({ pool, authorizeRead: () => {}, authorizeCreate: () => {} }), /authorizeUpdate/);
});

test('verified JWT middleware rejects requests before reaching activity permission or controller', async () => {
  const read = (_req, _res, next) => next();
  const router = createActivityRouter({ pool, authorizeRead: read, authorizeCreate: () => {}, authorizeUpdate: () => {} });
  const route = router.stack.find((layer) => layer.route?.path === '/actividades' && layer.route.methods.get).route;
  const res = { code: null, status(code) { this.code = code; return this; }, json() { return this; } };
  let reached = false;
  await route.stack[0].handle({ headers: {} }, res, () => { reached = true; });
  assert.equal(res.code, 401);
  assert.equal(reached, false);
});

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';
import * as passwordService from '../../app/services/password.service.js';

const testSecret = randomBytes(48).toString('base64url');
const testPassword = 'auth-controller-test-password';
const testEmail = 'login-test@example.invalid';
const storedHash = await passwordService.hashPassword(testPassword);
const sensitiveMarker = 'internal database credential marker';

let queryRows = [];
let queryFailure = null;
let verificationFailure = null;
const queryCalls = [];
const verificationCalls = [];

const pool = {
  async query(...args) {
    queryCalls.push(args);
    if (queryFailure) {
      throw queryFailure;
    }
    return [queryRows, []];
  }
};

mock.module('../../app/config/auth.js', {
  namedExports: { JWT_SECRET: testSecret }
});
mock.module('../../app/config/db.js', { defaultExport: pool });
mock.module('../../app/services/password.service.js', {
  namedExports: {
    hashPassword: passwordService.hashPassword,
    verifyPassword: async (...args) => {
      verificationCalls.push(args);
      if (verificationFailure) {
        throw verificationFailure;
      }
      return passwordService.verifyPassword(...args);
    }
  }
});

const { login, verificarSesion } = await import('../../app/controllers/controller.auth.js');
const { default: authRouter } = await import('../../app/routes/routes.auth.js');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function resetMocks({ rows = [], error = null, verifyError = null } = {}) {
  queryRows = rows;
  queryFailure = error;
  verificationFailure = verifyError;
  queryCalls.length = 0;
  verificationCalls.length = 0;
}

async function attemptLogin({ correo = testEmail, password = testPassword } = {}) {
  const res = createResponse();
  await login({ body: { correo, password } }, res);
  return res;
}

function serializedBody(res) {
  assert.ok(res.body && typeof res.body === 'object');
  return JSON.stringify(res.body);
}

function assertNoCredentialDisclosure(res, extraSensitiveValues = []) {
  const body = serializedBody(res);
  for (const value of [testPassword, storedHash, sensitiveMarker, ...extraSensitiveValues]) {
    assert.equal(body.includes(value), false);
  }
  assert.doesNotMatch(body, /scrypt\$v1\$/i);
  for (const key of Object.keys(res.body)) {
    assert.doesNotMatch(key, /password|contrase(?:Ã±|ñ)a|hash/i);
  }
}

function assertNoToken(res) {
  assert.equal(Object.hasOwn(res.body ?? {}, 'token'), false);
}

test('correct email and password return a verifiable HS256 token with subject and expiration', async () => {
  resetMocks({ rows: [{ id_usuario: 73, estado: 'activo', 'contraseña': storedHash }] });

  const res = await attemptLogin();

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body?.token, 'string');
  assert.ok(res.body.token.length > 0);
  assert.deepEqual(Object.keys(res.body).sort(), ['token']);

  const decoded = jwt.decode(res.body.token, { complete: true });
  assert.equal(decoded?.header?.alg, 'HS256');
  const claims = jwt.verify(res.body.token, testSecret, { algorithms: ['HS256'] });
  assert.equal(claims.sub, '73');
  assert.equal(typeof claims.exp, 'number');
  assert.ok(claims.exp > claims.iat);

  assert.equal(queryCalls.length, 1);
  const [sql, params] = queryCalls[0];
  assert.match(sql, /SELECT\s+id_usuario\s*,\s*estado\s*,\s*`contraseña`\s+FROM\s+usuario\s+WHERE\s+correo\s*=\s*\?\s+LIMIT\s+1/i);
  assert.deepEqual(params, [testEmail]);
  assert.deepEqual(verificationCalls, [[testPassword, storedHash]]);
  assertNoCredentialDisclosure(res);
});

test('active account state comparison accepts capitalization differences', async () => {
  resetMocks({
    rows: [Object.assign({ id_usuario: 73, estado: 'Activo' }, { 'contrase\u00f1a': storedHash })]
  });

  const res = await attemptLogin();

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body?.token, 'string');
});

test('incorrect password returns a generic 401 and does not issue a token', async () => {
  resetMocks({ rows: [{ id_usuario: 73, estado: 'activo', 'contraseña': storedHash }] });

  const res = await attemptLogin({ password: 'wrong-auth-controller-password' });

  assert.equal(res.statusCode, 401);
  assertNoToken(res);
  assertNoCredentialDisclosure(res, ['wrong-auth-controller-password']);
});

test('unknown email returns the same generic error as an incorrect password', async () => {
  resetMocks();
  const unknownEmail = 'unknown-login-test@example.invalid';
  const missingAccount = await attemptLogin({ correo: unknownEmail });

  resetMocks({ rows: [{ id_usuario: 73, estado: 'activo', 'contraseña': storedHash }] });
  const wrongPassword = await attemptLogin({ password: 'wrong-auth-controller-password' });

  assert.equal(missingAccount.statusCode, 401);
  assert.equal(wrongPassword.statusCode, 401);
  assert.deepEqual(missingAccount.body, wrongPassword.body);
  assertNoToken(missingAccount);
  assertNoToken(wrongPassword);
  assertNoCredentialDisclosure(missingAccount, [unknownEmail]);
  assertNoCredentialDisclosure(wrongPassword, ['wrong-auth-controller-password']);
});

test('inactive, null, or unknown account state never authenticates', async (t) => {
  for (const estado of ['inactivo', 'Activo ', ' activo', null, 'estado-desconocido']) {
    await t.test(`estado ${String(estado)}`, async () => {
      resetMocks({ rows: [{ id_usuario: 73, estado, 'contraseña': storedHash }] });

      const res = await attemptLogin();

      assert.equal(res.statusCode, 401);
      assertNoToken(res);
      assertNoCredentialDisclosure(res);
    });
  }
});

test('malformed or unsupported stored hash is rejected without issuing a token', async () => {
  const malformedHash = 'unsupported$malformed-test-hash';
  resetMocks({ rows: [{ id_usuario: 73, estado: 'activo', 'contraseña': malformedHash }] });

  const res = await attemptLogin();

  assert.equal(res.statusCode, 401);
  assertNoToken(res);
  assertNoCredentialDisclosure(res, [malformedHash]);
});

test('password verification failure returns a generic temporary error without issuing a token', async () => {
  const verificationError = new Error(`verification internals: ${sensitiveMarker}`);
  resetMocks({
    rows: [{ id_usuario: 73, estado: 'activo', 'contraseña': storedHash }],
    verifyError: verificationError
  });

  const res = await attemptLogin();

  assert.equal(res.statusCode, 503);
  assertNoToken(res);
  assert.equal(queryCalls.length, 1);
  assert.deepEqual(verificationCalls, [[testPassword, storedHash]]);
  assertNoCredentialDisclosure(res, [verificationError.message]);
});

test('storage failure returns a generic temporary error without issuing a token', async () => {
  const storageError = new Error(`SQL details and ${sensitiveMarker}`);
  resetMocks({ error: storageError });

  const res = await attemptLogin();

  assert.equal(res.statusCode, 503);
  assertNoToken(res);
  assert.equal(queryCalls.length, 1);
  assert.deepEqual(verificationCalls, []);
  assertNoCredentialDisclosure(res, [storageError.message]);
});

test('session verification controller returns only a minimal success response', () => {
  const res = createResponse();

  verificarSesion({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('session verification route remains protected by the existing JWT middleware', () => {
  const routeLayer = authRouter.stack.find((layer) => layer.route?.path === '/session');

  assert.ok(routeLayer);
  assert.equal(routeLayer.route.methods.get, true);
  assert.deepEqual(
    routeLayer.route.stack.map((layer) => layer.handle.name),
    ['verificarToken', 'verificarSesion']
  );
});

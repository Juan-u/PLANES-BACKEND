import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const testSecret = randomBytes(48).toString('base64url');
const pool = {
  query: mock.fn(async () => [[{ id_usuario: 123, estado: 'activo' }], []])
};

mock.module('../../app/config/auth.js', {
  namedExports: { JWT_SECRET: testSecret }
});
mock.module('../../app/config/db.js', { defaultExport: pool });

const { verificarToken } = await import('../../app/middleware/auth.middleware.js');

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

async function invokeMiddleware(authorization) {
  const req = { headers: {} };
  if (authorization !== undefined) {
    req.headers.authorization = authorization;
  }

  const res = createResponse();
  let nextCalled = false;
  await verificarToken(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

function createToken(subject = '123', options = {}) {
  return jwt.sign({ sub: subject }, testSecret, {
    algorithm: 'HS256',
    expiresIn: '2h',
    ...options
  });
}

test('valid HS256 bearer token for an active account continues and attaches its claims', async () => {
  pool.query.mock.resetCalls();
  const result = await invokeMiddleware(`Bearer ${createToken()}`);

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.usuario.sub, '123');
  assert.equal(pool.query.mock.callCount(), 1);
});

test('bearer scheme matching is case-insensitive and permits extra whitespace', async () => {
  pool.query.mock.resetCalls();
  const result = await invokeMiddleware(`  bEaReR   ${createToken()}  `);

  assert.equal(result.nextCalled, true);
  assert.equal(pool.query.mock.callCount(), 1);
});

test('missing and malformed authorization headers are rejected without querying the pool', async () => {
  for (const header of [undefined, 'Basic abc', 'Bearer', 'Bearer abc extra', 12]) {
    pool.query.mock.resetCalls();
    const result = await invokeMiddleware(header);

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 401);
    assert.equal(typeof result.res.body.error, 'string');
    assert.equal(pool.query.mock.callCount(), 0);
  }
});

test('invalid, expired, wrong-signature, and non-HS256 tokens are rejected before querying', async () => {
  const expiredToken = createToken('123', { expiresIn: -1 });
  const wrongAlgorithmToken = createToken('123', { algorithm: 'HS384' });
  const wrongSignatureToken = jwt.sign({ sub: '123' }, randomBytes(48), {
    algorithm: 'HS256',
    expiresIn: '2h'
  });
  const tokenWithoutExpiration = jwt.sign({ sub: '123' }, testSecret, {
    algorithm: 'HS256'
  });

  for (const token of [
    'not-a-token',
    expiredToken,
    wrongAlgorithmToken,
    wrongSignatureToken,
    tokenWithoutExpiration
  ]) {
    pool.query.mock.resetCalls();
    const result = await invokeMiddleware(`Bearer ${token}`);

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 401);
    assert.equal(typeof result.res.body.error, 'string');
    assert.equal(pool.query.mock.callCount(), 0);
  }
});

test('non-object JWT payloads are rejected before querying the pool', async () => {
  const token = jwt.sign('scalar-payload', testSecret, {
    algorithm: 'HS256'
  });
  pool.query.mock.resetCalls();
  const result = await invokeMiddleware(`Bearer ${token}`);

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
  assert.equal(pool.query.mock.callCount(), 0);
});

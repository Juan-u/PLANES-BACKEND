import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const testSecret = randomBytes(48).toString('base64url');
let queryResult = [[{ id_usuario: 123, estado: 'activo', id_rol: null, nombre_rol: null }], []];
let queryError = null;
const pool = {
  query: mock.fn(async (...args) => {
    if (queryError) {
      throw queryError;
    }
    return queryResult;
  })
};

mock.module('../../app/config/auth.js', {
  namedExports: { JWT_SECRET: testSecret }
});
mock.module('../../app/config/db.js', { defaultExport: pool });

const { verificarToken, autorizarRoles } = await import('../../app/middleware/auth.middleware.js');

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

async function invokeMiddleware(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createResponse();
  let nextCalled = false;

  await verificarToken(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

function createToken(subject, options = {}) {
  return jwt.sign({ sub: subject }, testSecret, {
    algorithm: 'HS256',
    expiresIn: '2h',
    ...options
  });
}

function resetPool({ result = [[{ id_usuario: 123, estado: 'activo', id_rol: null, nombre_rol: null }], []], error = null } = {}) {
  queryResult = result;
  queryError = error;
  pool.query.mock.resetCalls();
}

test('an existing active account is authorized after a valid HS256 token', async () => {
  resetPool();
  const token = createToken('123');
  const decoded = jwt.decode(token, { complete: true });
  const result = await invokeMiddleware(token);

  assert.equal(decoded.header.alg, 'HS256');
  assert.equal(Number.isFinite(decoded.payload.exp), true);
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.usuario.sub, '123');
  assert.equal(pool.query.mock.callCount(), 1);
});

test('the account query is parameterized and selects no personal or credential fields', async () => {
  resetPool();
  const result = await invokeMiddleware(createToken('123'));
  const [sql, values] = pool.query.mock.calls[0].arguments;

  assert.equal(result.nextCalled, true);
  assert.match(sql, /SELECT\s+u\.id_usuario\s*,\s*u\.estado\s*,\s*r\.nombre_rol\s+FROM\s+usuario\s+AS\s+u\s+LEFT\s+JOIN\s+rol\s+AS\s+r\s+ON\s+r\.id_rol\s*=\s*u\.id_rol\s+WHERE\s+u\.id_usuario\s*=\s*\?\s+LIMIT\s+1/i);
  assert.deepEqual(values, [123]);
  assert.doesNotMatch(sql, /correo|contrase(?:ñ|n)a|password|hash/i);
});

test('active account state accepts capitalization differences only', async () => {
  for (const estado of ['activo', 'Activo', 'ACTIVO']) {
    resetPool({ result: [[{ id_usuario: 123, estado, id_rol: null, nombre_rol: null }], []] });
    const result = await invokeMiddleware(createToken('123'));
    assert.equal(result.nextCalled, true, `estado=${estado}`);
  }

  for (const estado of [' activo', 'activo ', 'inactivo', null, 'habilitado']) {
    resetPool({ result: [[{ id_usuario: 123, estado, id_rol: null, nombre_rol: null }], []] });
    const result = await invokeMiddleware(createToken('123'));
    assert.equal(result.nextCalled, false, `estado=${String(estado)}`);
    assert.equal(result.res.statusCode, 401);
  }
});

async function invokeWithRole(token, rolesPermitidos) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createResponse();
  let autorizado = false;

  await verificarToken(req, res, () => {
    autorizarRoles(...rolesPermitidos)(req, res, () => {
      autorizado = true;
    });
  });

  return { req, res, autorizado };
}

test('authorization uses the role resolved from the database', async () => {
  resetPool({
    result: [[{ id_usuario: 123, estado: 'Activo', id_rol: 2, nombre_rol: 'App Admin' }], []]
  });
  const result = await invokeWithRole(createToken('123'), ['App Admin']);

  assert.equal(result.autorizado, true);
  assert.equal(result.req.usuario.rol, 'App Admin');
});

test('missing or unresolved role is denied by default', async () => {
  for (const account of [
    { id_usuario: 123, estado: 'activo', id_rol: null, nombre_rol: null },
    { id_usuario: 123, estado: 'activo', id_rol: 999, nombre_rol: null }
  ]) {
    resetPool({ result: [[account], []] });
    const result = await invokeWithRole(createToken('123'), ['App Admin']);

    assert.equal(result.autorizado, false);
    assert.equal(result.res.statusCode, 403);
  }
});

test('a role without permission for the operation receives 403', async () => {
  resetPool({
    result: [[{ id_usuario: 123, estado: 'activo', id_rol: 3, nombre_rol: 'Planning' }], []]
  });
  const result = await invokeWithRole(createToken('123'), ['App Admin']);

  assert.equal(result.autorizado, false);
  assert.equal(result.res.statusCode, 403);
});

test('a role claim in the JWT cannot grant access when the database has no role', async () => {
  resetPool({
    result: [[{ id_usuario: 123, estado: 'activo', id_rol: null, nombre_rol: null }], []]
  });
  const token = jwt.sign(
    { sub: '123', rol: 'App Admin' },
    testSecret,
    { algorithm: 'HS256', expiresIn: '2h' }
  );
  const result = await invokeWithRole(token, ['App Admin']);

  assert.equal(result.autorizado, false);
  assert.equal(result.res.statusCode, 403);
});

test('authorization middleware rejects an empty allowlist', () => {
  assert.throws(() => autorizarRoles());
  assert.throws(() => autorizarRoles(''));
});

test('authorization middleware rejects role names made only of whitespace', () => {
  assert.throws(() => autorizarRoles('   '));
});

test('inactive, null, and unknown account states are rejected', async () => {
  for (const estado of ['inactivo', null, 'pendiente']) {
    resetPool({ result: [[{ id_usuario: 123, estado }], []] });
    const result = await invokeMiddleware(createToken('123'));

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 401);
    assert.equal(typeof result.res.body.error, 'string');
    assert.equal(pool.query.mock.callCount(), 1);
  }
});

test('a missing account is rejected with a generic 401', async () => {
  resetPool({ result: [[], []] });
  const result = await invokeMiddleware(createToken('123'));

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
  assert.equal(typeof result.res.body.error, 'string');
});

test('missing, empty, negative, decimal, malformed, and out-of-range subjects are rejected before querying', async () => {
  const subjects = [undefined, '', '-1', '1.5', 'abc', '0', '2147483648'];

  for (const subject of subjects) {
    resetPool();
    const token = jwt.sign(
      subject === undefined ? {} : { sub: subject },
      testSecret,
      { algorithm: 'HS256', expiresIn: '2h' }
    );
    const result = await invokeMiddleware(token);

    assert.equal(result.nextCalled, false, `sub=${String(subject)} must be rejected`);
    assert.equal(result.res.statusCode, 401);
    assert.equal(pool.query.mock.callCount(), 0);
  }
});

test('expired, wrong-signature, and non-HS256 tokens are rejected without a database query', async () => {
  const tokens = [
    createToken('123', { expiresIn: -1 }),
    jwt.sign({ sub: '123' }, randomBytes(48), {
      algorithm: 'HS256',
      expiresIn: '2h'
    }),
    createToken('123', { algorithm: 'HS384' })
  ];

  for (const token of tokens) {
    resetPool();
    const result = await invokeMiddleware(token);

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 401);
    assert.equal(pool.query.mock.callCount(), 0);
  }
});

test('an account lookup failure fails closed with a generic 503', async () => {
  resetPool({ error: new Error('sensitive database details') });
  const result = await invokeMiddleware(createToken('123'));

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 503);
  assert.deepEqual(result.res.body, { error: 'No fue posible verificar la cuenta' });
  assert.doesNotMatch(JSON.stringify(result.res.body), /sensitive database details/i);
});

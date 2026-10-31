import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const testSecret = randomBytes(48).toString('base64url');
let accountRows = [[{ id_usuario: 21, estado: 'activo', nombre_rol: null }], []];
const pool = {
  query: mock.fn(async () => accountRows)
};

mock.module('../../app/config/auth.js', {
  namedExports: { JWT_SECRET: testSecret }
});
mock.module('../../app/config/db.js', { defaultExport: pool });

const { crearRouterPlanes } = await import('../../app/routes/routes.plan.js');

function crearResponse() {
  return {
    statusCode: null,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function crearToken() {
  return jwt.sign({ sub: '21' }, testSecret, {
    algorithm: 'HS256',
    expiresIn: '2h'
  });
}

function obtenerRuta(router, path) {
  const layer = router.stack.find((item) => item.route?.path === path);
  assert.ok(layer, `Debe existir la ruta ${path} en el router no montado`);
  return layer.route.stack.map((item) => item.handle);
}

test('no construye rutas si falta una política de autorización', () => {
  assert.throws(() => crearRouterPlanes({ pool }), /política de autorización/i);
});

test('ambas rutas ordenan JWT antes de autorización y del controlador', () => {
  const authorizationGate = (req, res, next) => next();
  const router = crearRouterPlanes({ pool, autorizarConsultaPlanes: authorizationGate });

  for (const path of ['/planes', '/planes/:id']) {
    const [authentication, authorization, controller] = obtenerRuta(router, path);
    assert.equal(authentication.name, 'verificarToken');
    assert.equal(authorization, authorizationGate);
    assert.equal(typeof controller, 'function');
  }
});

test('solicitud sin token se rechaza antes de autorización, controlador o consultas', async () => {
  pool.query.mock.resetCalls();
  let authorizationCalled = false;
  const authorizationGate = (req, res, next) => {
    authorizationCalled = true;
    return next();
  };
  const router = crearRouterPlanes({ pool, autorizarConsultaPlanes: authorizationGate });
  const [authentication] = obtenerRuta(router, '/planes');
  const req = { headers: {} };
  const res = crearResponse();
  let controllerReached = false;

  await authentication(req, res, () => {
    authorizationGate(req, res, () => {
      controllerReached = true;
    });
  });

  assert.equal(res.statusCode, 401);
  assert.equal(authorizationCalled, false);
  assert.equal(controllerReached, false);
  assert.equal(pool.query.mock.callCount(), 0);
});

test('una política denegatoria evita consultar planes después de autenticar', async () => {
  pool.query.mock.resetCalls();
  let controllerReached = false;
  const authorizationGate = (req, res) => res.status(403).json({ error: 'Acceso denegado.' });
  const router = crearRouterPlanes({ pool, autorizarConsultaPlanes: authorizationGate });
  const [authentication, authorization, controller] = obtenerRuta(router, '/planes');
  const req = { headers: { authorization: `Bearer ${crearToken()}` } };
  const res = crearResponse();

  await authentication(req, res, () => {
    authorization(req, res, () => {
      controllerReached = true;
      return controller(req, res);
    });
  });

  assert.equal(res.statusCode, 403);
  assert.equal(controllerReached, false);
  // Esta única consulta corresponde a validar la cuenta en verificarToken.
  assert.equal(pool.query.mock.callCount(), 1);
});

test('las rutas de escritura solo se registran con políticas explícitas y autentican primero', () => {
  const createGate = (req, res, next) => next();
  const updateGate = (req, res, next) => next();
  const router = crearRouterPlanes({ pool, autorizarConsultaPlanes: () => {},
    autorizarCrearPlan: createGate, autorizarActualizarPlan: updateGate });
  for (const [path, method, gate] of [['/planes', 'post', createGate], ['/planes/:id', 'put', updateGate]]) {
    const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
    assert.ok(layer);
    assert.equal(layer.route.stack[0].handle.name, 'verificarToken');
    assert.equal(layer.route.stack[1].handle, gate);
  }
  const readOnly = crearRouterPlanes({ pool, autorizarConsultaPlanes: () => {} });
  assert.equal(readOnly.stack.some((item) => item.route?.methods.post || item.route?.methods.put), false);
});

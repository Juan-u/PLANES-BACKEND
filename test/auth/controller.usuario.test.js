import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as passwordService from '../../app/services/password.service.js';

const originalPassword = 'controller-test-password';
let failHash = false;
let queryFailure = null;
let listResult = [[], []];
let accountRows = [{ id_usuario: 7, nombre: 'Old User', correo: 'old@example.invalid', estado: 'Activo' }];
let updateAffectedRows = 1;
const queryCalls = [];
const operationOrder = [];
function resultFor(sql) {
  if (queryFailure) throw queryFailure;
  if (/rol_autorizacion_mutex/.test(sql)) return [[{ mutex_id: 1 }], []];
  if (/AS authorized/.test(sql)) return [[{ authorized: 1 }], []];
  if (/INSERT INTO usuario/.test(sql)) return [{ insertId: 42, affectedRows: 1 }, []];
  if (/SELECT id_evento FROM rol_auditoria/.test(sql)) return [[], []];
  if (/INSERT INTO rol_auditoria/.test(sql)) return [{ affectedRows: 1 }, []];
  if (/SELECT id_usuario, nombre, correo, estado FROM usuario/.test(sql) || /SELECT id_usuario, estado FROM usuario/.test(sql)) return [accountRows, []];
  if (/UPDATE usuario/.test(sql)) return [{ affectedRows: updateAffectedRows }, []];
  return listResult;
}
const poolMock = {
  async query(sql, params) { queryCalls.push([sql, params]); operationOrder.push('pool-query'); return resultFor(sql); },
  async getConnection() {
    operationOrder.push('get-connection');
    return {
      async beginTransaction() { operationOrder.push('begin'); },
      async commit() { operationOrder.push('commit'); },
      async rollback() { operationOrder.push('rollback'); },
      release() { operationOrder.push('release'); },
      async execute(sql, params) { queryCalls.push([sql, params]); operationOrder.push('execute'); return resultFor(sql); },
      async query(sql, params) { queryCalls.push([sql, params]); operationOrder.push('query'); return resultFor(sql); }
    };
  }
};

mock.module('../../app/config/db.js', { defaultExport: poolMock });
mock.module('../../app/services/password.service.js', {
  namedExports: {
    hashPassword: async (password) => {
      operationOrder.push('hash');
      if (failHash) throw new Error(`Hash failure for ${password}; hidden credential`);
      return passwordService.hashPassword(password);
    },
    verifyPassword: passwordService.verifyPassword
  }
});

const { listarUsuarios, obtenerUsuario, crearUsuario, actualizarUsuario, eliminarUsuario, reactivarUsuario } =
  await import('../../app/controllers/controller.usuario.js');

function response() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const actor = { usuario: { sub: '11' } };
function reset() { queryCalls.length = 0; operationOrder.length = 0; failHash = false; queryFailure = null; updateAffectedRows = 1; }
function assertSafe(value) { assert.doesNotMatch(JSON.stringify(value), /password|contrase\u00f1a|scrypt\$/i); }

test('user creation hashes password, authorizes with mutex and audits in the same transaction', async () => {
  reset();
  const res = response();
  await crearUsuario({ ...actor, body: { nombre: 'Test User', email: 'test@example.invalid', password: originalPassword, reason: 'Onboarding' } }, res);
  const insert = queryCalls.find(([sql]) => /INSERT INTO usuario/.test(sql));
  assert.ok(insert);
  assert.match(insert[0], /`contrase\u00f1a`/);
  assert.doesNotMatch(insert[0], /id_rol/);
  assert.notEqual(insert[1][2], originalPassword);
  assert.equal(await passwordService.verifyPassword(originalPassword, insert[1][2]), true);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { id: 42, nombre: 'Test User', email: 'test@example.invalid', estado: 'Activo' });
  assert.ok(queryCalls.some(([sql]) => /rol_autorizacion_mutex/.test(sql)));
  assert.ok(queryCalls.some(([sql]) => /M01\.users\.create/.test(sql) || /permission\.codigo/.test(sql)));
  assert.ok(queryCalls.some(([sql]) => /INSERT INTO rol_auditoria/.test(sql)));
  assert.deepEqual(operationOrder.slice(-2), ['commit', 'release']);
  assertSafe(res.body);
});

test('account creation rejects unauthenticated actors and missing audit reason', async () => {
  reset();
  const unauthenticated = response();
  await crearUsuario({ body: { nombre: 'X', email: 'x@example.invalid', password: originalPassword, reason: 'reason' } }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(operationOrder.includes('get-connection'), false);

  const invalid = response();
  await crearUsuario({ ...actor, body: { nombre: 'X', email: 'x@example.invalid', password: originalPassword } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('user listing and lookup expose account fields without credentials', async () => {
  reset(); listResult = [[{ id: 7, nombre: 'Test User', email: 'test@example.invalid', estado: 'Activo' }], []];
  const list = response(); await listarUsuarios({}, list);
  assert.match(queryCalls[0][0], /estado FROM usuario ORDER BY/);
  assert.deepEqual(list.body, listResult[0]); assertSafe(list.body);

  reset(); accountRows = [{ id: 7, nombre: 'Test User', email: 'test@example.invalid', estado: 'Activo' }];
  const one = response(); await obtenerUsuario({ params: { id: '7' } }, one);
  assert.deepEqual(one.body, accountRows[0]); assertSafe(one.body);
});

test('profile updates require an audit reason and preserve the existing account role column', async () => {
  reset();
  const res = response();
  await actualizarUsuario({ ...actor, params: { id: '7' }, body: { nombre: 'Updated User', email: 'updated@example.invalid', reason: 'Corrected profile' } }, res);
  const update = queryCalls.find(([sql]) => /UPDATE usuario SET nombre/.test(sql));
  assert.deepEqual(update[1], ['Updated User', 'updated@example.invalid', 7]);
  assert.doesNotMatch(update[0], /id_rol/);
  assert.ok(queryCalls.some(([sql]) => /user_account_updated/.test(sql) || /INSERT INTO rol_auditoria/.test(sql)));
  assert.equal(res.statusCode, 200);
});

test('account deactivation is soft, audited, and invalidates later JWT checks through estado', async () => {
  reset(); accountRows = [{ id_usuario: 7, estado: 'Activo' }];
  const res = response();
  await eliminarUsuario({ ...actor, params: { id: '7' }, body: { reason: 'Access no longer required' } }, res);
  const update = queryCalls.find(([sql]) => /UPDATE usuario SET estado = 'Inactivo'/.test(sql));
  assert.ok(update);
  assert.doesNotMatch(update[0], /DELETE FROM/i);
  assert.ok(queryCalls.some(([sql]) => /INSERT INTO rol_auditoria/.test(sql)));
  assert.equal(res.body.status, 'Inactivo');
});

test('self-deactivation is denied and reactivation requires an authorized audited operation', async () => {
  reset();
  const self = response();
  await eliminarUsuario({ ...actor, params: { id: '11' }, body: { reason: 'self' } }, self);
  assert.equal(self.statusCode, 403);
  assert.equal(queryCalls.some(([sql]) => /UPDATE usuario SET estado/.test(sql)), false);

  reset(); accountRows = [{ id_usuario: 7, estado: 'Inactivo' }];
  const reactivate = response();
  await reactivarUsuario({ ...actor, params: { id: '7' }, body: { reason: 'Return to duties' } }, reactivate);
  assert.ok(queryCalls.some(([sql]) => /UPDATE usuario SET estado = 'Activo'/.test(sql)));
  assert.ok(queryCalls.some(([sql]) => /INSERT INTO rol_auditoria/.test(sql)));
  assert.equal(reactivate.body.status, 'Activo');
});

test('user management persistence failures are returned generically and roll back', async () => {
  reset(); queryFailure = new Error('private database detail');
  const res = response();
  await actualizarUsuario({ ...actor, params: { id: '7' }, body: { nombre: 'Updated', email: 'u@example.invalid', reason: 'Update' } }, res);
  queryFailure = null;
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /private database detail/);
  assert.ok(operationOrder.includes('rollback'));
  assert.equal(operationOrder.at(-1), 'release');
});

import { testMutex, markProtectedTestTransaction } from './test-mutex.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRoleCatalogRepository,
  RoleCatalogRepositoryError
} from '../../../app/repositories/roles/role-catalog.repository.js';

function makeTx(rows = []) {
  const calls = [];
  const tx = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [rows, []];
    }
  };
  return { tx: markProtectedTestTransaction(tx), calls };
}
function configuredRole(overrides = {}) {
  return {
    id_rol: 7,
    clasificacion_privilegio: 'ordinary',
    permite_vigencia_indefinida: 1,
    requiere_ambito: 0,
    ...overrides
  };
}

test('returns catalog and configuration fields for an existing role', async () => {
  const { tx, calls } = makeTx([configuredRole({
    clasificacion_privilegio: 'privileged',
    permite_vigencia_indefinida: 0,
    requiere_ambito: 1
  })]);

  const result = await createRoleCatalogRepository({ mutex: testMutex }).getById(7, tx);

  assert.deepEqual(result, {
    id: 7,
    classification: 'privileged',
    allowOpenEndedAssignment: false,
    requiresScope: true
  });
  assert.deepEqual(calls[0].params, [7]);
  assert.match(calls[0].sql, /FROM rol AS r/);
  assert.match(calls[0].sql, /LEFT JOIN rol_configuracion AS rc/);
  assert.match(calls[0].sql, /FOR UPDATE/);
});

test('returns null when the role does not exist', async () => {
  const { tx } = makeTx([]);
  assert.equal(await createRoleCatalogRepository({ mutex: testMutex }).getById(404, tx), null);
});

test('returns missing configuration as null fields so the service fails closed', async () => {
  const { tx } = makeTx([configuredRole({
    clasificacion_privilegio: null,
    permite_vigencia_indefinida: null,
    requiere_ambito: null
  })]);

  const result = await createRoleCatalogRepository({ mutex: testMutex }).getById(7, tx);

  assert.deepEqual(result, {
    id: 7,
    classification: null,
    allowOpenEndedAssignment: null,
    requiresScope: null
  });
});

test('preserves disabled configuration values as false', async () => {
  const { tx } = makeTx([configuredRole({
    permite_vigencia_indefinida: 0,
    requiere_ambito: 0
  })]);

  const result = await createRoleCatalogRepository({ mutex: testMutex }).getById(7, tx);

  assert.equal(result.allowOpenEndedAssignment, false);
  assert.equal(result.requiresScope, false);
});

test('propagates the original transaction query error', async () => {
  const queryError = new Error('database failure');
  const tx = markProtectedTestTransaction({ async execute() { throw queryError; } });

  await assert.rejects(
    createRoleCatalogRepository({ mutex: testMutex }).getById(7, tx),
    (error) => error === queryError
  );
});

test('requires and uses only the caller transaction', async () => {
  const repository = createRoleCatalogRepository({ mutex: testMutex });
  let calls = 0;
  const tx = {
    async execute() {
      calls += 1;
      return [[configuredRole()], []];
    }
  };
  markProtectedTestTransaction(tx);

  await assert.rejects(
    repository.getById(7),
    (error) => error instanceof RoleCatalogRepositoryError &&
      error.code === 'TRANSACTION_REQUIRED'
  );
  assert.equal(calls, 0);
  await repository.getById(7, tx);
  assert.equal(calls, 1);
});

test('returns the exact fields and ID representation expected by the service contract', async () => {
  const { tx, calls } = makeTx([configuredRole()]);
  const roleId = '007';

  const result = await createRoleCatalogRepository({ mutex: testMutex }).getById(roleId, tx);

  assert.deepEqual(result, {
    id: roleId,
    classification: 'ordinary',
    allowOpenEndedAssignment: true,
    requiresScope: false
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'allowOpenEndedAssignment', 'classification', 'id', 'requiresScope'
  ]);
  assert.deepEqual(calls[0].params, [7]);
});

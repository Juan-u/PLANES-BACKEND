import { testMutex, markProtectedTestTransaction } from './test-mutex.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  createScopeRefRepository,
  ScopeRefResolutionError
} from '../../../app/repositories/roles/scope-ref.repository.js';

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
function row(overrides = {}) {
  return {
    id_scope_ref: 41, ref_kind: 'number', ref_value: '12',
    activo: 1, allowed_role_id: 7, ...overrides
  };
}
function expectedHash(kind, value) {
  return createHash('sha256').update(kind + ':' + value, 'utf8').digest();
}

test('resolves a numeric scopeRef using the number kind and exact numeric value', async () => {
  const { tx, calls } = makeTx([row()]);
  const result = await createScopeRefRepository({ mutex: testMutex }).resolveForRole(12, 7, tx);
  assert.deepEqual(result, { idScopeRef: 41, scopeRef: 12, kind: 'number', value: '12' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM rol_scope_ref AS sr/);
  assert.match(calls[0].sql, /LEFT JOIN rol_scope_permitido AS rsp/);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[0].params, [7, 'number', expectedHash('number', '12'), '12']);
});

test('resolves text without trimming or changing its value', async () => {
  const exactText = ' 12 ';
  const { tx, calls } = makeTx([row({ ref_kind: 'string', ref_value: exactText })]);
  const result = await createScopeRefRepository({ mutex: testMutex }).resolveForRole(exactText, 7, tx);
  assert.equal(result.kind, 'string');
  assert.equal(result.value, exactText);
  assert.equal(result.scopeRef, exactText);
  assert.equal(calls[0].params[1], 'string');
  assert.equal(calls[0].params[3], exactText);
  assert.match(calls[0].sql, /BINARY sr\.ref_value = BINARY \?/);
});

test('keeps numeric 12 distinct from text "12"', async () => {
  const calls = [];
  const tx = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[row({ ref_kind: params[1], ref_value: params[3] })], []];
    }
  };
  markProtectedTestTransaction(tx);
  const repository = createScopeRefRepository({ mutex: testMutex });
  await repository.resolveForRole(12, 7, tx);
  await repository.resolveForRole('12', 7, tx);
  assert.equal(calls[0].params[1], 'number');
  assert.equal(calls[1].params[1], 'string');
  assert.equal(calls[0].params[3], '12');
  assert.equal(calls[1].params[3], '12');
  assert.notDeepEqual(calls[0].params[2], calls[1].params[2]);
});

test('rejects an unregistered scopeRef', async () => {
  const { tx } = makeTx([]);
  await assert.rejects(
    createScopeRefRepository({ mutex: testMutex }).resolveForRole(12, 7, tx),
    (error) => error instanceof ScopeRefResolutionError && error.code === 'SCOPE_REFERENCE_NOT_FOUND'
  );
});

test('rejects an inactive scopeRef', async () => {
  const { tx } = makeTx([row({ activo: 0 })]);
  await assert.rejects(
    createScopeRefRepository({ mutex: testMutex }).resolveForRole(12, 7, tx),
    (error) => error.code === 'SCOPE_REFERENCE_INACTIVE'
  );
});

test('rejects a scopeRef not permitted for the requested role', async () => {
  const { tx } = makeTx([row({ allowed_role_id: null })]);
  await assert.rejects(
    createScopeRefRepository({ mutex: testMutex }).resolveForRole(12, 7, tx),
    (error) => error.code === 'SCOPE_NOT_ALLOWED_FOR_ROLE'
  );
});

test('propagates the original transaction query error', async () => {
  const queryError = new Error('database failure');
  const tx = markProtectedTestTransaction({ async execute() { throw queryError; } });
  await assert.rejects(
    createScopeRefRepository({ mutex: testMutex }).resolveForRole(12, 7, tx),
    (error) => error === queryError
  );
});

test('requires and uses only the transaction passed by the caller', async () => {
  const repository = createScopeRefRepository({ mutex: testMutex });
  let calls = 0;
  const tx = markProtectedTestTransaction({ async execute() { calls += 1; return [[row()], []]; } });
  await assert.rejects(
    repository.resolveForRole(12, 7),
    (error) => error.code === 'TRANSACTION_REQUIRED'
  );
  assert.equal(calls, 0);
  await repository.resolveForRole(12, 7, tx);
  assert.equal(calls, 1);
});

test('resolves a plan by typed ID and returns its real name', async () => {
  const { tx, calls } = makeTx([{
    id_scope_ref: 52, ref_value: 'scope-ref', activo: 1, allowed_role_id: 7,
    tipo_recurso: 'plan', id_plan: 3, id_actividad: null,
    plan_name: 'Plan institucional', resource_name: 'Plan institucional'
  }]);
  const result = await createScopeRefRepository({ mutex: testMutex })
    .resolveResourceForRole({ type: 'plan', id: 3 }, 7, tx);

  assert.deepEqual(result, {
    idScopeRef: 52, scopeRef: 'scope-ref', resourceType: 'plan',
    resourceId: 3, resourceName: 'Plan institucional', planId: 3, planName: 'Plan institucional'
  });
  assert.deepEqual(calls[0].params, [7, 'plan', 3, 3]);
  assert.match(calls[0].sql, /CASE WHEN scoped_resource\.tipo_recurso = 'plan' THEN plan\.nombre/);
});

test('resolves activities with their owning plan and rejects inactive or unauthorized resources', async () => {
  const repository = createScopeRefRepository({ mutex: testMutex });
  const activityRow = {
    id_scope_ref: 53, ref_value: 'scope-activity', activo: 1, allowed_role_id: 7,
    tipo_recurso: 'activity', id_plan: 3, id_actividad: 9,
    plan_name: 'Plan institucional', resource_name: 'Actividad institucional'
  };
  const { tx } = makeTx([activityRow]);
  const result = await repository.resolveResourceForRole({ type: 'activity', id: 9 }, 7, tx);
  assert.equal(result.resourceName, 'Actividad institucional');
  assert.equal(result.planId, 3);
  assert.equal(result.planName, 'Plan institucional');

  for (const [overrides, code] of [
    [{ activo: 0 }, 'SCOPE_REFERENCE_INACTIVE'],
    [{ allowed_role_id: null }, 'SCOPE_NOT_ALLOWED_FOR_ROLE']
  ]) {
    const denied = makeTx([{ ...activityRow, ...overrides }]);
    await assert.rejects(repository.resolveResourceForRole({ type: 'activity', id: 9 }, 7, denied.tx),
      (error) => error.code === code);
  }
});

test('lists only active, role-enabled typed resources with plan and activity labels', async () => {
  const rows = [
    { scope_ref: 'plan-scope', tipo_recurso: 'plan', id_plan: 3, id_actividad: null,
      resource_name: 'Plan institucional', plan_name: 'Plan institucional' },
    { scope_ref: 'activity-scope', tipo_recurso: 'activity', id_plan: 3, id_actividad: 9,
      resource_name: 'Actividad institucional', plan_name: 'Plan institucional' }
  ];
  const { tx, calls } = makeTx(rows);
  const result = await createScopeRefRepository({ mutex: testMutex }).listResourcesForRole(7, tx);
  assert.deepEqual(result, [
    { scopeRef: 'plan-scope', resourceType: 'plan', resourceId: 3,
      resourceName: 'Plan institucional', planId: 3, planName: 'Plan institucional' },
    { scopeRef: 'activity-scope', resourceType: 'activity', resourceId: 9,
      resourceName: 'Actividad institucional', planId: 3, planName: 'Plan institucional' }
  ]);
  assert.deepEqual(calls[0].params, [7]);
  assert.match(calls[0].sql, /JOIN rol_scope_permitido AS permitted/);
  assert.match(calls[0].sql, /WHERE sr\.activo = 1/);
});

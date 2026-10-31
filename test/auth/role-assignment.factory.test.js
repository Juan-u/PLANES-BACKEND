import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoleAssignmentServiceWithPool } from '../../app/services/role-assignment.factory.js';
import { createAuthorizationMutexRepository } from '../../app/repositories/roles/authorization-mutex.repository.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');

function makePool() {
  const events = [];
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); },
    async query() {
      events.push('connection-query');
      throw new Error('This composition test must not execute SQL.');
    },
    async execute(sql) {
      events.push('connection-execute');
      if (sql === 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE') {
        return [[{ mutex_id: 1 }], []];
      }
      throw new Error('This composition test must not execute SQL.');
    }
  };
  const pool = {
    async getConnection() {
      events.push('getConnection');
      return connection;
    },
    async query() {
      events.push('pool-query');
      throw new Error('The pool must not be queried directly.');
    }
  };
  return { pool, events };
}

function makeDependencies(observed) {
  let nextId = 0;
  const observeTransaction = (name) => (tx) => {
    observed[name] = tx;
    return tx;
  };
  return {
    mutex: createAuthorizationMutexRepository(),
    authorization: {
      canManageRole: async (context, tx) => {
        observed.authorizationContext = context;
        observeTransaction('authorizationTransaction')(tx);
        return true;
      }
    },
    roleCatalog: {
      getById: async (id, tx) => {
        observed.roleId = id;
        observeTransaction('catalogTransaction')(tx);
        return { id, classification: 'ordinary', allowOpenEndedAssignment: true };
      }
    },
    assignments: {
      hasEquivalent: async (_query, tx) => {
        observeTransaction('duplicateCheckTransaction')(tx);
        return false;
      },
      create: async (record, tx) => {
        observed.assignment = record;
        observeTransaction('createTransaction')(tx);
        return record;
      },
      getById: async () => null,
      revoke: async () => null
    },
    changeRequests: {
      hasEquivalentPending: async () => false,
      createPending: async () => null,
      getById: async () => null,
      getByIdForUpdate: async () => null,
      decideIfPending: async () => false
    },
    audit: {
      append: async (event, tx) => {
        observed.auditEvent = event;
        observeTransaction('auditTransaction')(tx);
      }
    },
    clock: { now: () => NOW },
    ids: { next: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}` },
    approvalWindowMs: 60_000
  };
}

test('factory injects its transaction runner and passes external dependencies through it', async () => {
  const { pool, events } = makePool();
  const observed = {};
  const service = createRoleAssignmentServiceWithPool(pool, makeDependencies(observed));

  const result = await service.assignRole(
    { actorId: 9 },
    { targetUserId: 23, roleId: 17, reason: 'Authorized test assignment' }
  );

  assert.equal(result.ok, true);
  assert.equal(result.result, 'active');
  assert.equal(observed.authorizationContext.actorId, 9);
  assert.equal(observed.authorizationContext.roleId, 17);
  assert.equal(observed.roleId, 17);
  assert.equal(observed.assignment.userId, 23);
  assert.equal(observed.auditEvent.action, 'role_assigned');

  const transactionContexts = [
    observed.authorizationTransaction,
    observed.catalogTransaction,
    observed.duplicateCheckTransaction,
    observed.createTransaction,
    observed.auditTransaction
  ];
  assert.ok(transactionContexts[0]);
  assert.ok(transactionContexts.every((tx) => tx === transactionContexts[0]));
  assert.deepEqual(Object.keys(transactionContexts[0]).sort(), ['execute', 'query']);
  assert.deepEqual(events, ['getConnection', 'begin', 'connection-execute', 'commit', 'release']);
  assert.equal(events.includes('pool-query'), false);
  assert.equal(events.includes('connection-query'), false);
  assert.equal(events.filter((event) => event === 'connection-execute').length, 1);
});

test('factory rejects a caller-supplied transaction runner instead of replacing it', () => {
  const { pool, events } = makePool();
  const dependencies = {
    transactions: { run: async () => ({ ok: true }) }
  };

  assert.throws(
    () => createRoleAssignmentServiceWithPool(pool, dependencies),
    /transaction runner is created by this factory/
  );
  assert.deepEqual(events, []);
});

test('factory supplies no fake required dependencies when external dependencies are missing', async () => {
  const { pool, events } = makePool();
  const service = createRoleAssignmentServiceWithPool(pool, {});

  const result = await service.assignRole(
    { actorId: 9 },
    { targetUserId: 23, roleId: 17, reason: 'Test without dependencies' }
  );

  assert.equal(result.code, 'DEPENDENCIES_UNAVAILABLE');
  assert.deepEqual(events, []);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoleAssignmentService } from '../../app/services/role-assignment.service.js';
import { createAuthorizationMutexRepository } from '../../app/repositories/roles/authorization-mutex.repository.js';
import { ScopeRefResolutionError } from '../../app/repositories/roles/scope-ref.repository.js';

const NOW = '2026-10-28T12:00:00.000Z';
const FUTURE = '2026-10-29T12:00:00.000Z';
const END = '2026-10-30T12:00:00.000Z';
const clone = (x) => x == null ? x : structuredClone(x);

function harness(options = {}) {
  let time = Date.parse(NOW), seq = 0, auditFailure = false, writeFailure = false;
  const trace = [], transactionEvents = [];
  const rawMutex = createAuthorizationMutexRepository();
  let protectedFacade;
  const mutex = {
    withLock: (tx, work) => rawMutex.withLock(tx, (protectedTx) => {
      protectedFacade = protectedTx;
      return work(protectedTx);
    }),
    assertHeld: (tx) => rawMutex.assertHeld(tx)
  };
  const roles = new Map([
    ['ordinary-a', { id: 'ordinary-a', classification: 'ordinary', allowOpenEndedAssignment: true, requiresScope: false }],
    ['ordinary-b', { id: 'ordinary-b', classification: 'ordinary', allowOpenEndedAssignment: true, requiresScope: false }],
    ['scoped', { id: 'scoped', classification: 'ordinary', allowOpenEndedAssignment: true, requiresScope: true }],
    ['scope-authority', { id: 'scope-authority', name: 'scope_authority_manager',
      classification: 'ordinary', allowOpenEndedAssignment: false, requiresScope: true }],
    ['privileged', { id: 'privileged', classification: 'privileged', allowOpenEndedAssignment: false, requiresScope: false }],
    ['unknown', { id: 'unknown', classification: null, allowOpenEndedAssignment: true }]
  ]);
  const assignments = new Map(), requests = new Map(), events = [];
  const assignmentReads = new Map();
  const permission = options.permission ?? true;
  const deps = {
    authorization: {
      canManageRole: async (c) => { trace.push('authorization'); return typeof permission === 'function' ? permission(c) : permission; }
    },
    roleCatalog: { getById: async (id) => { trace.push('role'); return clone(roles.get(id) ?? null); } },
    mutex,
    assignments: {
      hasEquivalent: async (q) => {
        trace.push('assignment-check');
        if (options.scopeResolutionFailure) throw options.scopeResolutionFailure;
        const start = Date.parse(q.validFrom), end = q.validUntil == null ? Infinity : Date.parse(q.validUntil);
        return [...assignments.values()].some((a) => {
          if (a.userId !== q.targetUserId || a.roleId !== q.roleId ||
              a.scopeRef !== q.scopeRef || a.status === 'revoked') return false;
          const oldStart = Date.parse(a.validFrom), oldEnd = a.validUntil == null ? Infinity : Date.parse(a.validUntil);
          return start < oldEnd && oldStart < end;
        });
      },
      resolveResource: async (resource) => {
        trace.push('resource-resolve');
        if (options.resourceResolutionFailure) throw options.resourceResolutionFailure;
        return { scopeRef: `${resource.type}:${resource.id}` };
      },
      listResourcesForRole: async () => {
        trace.push('resource-list');
        return options.resources ?? [];
      },
      create: async (a) => {
        trace.push('assignment-create');
        if (writeFailure) throw new Error('fake persistence failure');
        assignments.set(a.assignmentId, clone(a));
        return clone(a);
      },
      getById: async (id) => {
        trace.push('assignment-preview');
        const count = (assignmentReads.get(id) ?? 0) + 1;
        assignmentReads.set(id, count);
        const item = clone(assignments.get(id) ?? null);
        if (item && options.assignmentChangesOnSecondRead && count === 2) item.status = 'revoked';
        return item;
      },
      revoke: async (data) => {
        trace.push('assignment-revoke');
        if (writeFailure) throw new Error('fake persistence failure');
        const old = assignments.get(data.assignmentId);
        if (!old || old.status === 'revoked') return null;
        const next = { ...old, ...clone(data), status: 'revoked' };
        assignments.set(data.assignmentId, next);
        return clone(next);
      }
    },
    changeRequests: {
      hasEquivalentPending: async (q) => { trace.push('request-check'); return [...requests.values()].some((r) =>
        r.status === 'pending_approval' && r.action === q.action &&
        r.targetUserId === q.targetUserId && r.roleId === q.roleId &&
        (r.assignmentId ?? null) === (q.assignmentId ?? null) && r.scopeRef === q.scopeRef); },
      createPending: async (r) => {
        trace.push('request-create');
        if (writeFailure) throw new Error('fake persistence failure');
        requests.set(r.requestId, clone(r));
        return clone(r);
      },
      getById: async (id) => { trace.push('request-preview'); return clone(requests.get(id) ?? null); },
      getByIdForUpdate: async (id) => {
        trace.push('request-lock');
        const item = clone(requests.get(id) ?? null);
        if (item && options.requestChangesOnLock) item.reason += ' changed';
        return item;
      },
      decideIfPending: async (id, decision) => {
        trace.push('request-decision');
        const old = requests.get(id);
        if (!old || old.status !== 'pending_approval') return false;
        requests.set(id, { ...old, ...clone(decision) });
        return true;
      }
    },
    audit: { append: async (e) => {
      trace.push('audit');
      if (auditFailure) throw new Error('fake audit failure');
      events.push(clone(e));
    } },
    transactions: {
      run: async (work) => {
        transactionEvents.push('begin');
        const rawTx = {
          async execute(sql) {
            trace.push(sql === 'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE' ? 'mutex' : 'unexpected-tx-execute');
            if (options.mutexFailure) throw options.mutexFailure;
            if (options.mutexMissing) return [[], []];
            return [[{ mutex_id: 1 }], []];
          },
          async query() { return [[], []]; }
        };
        const oldAssignments = clone([...assignments.entries()]);
        const oldRequests = clone([...requests.entries()]);
        const oldEvents = clone(events);
        try { const result = await work(rawTx); transactionEvents.push('commit'); return result; }
        catch (e) {
          transactionEvents.push('rollback');
          assignments.clear(); for (const [k, v] of oldAssignments) assignments.set(k, v);
          requests.clear(); for (const [k, v] of oldRequests) requests.set(k, v);
          events.splice(0, events.length, ...oldEvents);
          throw e;
        }
      }
    },
    clock: { now: () => new Date(time) },
    ids: options.ids ?? { next: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` },
    approvalWindowMs: 60_000
  };
  const requireProtectedFacade = (tx) => {
    if (!tx || tx !== protectedFacade) throw new Error('Repository received a transaction outside the mutex facade.');
    rawMutex.assertHeld(tx);
  };
  for (const repository of [deps.authorization, deps.roleCatalog, deps.assignments, deps.changeRequests, deps.audit]) {
    for (const [name, method] of Object.entries(repository)) {
      repository[name] = (...args) => {
        requireProtectedFacade(args.at(-1));
        return method(...args);
      };
    }
  }
  if (options.missing) delete deps[options.missing];
  return {
    service: createRoleAssignmentService(deps), roles, assignments, requests, events, trace, transactionEvents, mutex,
    get protectedFacade() { return protectedFacade; },
    clearTrace() { trace.splice(0); transactionEvents.splice(0); },
    setTime(x) { time = Date.parse(x); },
    failAudit(x) { auditFailure = x; },
    failWrites(x) { writeFailure = x; }
  };
}

const input = (overrides = {}) => ({
  actorId: 'operator-a', targetUserId: 'person-a', roleId: 'ordinary-a',
  scopeRef: 'scope-a', validFrom: NOW, validUntil: END,
  reason: 'Approved staffing update', ...overrides
});

// Simulates a trusted server adapter supplying identity separately from payload data.
const assign = (h, payload, trustedActorId = payload.actorId) =>
  h.service.assignRole({ actorId: trustedActorId }, payload);
const revoke = (h, payload, trustedActorId = payload.actorId) =>
  h.service.revokeRole({ actorId: trustedActorId }, payload);
const decide = (h, payload, trustedActorId = payload.actorId) =>
  h.service.decideChange({ actorId: trustedActorId }, payload);

async function privilegedRequest(h, overrides = {}) {
  const r = await assign(h, input({ roleId: 'privileged', ...overrides }));
  assert.equal(r.result, 'pending_approval');
  return r.requestId;
}

test('assigns ordinary roles and allows multiple roles for one person', async () => {
  const h = harness();
  const a = await assign(h, input());
  const b = await assign(h, input({ roleId: 'ordinary-b' }));
  assert.equal(a.result, 'active');
  assert.equal(b.result, 'active');
  assert.equal(h.assignments.size, 2);
  assert.equal(h.events.length, 2);
});

test('denies operation without explicit authority and makes no writes', async () => {
  const h = harness({ permission: false });
  const r = await assign(h, input());
  assert.equal(r.code, 'AUTHORITY_REQUIRED');
  assert.equal(h.assignments.size, 0);
  assert.equal(h.events.length, 0);
});

test('prevents assigning the protected initial scope-authority role through the ordinary assignment route', async () => {
  const h = harness();
  const result = await h.service.assignRole({actorId: 1}, {
    targetUserId: 2, roleId: 'scope-authority', scopeResource: {type: 'plan', id: 1},
    reason: 'Must use the audited initial authority process'
  });
  assert.deepEqual(result, {ok: false, code: 'PROTECTED_SCOPE_AUTHORITY_ASSIGNMENT'});
  assert.equal(h.assignments.size, 0);
  assert.equal(h.trace.includes('authorization'), false);
});

test('requires a scope for scoped roles and resolves typed resources before authorization', async () => {
  const h = harness();
  const missingScope = await assign(h, input({ roleId: 'scoped', scopeRef: null }));
  assert.equal(missingScope.code, 'SCOPE_REQUIRED');

  const scopedAssignment = await assign(h, input({
    roleId: 'scoped', scopeRef: null, scopeResource: { type: 'plan', id: 1 }
  }));
  assert.equal(scopedAssignment.result, 'active');
  assert.equal([...h.assignments.values()][0].scopeRef, 'plan:1');
  assert.ok(h.trace.indexOf('resource-resolve') < h.trace.indexOf('authorization'));
  assert.equal(h.events[0].scopeRef, 'plan:1');
});

test('lists only typed resources where the actor has effective assignment authority', async () => {
  const h = harness({
    resources: [
      { resourceType: 'plan', resourceId: 1, scopeRef: 'scope-plan-1', resourceName: 'Plan 1', planId: 1, planName: 'Plan 1' },
      { resourceType: 'activity', resourceId: 9, scopeRef: 'scope-activity-9', resourceName: 'Actividad 9', planId: 1, planName: 'Plan 1' }
    ],
    permission: ({ scopeRef }) => scopeRef === 'scope-plan-1'
  });
  const result = await h.service.listAssignableResources({ actorId: 'operator-a' }, {
    targetUserId: 'person-a', roleId: 'scoped'
  });
  assert.deepEqual(result.resources, [{
    type: 'plan', id: 1, name: 'Plan 1', planId: 1, planName: 'Plan 1'
  }]);
  assert.ok(h.trace.includes('resource-list'));
  assert.equal((await h.service.listAssignableResources({ actorId: 'operator-a' }, {
    targetUserId: 'operator-a', roleId: 'scoped'
  })).resources.length, 0);
});

test('rejects self-assignment', async () => {
  const h = harness();
  const r = await assign(h, input({ actorId: 'person-a' }));
  assert.equal(r.code, 'SELF_ASSIGNMENT_DENIED');
  assert.equal(h.assignments.size, 0);
});

test('ignores a forged payload actor and requires trusted actor context', async () => {
  const h = harness({ permission: ({ actorId }) => actorId === 'trusted-operator' });
  const forged = await assign(h, input({ actorId: 'trusted-operator' }), 'attacker');
  assert.equal(forged.code, 'AUTHORITY_REQUIRED');
  assert.equal(h.assignments.size, 0);
  assert.equal(h.events.length, 0);
  assert.equal((await h.service.assignRole(undefined, input())).code, 'INVALID_IDENTIFIER');
});

test('normalizes equivalent numeric actor and target identifiers for self-assignment', async () => {
  const h = harness();
  const r = await assign(h, input({ targetUserId: '0042' }), 42);
  assert.equal(r.code, 'SELF_ASSIGNMENT_DENIED');
  assert.equal(h.assignments.size, 0);
});

test('requires a reason and valid non-reversed dates', async () => {
  const h = harness();
  assert.equal((await assign(h, input({ reason: ' ' }))).code, 'REASON_REQUIRED');
  assert.equal((await assign(h, input({ validFrom: '2026-10-28T12:00:00' }))).code, 'INVALID_VALIDITY');
  assert.equal((await assign(h, input({ validFrom: END, validUntil: FUTURE }))).code, 'INVALID_VALIDITY');
  assert.equal((await assign(h, input({ validFrom: '2026-02-30T12:00:00Z' }))).code, 'INVALID_VALIDITY');
  assert.equal(h.assignments.size, 0);
});

test('denies role with missing trusted classification', async () => {
  const h = harness();
  const r = await assign(h, input({ roleId: 'unknown' }));
  assert.equal(r.code, 'ROLE_CLASSIFICATION_REQUIRED');
  assert.equal(h.assignments.size, 0);
  assert.equal(h.requests.size, 0);
});

test('requires generated identifiers to be UUID v4 before persistence', async () => {
  const h = harness({ ids: { next: () => 'not-a-uuid' } });
  const result = await h.service.assignRole({ actorId: 'operator-a' }, input());
  assert.deepEqual(result, { ok: false, code: 'IDENTIFIER_UNAVAILABLE' });
  assert.equal(h.assignments.size, 0);
  assert.deepEqual(h.transactionEvents, ['begin', 'rollback']);
});

test('preserves recognized scope validation errors for the HTTP adapter', async () => {
  const h = harness({ scopeResolutionFailure: new ScopeRefResolutionError(
    'SCOPE_REFERENCE_NOT_FOUND', 'Unregistered scope reference'
  ) });
  const result = await h.service.assignRole({ actorId: 'operator-a' }, input());
  assert.deepEqual(result, { ok: false, code: 'SCOPE_REFERENCE_NOT_FOUND' });
  assert.equal(h.assignments.size, 0);
  assert.deepEqual(h.transactionEvents, ['begin', 'rollback']);
});

test('privileged assignment creates a pending request but no assignment', async () => {
  const h = harness(), id = await privilegedRequest(h);
  assert.equal(h.requests.get(id).status, 'pending_approval');
  assert.equal(h.assignments.size, 0);
  assert.equal(h.events[0].action, 'role_assignment_requested');
});

test('requester cannot approve their own request', async () => {
  const h = harness(), requestId = await privilegedRequest(h);
  const r = await decide(h, {
    actorId: 'operator-a', requestId, decision: 'approve', reason: 'Approval'
  });
  assert.equal(r.code, 'SELF_APPROVAL_DENIED');
  assert.equal(h.requests.get(requestId).status, 'pending_approval');
  assert.equal(h.assignments.size, 0);
});

test('another authorized operator approves privileged assignment', async () => {
  const h = harness(), requestId = await privilegedRequest(h);
  h.clearTrace();
  const r = await decide(h, {
    actorId: 'operator-b', requestId, decision: 'approve', reason: 'Second approval'
  });
  assert.equal(h.trace[0], 'mutex');
  assert.ok(h.trace.indexOf('role') < h.trace.indexOf('request-lock'));
  assert.ok(h.trace.indexOf('request-lock') < h.trace.indexOf('assignment-create'));
  assert.ok(h.trace.indexOf('assignment-create') < h.trace.indexOf('request-decision'));
  assert.equal(r.result, 'approved');
  assert.equal(h.requests.get(requestId).status, 'approved');
  assert.equal(h.assignments.size, 1);
  assert.equal(h.events.at(-1).action, 'role_assignment_approved');
});

test('rejects duplicate assignment and duplicate pending request', async () => {
  const h = harness();
  await assign(h, input());
  assert.equal((await assign(h, input())).code, 'DUPLICATE_ASSIGNMENT');
  const p = input({ roleId: 'privileged' });
  await assign(h, p);
  assert.equal((await assign(h, p)).code, 'DUPLICATE_REQUEST');
  assert.equal(h.requests.size, 1);
});

test('expires pending request and refuses late approval', async () => {
  const h = harness(), requestId = await privilegedRequest(h);
  h.setTime('2026-10-28T12:01:00.000Z');
  const r = await decide(h, {
    actorId: 'operator-b', requestId, decision: 'approve', reason: 'Late'
  });
  assert.equal(r.code, 'REQUEST_EXPIRED');
  assert.equal(h.requests.get(requestId).status, 'expired');
  assert.equal(h.requests.get(requestId).decisionActorType, 'system');
  assert.equal(h.requests.get(requestId).decidedBy, null);
  assert.equal(h.events.at(-1).actorType, 'system');
  assert.equal(h.events.at(-1).actorId, null);
  assert.equal(h.assignments.size, 0);
});

test('scheduled assignments are inactive before start and expire at end', async () => {
  const h = harness();
  const r = await assign(h, input({ validFrom: FUTURE, validUntil: END }));
  const a = h.assignments.get(r.assignmentId);
  assert.equal(r.result, 'scheduled');
  assert.equal(h.service.getAssignmentStatus(a, NOW), 'scheduled');
  assert.equal(h.service.getAssignmentStatus(a, FUTURE), 'active');
  assert.equal(h.service.getAssignmentStatus(a, END), 'expired');
});

test('ordinary retirement preserves assignment history and audits it', async () => {
  const h = harness(), granted = await assign(h, input());
  const r = await revoke(h, {
    actorId: 'operator-a', assignmentId: granted.assignmentId, reason: 'No longer needed'
  });
  assert.equal(r.result, 'revoked');
  assert.equal(h.assignments.has(granted.assignmentId), true);
  assert.equal(h.assignments.get(granted.assignmentId).status, 'revoked');
  assert.equal(h.events.at(-1).action, 'role_revoked');
});

test('privileged retirement waits for second approval, then revokes', async () => {
  const h = harness(), id = await privilegedRequest(h);
  await decide(h, { actorId: 'operator-b', requestId: id, decision: 'approve', reason: 'Grant' });
  const assignmentId = [...h.assignments.keys()][0];
  h.clearTrace();
  const pending = await revoke(h, {
    actorId: 'operator-a', assignmentId, reason: 'Remove privileged role'
  });
  assert.equal(h.trace[0], 'mutex');
  assert.ok(h.trace.indexOf('role') < h.trace.indexOf('request-create'));
  assert.ok(h.trace.indexOf('request-create') < h.trace.indexOf('audit'));
  assert.equal(pending.result, 'pending_approval');
  assert.equal(h.assignments.get(assignmentId).status, 'active');
  h.clearTrace();
  const r = await decide(h, {
    actorId: 'operator-c', requestId: pending.requestId, decision: 'approve', reason: 'Removal approved'
  });
  assert.equal(h.trace[0], 'mutex');
  assert.ok(h.trace.indexOf('role') < h.trace.indexOf('request-lock'));
  assert.ok(h.trace.indexOf('request-lock') < h.trace.indexOf('assignment-preview'));
  assert.ok(h.trace.indexOf('assignment-preview') < h.trace.indexOf('assignment-revoke'));
  assert.ok(h.trace.indexOf('assignment-revoke') < h.trace.indexOf('request-decision'));
  assert.ok(h.trace.indexOf('request-decision') < h.trace.indexOf('audit'));
  assert.equal(r.result, 'revoked');
  assert.equal(h.assignments.get(assignmentId).status, 'revoked');
});

test('same request cannot be applied twice', async () => {
  const h = harness(), requestId = await privilegedRequest(h);
  await decide(h, { actorId: 'operator-b', requestId, decision: 'approve', reason: 'Approved' });
  const r = await decide(h, {
    actorId: 'operator-c', requestId, decision: 'approve', reason: 'Repeated'
  });
  assert.equal(r.code, 'REQUEST_NOT_PENDING');
  assert.equal(h.assignments.size, 1);
});

test('revalidates requester authority and role classification at approval', async () => {
  let requesterAllowed = true;
  const h = harness({
    permission: ({ actorId }) => actorId === 'operator-b' || (actorId === 'operator-a' && requesterAllowed)
  });
  const id = await privilegedRequest(h);
  requesterAllowed = false;
  const r = await decide(h, {
    actorId: 'operator-b', requestId: id, decision: 'approve', reason: 'Approval'
  });
  assert.equal(r.code, 'REQUESTER_AUTHORITY_REVOKED');
  assert.equal(h.assignments.size, 0);

  const h2 = harness(), id2 = await privilegedRequest(h2);
  h2.roles.set('privileged', {
    id: 'privileged', classification: 'ordinary', allowOpenEndedAssignment: false, requiresScope: false
  });
  const changed = await decide(h2, {
    actorId: 'operator-b', requestId: id2, decision: 'approve', reason: 'Approval'
  });
  assert.equal(changed.code, 'ROLE_CLASSIFICATION_CHANGED');
  assert.equal(h2.assignments.size, 0);
});

test('rejection is audited and does not apply the request', async () => {
  const h = harness(), requestId = await privilegedRequest(h);
  const r = await decide(h, {
    actorId: 'operator-b', requestId, decision: 'reject', reason: 'Rejected'
  });
  assert.equal(r.result, 'rejected');
  assert.equal(h.requests.get(requestId).status, 'rejected');
  assert.equal(h.assignments.size, 0);
  assert.equal(h.events.at(-1).action, 'role_change_rejected');
});

test('audit and persistence failures roll back all writes', async () => {
  const h = harness();
  h.failAudit(true);
  const r = await assign(h, input());
  assert.equal(r.code, 'PERSISTENCE_FAILED');
  assert.equal(h.assignments.size, 0);
  assert.equal(h.events.length, 0);

  h.failAudit(false);
  h.failWrites(true);
  const p = await assign(h, input({ roleId: 'privileged' }));
  assert.equal(p.code, 'PERSISTENCE_FAILED');
  assert.equal(h.requests.size, 0);
  assert.equal(h.events.length, 0);
});

test('missing dependency fails closed', async () => {
  const h = harness({ missing: 'authorization' });
  const r = await assign(h, input());
  assert.equal(r.code, 'DEPENDENCIES_UNAVAILABLE');
  assert.equal(h.assignments.size, 0);
});

test('all protected entry points acquire the mutex before decisive work', async () => {
  const h = harness();
  await assign(h, input());
  assert.equal(h.trace[0], 'mutex');
  assert.equal(h.trace.filter((x) => x === 'mutex').length, 1);

  const created = await assign(h, input({ targetUserId: 'person-b' }));
  h.clearTrace();
  await revoke(h, { actorId: 'operator-a', assignmentId: created.assignmentId, reason: 'Retire' });
  assert.equal(h.trace[0], 'mutex');
  assert.ok(h.trace.indexOf('role') < h.trace.lastIndexOf('assignment-revoke'));
  assert.equal(h.trace.filter((x) => x === 'mutex').length, 1);

  h.clearTrace();
  const requestId = await privilegedRequest(h, { targetUserId: 'person-c' });
  assert.equal(h.trace[0], 'mutex');
  assert.ok(h.trace.indexOf('role') < h.trace.indexOf('request-create'));

  h.clearTrace();
  await decide(h, { requestId, decision: 'reject', reason: 'Reject' }, 'operator-b');
  assert.equal(h.trace[0], 'mutex');
  assert.ok(h.trace.indexOf('role') < h.trace.indexOf('request-lock'));
  assert.ok(h.trace.indexOf('request-lock') < h.trace.indexOf('request-decision'));
  assert.ok(h.trace.indexOf('request-decision') < h.trace.indexOf('audit'));
});

test('revocation previews without locking, locks role, then revalidates assignment', async () => {
  const h = harness();
  const created = await assign(h, input());
  h.clearTrace();
  await revoke(h, { actorId: 'operator-a', assignmentId: created.assignmentId, reason: 'Retire' });
  const previews = h.trace.reduce((indices, value, index) => value === 'assignment-preview' ? [...indices, index] : indices, []);
  assert.equal(previews.length, 2);
  assert.ok(previews[0] < h.trace.indexOf('role'));
  assert.ok(h.trace.indexOf('role') < previews[1]);
  assert.ok(previews[1] < h.trace.indexOf('authorization'));
  assert.ok(h.trace.indexOf('authorization') < h.trace.indexOf('assignment-revoke'));
});

test('rejects changed request and assignment snapshots after their ordered revalidation reads', async () => {
  const requestHarness = harness({ requestChangesOnLock: true });
  const requestId = await privilegedRequest(requestHarness);
  requestHarness.clearTrace();
  const requestResult = await decide(requestHarness, {
    requestId, decision: 'reject', reason: 'Reject'
  }, 'operator-b');
  assert.equal(requestResult.code, 'REQUEST_CHANGED');
  assert.ok(requestHarness.trace.indexOf('role') < requestHarness.trace.indexOf('request-lock'));
  assert.equal(requestHarness.events.at(-1).action, 'role_assignment_requested');

  const assignmentHarness = harness({ assignmentChangesOnSecondRead: true });
  const created = await assign(assignmentHarness, input());
  assignmentHarness.clearTrace();
  const assignmentResult = await revoke(assignmentHarness, {
    actorId: 'operator-a', assignmentId: created.assignmentId, reason: 'Retire'
  });
  assert.equal(assignmentResult.code, 'ASSIGNMENT_CHANGED');
  assert.ok(assignmentHarness.trace.indexOf('role') < assignmentHarness.trace.lastIndexOf('assignment-preview'));
  assert.equal(assignmentHarness.trace.includes('assignment-revoke'), false);
});

test('mutex acquisition failure rolls back before any authorization or writes', async () => {
  const missing = harness({ mutexMissing: true });
  const result = await assign(missing, input());
  assert.equal(result.code, 'MUTEX_ROW_MISSING');
  assert.deepEqual(missing.trace, ['mutex']);
  assert.deepEqual(missing.transactionEvents, ['begin', 'rollback']);
  assert.equal(missing.assignments.size, 0);

  const failed = harness({ mutexFailure: new Error('mutex unavailable') });
  const failedResult = await assign(failed, input());
  assert.equal(failedResult.code, 'PERSISTENCE_FAILED');
  assert.deepEqual(failed.trace, ['mutex']);
  assert.deepEqual(failed.transactionEvents, ['begin', 'rollback']);
});

test('protected transaction facade expires when the service operation ends', async () => {
  const h = harness();
  await assign(h, input());
  assert.throws(() => h.protectedFacade.execute('SELECT 1'), (error) => error.code === 'MUTEX_LEASE_EXPIRED');
});

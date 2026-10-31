import { createAuthorizationRepository } from '../repositories/roles/authorization.repository.js';
import { createAuditRepository } from '../repositories/roles/audit.repository.js';
import { createAssignmentsRepository } from '../repositories/roles/assignments.repository.js';
import { createChangeRequestsRepository } from '../repositories/roles/change-requests.repository.js';
import { createRoleCatalogRepository } from '../repositories/roles/role-catalog.repository.js';
import { createScopeRefRepository } from '../repositories/roles/scope-ref.repository.js';
import { createAuthorizationMutexRepository } from '../repositories/roles/authorization-mutex.repository.js';
import { createRoleAssignmentServiceWithPool } from './role-assignment.factory.js';

const composedServices = new WeakSet();

export function isRoleAssignmentServiceFromProtectedComposition(service) {
  return service != null && typeof service === 'object' && composedServices.has(service);
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Role-assignment composition options must be an object.');
  }
  if (!options.pool || typeof options.pool.getConnection !== 'function') {
    throw new TypeError('A mysql2/promise pool is required.');
  }
  if (!options.clock || typeof options.clock.now !== 'function') {
    throw new TypeError('A clock with now() is required.');
  }
  if (!options.ids || typeof options.ids.next !== 'function') {
    throw new TypeError('An ID provider with next() is required.');
  }
  if (!Number.isSafeInteger(options.approvalWindowMs) || options.approvalWindowMs <= 0) {
    throw new TypeError('approvalWindowMs must be a positive safe integer.');
  }
}

/**
 * Builds, but does not activate, the role assignment service.
 * The application must explicitly consume this composition; no connection is
 * acquired until a service operation calls the injected transaction runner.
 */
export function createRoleAssignmentComposition(options = {}) {
  validateOptions(options);

  const mutex = createAuthorizationMutexRepository();
  const scopeRefs = createScopeRefRepository({ mutex });
  const roleCatalog = createRoleCatalogRepository({ mutex });
  const assignments = createAssignmentsRepository({ scopeRefs, mutex });
  const changeRequests = createChangeRequestsRepository({ scopeRefs, mutex });
  const audit = createAuditRepository({ mutex });
  const authorization = createAuthorizationRepository({ mutex });

  const service = createRoleAssignmentServiceWithPool(options.pool, {
    authorization,
    mutex,
    roleCatalog,
    assignments,
    changeRequests,
    audit,
    clock: options.clock,
    ids: options.ids,
    approvalWindowMs: options.approvalWindowMs
  });
  Object.freeze(service);
  composedServices.add(service);

  return Object.freeze({ service });
}

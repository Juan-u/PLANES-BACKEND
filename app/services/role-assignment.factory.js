import { createMysqlTransactionManager } from './mysql-transaction-manager.js';
import { createRoleAssignmentService } from './role-assignment.service.js';

/**
 * Composes the role-assignment service from an injected mysql2/promise pool and
 * externally supplied policies/repositories. The factory owns the transaction
 * runner so callers cannot silently replace it with a different implementation.
 */
export function createRoleAssignmentServiceWithPool(pool, dependencies = {}) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new TypeError('Role-assignment dependencies must be provided as an object.');
  }
  if (Object.hasOwn(dependencies, 'transactions')) {
    throw new TypeError('The transaction runner is created by this factory.');
  }

  const transactions = createMysqlTransactionManager(pool);
  return createRoleAssignmentService({ ...dependencies, transactions });
}
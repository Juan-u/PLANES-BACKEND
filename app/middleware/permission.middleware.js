import { createAuthorizationMutexRepository } from '../repositories/roles/authorization-mutex.repository.js';
import { createAuthorizationRepository } from '../repositories/roles/authorization.repository.js';
import { createMysqlTransactionManager } from '../services/mysql-transaction-manager.js';
import { getActivityAccess, hasActivityAccess, includesActivity } from '../services/activity-access.js';

const SUBJECT = /^[1-9]\d{0,9}$/;

/**
 * Creates a fail-closed permission gate. The persistent authorization mutex is
 * held until the protected response ends, so role/permission changes cannot
 * invalidate a decision while its controller is still processing the request.
 * Role-management writes use their own service and must not be wrapped by this
 * middleware (that would attempt to acquire the global mutex twice).
 */
export function createPermissionMiddleware({ pool, scopeResolver } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw new TypeError('A mysql2/promise pool is required for permission checks.');
  }
  if (scopeResolver != null && typeof scopeResolver !== 'function') {
    throw new TypeError('scopeResolver must be a function when provided.');
  }

  const transactions = createMysqlTransactionManager(pool);
  const mutex = createAuthorizationMutexRepository();
  const authorization = createAuthorizationRepository({ mutex });

  return function requirePermission(permissionCode, { activityAccess } = {}) {
    if (typeof permissionCode !== 'string' || !/^[A-Z]\d{2}\.[a-z_]+\.[a-z_]+$/.test(permissionCode)) {
      throw new TypeError('A registered module permission code is required.');
    }

    return async function permissionGate(req, res, next) {
      const subject = req?.usuario?.sub;
      if (typeof subject !== 'string' || !SUBJECT.test(subject)) {
        return res.status(401).json({ error: 'Autenticación requerida.' });
      }
      const actorId = Number(subject);
      if (!Number.isSafeInteger(actorId) || actorId < 1 || actorId > 2_147_483_647) {
        return res.status(401).json({ error: 'Autenticación requerida.' });
      }

      try {
        const allowed = await transactions.run((rawTx) => mutex.withLock(rawTx, async (tx) => {
          mutex.assertHeld(tx);
          if (activityAccess) {
            const access = await getActivityAccess(authorization, tx, actorId, permissionCode);
            if (!hasActivityAccess(access)) return false;
            if (access && typeof activityAccess === 'function') {
              const activity = await activityAccess(req, tx);
              if (!activity || !includesActivity(access, activity)) return false;
            }
            req.activityAccess = access;
          } else {
            const scopeRef = scopeResolver ? await scopeResolver(req, tx) : null;
            if (!await authorization.canAccess({ actorId, permissionCode, scopeRef }, tx)) return false;
          }

          // Keep the DB mutex for the complete controller lifetime. This is
          // intentionally conservative and serializes protected HTTP work.
          await new Promise((resolve, reject) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              res.off('finish', finish);
              res.off('close', finish);
              resolve();
            };
            res.once('finish', finish);
            res.once('close', finish);
            try {
              next();
            } catch (error) {
              if (!settled) {
                settled = true;
                res.off('finish', finish);
                res.off('close', finish);
                reject(error);
              }
            }
          });
          return true;
        }));

        if (!allowed && !res.headersSent) {
          return res.status(403).json({ error: 'No tienes permiso para realizar esta operación.' });
        }
      } catch {
        if (!res.headersSent) return res.status(503).json({ error: 'La autorización no está disponible temporalmente.' });
        return undefined;
      }
      return undefined;
    };
  };
}

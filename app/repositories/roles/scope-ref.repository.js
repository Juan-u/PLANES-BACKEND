import { createHash } from 'node:crypto';

const MAX_SIGNED_INT = 2_147_483_647;

export class ScopeRefResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScopeRefResolutionError';
    this.code = code;
  }
}
function fail(code, message) {
  throw new ScopeRefResolutionError(code, message);
}
function toDatabaseRoleId(roleId) {
  let value;
  if (typeof roleId === 'number') value = roleId;
  else if (typeof roleId === 'string' && /^\d+$/.test(roleId)) value = Number(roleId);
  else fail('INVALID_ROLE_ID', 'roleId must be a positive signed INT identifier.');
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SIGNED_INT) {
    fail('INVALID_ROLE_ID', 'roleId must be a positive signed INT identifier.');
  }
  return value;
}
function encodeScopeRef(scopeRef) {
  if (typeof scopeRef === 'number') {
    if (!Number.isSafeInteger(scopeRef) || scopeRef < 1) {
      fail('INVALID_SCOPE_REFERENCE', 'Numeric scopeRef must be a positive safe integer.');
    }
    return { kind: 'number', value: String(scopeRef) };
  }
  if (typeof scopeRef === 'string' && !/^\s*$/u.test(scopeRef)) {
    // Reject all-whitespace input without transforming the value.
    return { kind: 'string', value: scopeRef };
  }
  fail('INVALID_SCOPE_REFERENCE', 'scopeRef must be a positive safe integer or a non-empty string.');
}
function hashScopeRef(kind, value) {
  return createHash('sha256').update(kind + ':' + value, 'utf8').digest();
}
function isActive(value) {
  return value === 1 || value === '1' || value === true;
}
function readRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    fail('INVALID_PERSISTENCE_RESULT', 'The transaction returned an invalid mysql2 result.');
  }
  return result[0];
}

function resourceId(value) {
  const id = typeof value === 'number' ? value :
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_SIGNED_INT) {
    fail('INVALID_SCOPE_RESOURCE', 'Resource ID must be a positive signed INT.');
  }
  return id;
}

function resourceType(value) {
  if (value !== 'plan' && value !== 'activity') {
    fail('INVALID_SCOPE_RESOURCE', 'Resource type must be plan or activity.');
  }
  return value;
}

/** Resolves an opaque scopeRef; never creates records or opens a connection. The caller must hold the role lock first. */
export function createScopeRefRepository({ mutex } = {}) {
  return Object.freeze({
    async resolveForRole(scopeRef, roleId, tx) {
      if (!tx || typeof tx.execute !== 'function') {
        fail('TRANSACTION_REQUIRED', 'A transaction with execute() is required.');
      }
      if (!mutex || typeof mutex.assertHeld !== 'function') {
        fail('MUTEX_GUARD_REQUIRED', 'A mutex guard is required.');
      }
      mutex.assertHeld(tx);
      const roleDbId = toDatabaseRoleId(roleId);
      const { kind, value } = encodeScopeRef(scopeRef);
      const refHash = hashScopeRef(kind, value);
      const result = await tx.execute(
        `SELECT
           sr.id_scope_ref,
           sr.ref_kind,
           sr.ref_value,
           sr.activo,
           rsp.id_rol AS allowed_role_id
         FROM rol_scope_ref AS sr
         LEFT JOIN rol_scope_permitido AS rsp
           ON rsp.id_scope_ref = sr.id_scope_ref
          AND rsp.id_rol = ?
         WHERE sr.ref_kind = ?
           AND sr.ref_hash = ?
           AND BINARY sr.ref_value = BINARY ?
         LIMIT 2
         FOR UPDATE`,
        [roleDbId, kind, refHash, value]
      );
      const rows = readRows(result);
      if (rows.length === 0) fail('SCOPE_REFERENCE_NOT_FOUND', 'The scopeRef is not registered.');
      if (rows.length !== 1) {
        fail('SCOPE_REFERENCE_AMBIGUOUS', 'The scopeRef does not resolve to one unique record.');
      }
      const row = rows[0];
      if (row.ref_kind !== kind || row.ref_value !== value) {
        fail('SCOPE_REFERENCE_MISMATCH', 'The resolved scopeRef does not match its exact type and value.');
      }
      if (!isActive(row.activo)) fail('SCOPE_REFERENCE_INACTIVE', 'The scopeRef is inactive.');
      if (row.allowed_role_id === null || row.allowed_role_id === undefined) {
        fail('SCOPE_NOT_ALLOWED_FOR_ROLE', 'The scopeRef is not permitted for this role.');
      }
      const idScopeRef = Number(row.id_scope_ref);
      if (!Number.isSafeInteger(idScopeRef) || idScopeRef < 1 || idScopeRef > MAX_SIGNED_INT) {
        fail('INVALID_PERSISTENCE_RESULT', 'id_scope_ref is not a valid signed INT.');
      }
      return Object.freeze({ idScopeRef, scopeRef, kind, value });
    },
    async resolveResourceForRole(resource, roleId, tx) {
      if (!tx || typeof tx.execute !== 'function') {
        fail('TRANSACTION_REQUIRED', 'A transaction with execute() is required.');
      }
      if (!mutex || typeof mutex.assertHeld !== 'function') {
        fail('MUTEX_GUARD_REQUIRED', 'A mutex guard is required.');
      }
      mutex.assertHeld(tx);
      const type = resourceType(resource?.type);
      const id = resourceId(resource?.id);
      const roleDbId = toDatabaseRoleId(roleId);
      const result = await tx.execute(
        `SELECT sr.id_scope_ref, sr.ref_value, sr.activo, rsp.id_rol AS allowed_role_id,
                scoped_resource.tipo_recurso, scoped_resource.id_plan, scoped_resource.id_actividad,
                plan.nombre AS plan_name,
                CASE WHEN scoped_resource.tipo_recurso = 'plan' THEN plan.nombre
                     ELSE COALESCE(NULLIF(institutional_activity.nombre, ''),
                                   NULLIF(activity.descripcion, ''),
                                   CONCAT('Actividad ', activity.id_actividad))
                END AS resource_name
           FROM rol_scope_recurso AS scoped_resource
           JOIN rol_scope_ref AS sr ON sr.id_scope_ref = scoped_resource.id_scope_ref
           LEFT JOIN rol_scope_permitido AS rsp
             ON rsp.id_scope_ref = sr.id_scope_ref AND rsp.id_rol = ?
           JOIN plan_accion AS plan ON plan.id_plan = scoped_resource.id_plan
           LEFT JOIN actividad AS activity
             ON activity.id_actividad = scoped_resource.id_actividad
            AND activity.id_plan = scoped_resource.id_plan
           LEFT JOIN actividad_institucional AS institutional_activity
             ON institutional_activity.id_actividad = activity.id_actividad
            AND institutional_activity.id_plan = activity.id_plan
          WHERE scoped_resource.tipo_recurso = ?
            AND ((scoped_resource.tipo_recurso = 'plan'
                  AND scoped_resource.id_plan = ? AND scoped_resource.id_actividad IS NULL)
              OR (scoped_resource.tipo_recurso = 'activity'
                  AND scoped_resource.id_actividad = ?))
          LIMIT 2 FOR UPDATE`,
        [roleDbId, type, id, id]
      );
      const rows = readRows(result);
      if (rows.length === 0) fail('SCOPE_RESOURCE_NOT_FOUND', 'The typed resource is not registered.');
      if (rows.length !== 1) fail('SCOPE_RESOURCE_AMBIGUOUS', 'The typed resource does not resolve uniquely.');
      const row = rows[0];
      const actualId = type === 'plan' ? Number(row.id_plan) : Number(row.id_actividad);
      if (row.tipo_recurso !== type || actualId !== id) {
        fail('SCOPE_RESOURCE_MISMATCH', 'The resolved resource does not match the requested type and ID.');
      }
      if (!isActive(row.activo)) fail('SCOPE_REFERENCE_INACTIVE', 'The resource scope is inactive.');
      if (row.allowed_role_id == null) {
        fail('SCOPE_NOT_ALLOWED_FOR_ROLE', 'The resource scope is not permitted for this role.');
      }
      if (type === 'activity' && row.id_actividad == null) {
        fail('SCOPE_RESOURCE_NOT_FOUND', 'The activity does not belong to the requested plan.');
      }
      return Object.freeze({
        idScopeRef: Number(row.id_scope_ref),
        scopeRef: row.ref_value,
        resourceType: type,
        resourceId: id,
        resourceName: row.resource_name,
        planId: Number(row.id_plan),
        planName: row.plan_name
      });
    },
    async listResourcesForRole(roleId, tx) {
      if (!tx || typeof tx.execute !== 'function') {
        fail('TRANSACTION_REQUIRED', 'A transaction with execute() is required.');
      }
      if (!mutex || typeof mutex.assertHeld !== 'function') {
        fail('MUTEX_GUARD_REQUIRED', 'A mutex guard is required.');
      }
      mutex.assertHeld(tx);
      const databaseRoleId = toDatabaseRoleId(roleId);
      return readRows(await tx.execute(
        `SELECT sr.ref_value AS scope_ref, scoped_resource.tipo_recurso,
                scoped_resource.id_plan, scoped_resource.id_actividad,
                plan.nombre AS plan_name,
                CASE WHEN scoped_resource.tipo_recurso = 'plan' THEN plan.nombre
                     ELSE COALESCE(NULLIF(institutional_activity.nombre, ''),
                                   NULLIF(activity.descripcion, ''),
                                   CONCAT('Actividad ', activity.id_actividad))
                END AS resource_name
           FROM rol_scope_recurso AS scoped_resource
           JOIN rol_scope_ref AS sr ON sr.id_scope_ref = scoped_resource.id_scope_ref
           JOIN rol_scope_permitido AS permitted
             ON permitted.id_scope_ref = sr.id_scope_ref AND permitted.id_rol = ?
           JOIN plan_accion AS plan ON plan.id_plan = scoped_resource.id_plan
           LEFT JOIN actividad AS activity
             ON activity.id_actividad = scoped_resource.id_actividad
            AND activity.id_plan = scoped_resource.id_plan
           LEFT JOIN actividad_institucional AS institutional_activity
             ON institutional_activity.id_actividad = activity.id_actividad
            AND institutional_activity.id_plan = activity.id_plan
          WHERE sr.activo = 1
          ORDER BY scoped_resource.tipo_recurso, scoped_resource.id_plan,
                   scoped_resource.id_actividad`,
        [databaseRoleId]
      )).map((row) => ({
        scopeRef: row.scope_ref,
        resourceType: row.tipo_recurso,
        resourceId: Number(row.tipo_recurso === 'plan' ? row.id_plan : row.id_actividad),
        resourceName: row.resource_name,
        planId: Number(row.id_plan),
        planName: row.plan_name
      }));
    }
  });
}

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
    }
  });
}

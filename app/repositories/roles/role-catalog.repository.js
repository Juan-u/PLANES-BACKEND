const MAX_SIGNED_INT = 2_147_483_647;

export class RoleCatalogRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoleCatalogRepositoryError';
    this.code = code;
  }
}
function fail(code, message) {
  throw new RoleCatalogRepositoryError(code, message);
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
function readRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    fail('INVALID_PERSISTENCE_RESULT', 'The transaction returned an invalid mysql2 result.');
  }
  return result[0];
}
function nullableBoolean(value) {
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  return null;
}

/**
 * Read-only catalog adapter. A missing configuration stays explicitly absent
 * so the service rejects the role classification instead of receiving defaults.
 */
export function createRoleCatalogRepository({ mutex } = {}) {
  return Object.freeze({
    async getById(roleId, tx) {
      if (!tx || typeof tx.execute !== 'function') {
        fail('TRANSACTION_REQUIRED', 'A transaction with execute() is required.');
      }
      if (!mutex || typeof mutex.assertHeld !== 'function') {
        fail('MUTEX_GUARD_REQUIRED', 'A mutex guard is required.');
      }
      mutex.assertHeld(tx);
      const databaseRoleId = toDatabaseRoleId(roleId);
      const result = await tx.execute(
        `SELECT
           r.id_rol,
           rc.clasificacion_privilegio,
           rc.permite_vigencia_indefinida,
           rc.requiere_ambito
         FROM rol AS r
         LEFT JOIN rol_configuracion AS rc
           ON rc.id_rol = r.id_rol
         WHERE r.id_rol = ?
         LIMIT 1
         FOR UPDATE`,
        [databaseRoleId]
      );
      const rows = readRows(result);
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        fail('INVALID_PERSISTENCE_RESULT', 'The role lookup returned multiple rows.');
      }

      const row = rows[0];
      if (Number(row.id_rol) !== databaseRoleId) {
        fail('INVALID_PERSISTENCE_RESULT', 'The returned role ID does not match the requested role.');
      }

      return Object.freeze({
        // Preserve the caller's representation because the service compares role.id strictly to roleId.
        id: roleId,
        classification: row.clasificacion_privilegio ?? null,
        allowOpenEndedAssignment: nullableBoolean(row.permite_vigencia_indefinida),
        requiresScope: nullableBoolean(row.requiere_ambito)
      });
    }
  });
}

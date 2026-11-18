const REQUIRED_COLUMNS = Object.freeze({
  rol: ['id_rol'],
  usuario: ['id_usuario'],
  permiso: ['id_permiso', 'codigo', 'activo'],
  rol_configuracion: ['id_rol', 'clasificacion_privilegio', 'permite_vigencia_indefinida', 'requiere_ambito'],
  rol_permiso: ['id_rol', 'id_permiso', 'activo'],
  rol_scope_ref: ['id_scope_ref', 'ref_kind', 'ref_value', 'ref_hash', 'activo', 'creado_en', 'creado_por'],
  rol_scope_permitido: ['id_rol', 'id_scope_ref'],
  rol_scope_recurso: ['id_scope_ref', 'tipo_recurso', 'id_plan', 'id_actividad'],
  rol_scope_authority_request: [
    'id_solicitud', 'id_usuario_objetivo', 'id_plan', 'referencia_institucional', 'motivo',
    'vigente_desde', 'vigente_hasta', 'id_usuario_solicitante', 'estado', 'id_usuario_decisor',
    'referencia_decision', 'motivo_decision', 'decidida_en', 'id_scope_ref', 'id_asignacion',
    'solicitada_en'
  ],
  plan_accion: ['id_plan', 'nombre'],
  actividad: ['id_actividad', 'id_plan'],
  rol_autorizacion_mutex: ['mutex_id'],
  rol_asignacion: [
    'id_asignacion', 'id_usuario', 'id_rol', 'id_scope_ref', 'vigente_desde', 'vigente_hasta',
    'estado', 'creado_por', 'creado_en', 'motivo', 'revocado_por', 'revocado_en', 'motivo_revocacion'
  ],
  rol_solicitud: [
    'id_solicitud', 'tipo_accion', 'id_usuario_solicitante', 'id_usuario_objetivo', 'id_rol',
    'id_scope_ref', 'id_asignacion_objetivo', 'id_asignacion_resultado', 'estado', 'vence_en'
  ],
  rol_decision: ['id_solicitud', 'id_usuario_decisor', 'resultado', 'tipo_actor'],
  rol_auditoria: ['id_evento', 'tipo_actor', 'id_usuario_actor', 'accion', 'ocurrida_en', 'motivo', 'id_scope_ref']
});

const REQUIRED_SCOPE_RELATIONSHIPS = Object.freeze([
  ['fk_scope_recurso_scope', 'id_scope_ref', 'rol_scope_ref', 'id_scope_ref'],
  ['fk_scope_recurso_plan', 'id_plan', 'plan_accion', 'id_plan'],
  ['fk_scope_recurso_actividad_plan', 'id_actividad', 'actividad', 'id_actividad'],
  ['fk_scope_recurso_actividad_plan', 'id_plan', 'actividad', 'id_plan']
]);
const REQUIRED_INITIAL_AUTHORITY_RELATIONSHIPS = Object.freeze([
  ['fk_scope_authority_target', 'id_usuario_objetivo', 'usuario', 'id_usuario'],
  ['fk_scope_authority_plan', 'id_plan', 'plan_accion', 'id_plan'],
  ['fk_scope_authority_requester', 'id_usuario_solicitante', 'usuario', 'id_usuario'],
  ['fk_scope_authority_decider', 'id_usuario_decisor', 'usuario', 'id_usuario'],
  ['fk_scope_authority_scope', 'id_scope_ref', 'rol_scope_ref', 'id_scope_ref'],
  ['fk_scope_authority_assignment', 'id_asignacion', 'rol_asignacion', 'id_asignacion']
]);

function fail() {
  throw new Error('ROLE_PERMISSION_SCHEMA_NOT_READY');
}

export async function verifyRolePermissionSchema(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A mysql2/promise pool with query() is required.');
  }

  const tableNames = Object.keys(REQUIRED_COLUMNS);
  const [columns] = await pool.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tableNames.map(() => '?').join(', ')})`,
    tableNames
  );
  if (!Array.isArray(columns)) fail();
  const foundColumns = new Set(columns.map((column) => `${column.tableName}.${column.columnName}`));
  if (Object.entries(REQUIRED_COLUMNS).some(([table, names]) =>
    names.some((name) => !foundColumns.has(`${table}.${name}`)))) fail();

  const [relationships] = await pool.query(
    `SELECT CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
            REFERENCED_TABLE_NAME AS referencedTable,
            REFERENCED_COLUMN_NAME AS referencedColumn
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'rol_scope_recurso'
        AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  if (!Array.isArray(relationships)) fail();
  const foundRelationships = new Set(relationships.map((row) =>
    `${row.constraintName}.${row.columnName}.${row.referencedTable}.${row.referencedColumn}`));
  if (REQUIRED_SCOPE_RELATIONSHIPS.some(([constraint, column, table, referencedColumn]) =>
    !foundRelationships.has(`${constraint}.${column}.${table}.${referencedColumn}`))) fail();

  const [authorityRelationships] = await pool.query(
    `SELECT CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
            REFERENCED_TABLE_NAME AS referencedTable,
            REFERENCED_COLUMN_NAME AS referencedColumn
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'rol_scope_authority_request'
        AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  if (!Array.isArray(authorityRelationships)) fail();
  const foundAuthorityRelationships = new Set(authorityRelationships.map((row) =>
    `${row.constraintName}.${row.columnName}.${row.referencedTable}.${row.referencedColumn}`));
  if (REQUIRED_INITIAL_AUTHORITY_RELATIONSHIPS.some(([constraint, column, table, referencedColumn]) =>
    !foundAuthorityRelationships.has(`${constraint}.${column}.${table}.${referencedColumn}`))) fail();

  const [authorityRoles] = await pool.query(
    `SELECT role.id_rol
       FROM rol AS role
       JOIN rol_configuracion AS config ON config.id_rol = role.id_rol
      WHERE BINARY role.nombre_rol = BINARY 'scope_authority_manager'
        AND config.clasificacion_privilegio = 'ordinary'
        AND config.permite_vigencia_indefinida = 0
        AND config.requiere_ambito = 1`
  );
  const [authorityPermissions] = await pool.query(
    `SELECT id_permiso FROM permiso
      WHERE BINARY codigo = BINARY 'M01.roles.manage_scope' AND activo = 1`
  );
  if (!Array.isArray(authorityRoles) || authorityRoles.length !== 1 ||
      !Array.isArray(authorityPermissions) || authorityPermissions.length !== 1) fail();

  const [mutexRows] = await pool.query(
    'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1'
  );
  if (!Array.isArray(mutexRows) || mutexRows.length !== 1 || Number(mutexRows[0].mutex_id) !== 1) fail();
}

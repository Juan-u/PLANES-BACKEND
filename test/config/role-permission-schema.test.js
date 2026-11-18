import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyRolePermissionSchema } from '../../app/config/role-permission-schema.js';

const columnsByTable = {
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
};
const scopeRelationships = [
  ['fk_scope_recurso_scope', 'id_scope_ref', 'rol_scope_ref', 'id_scope_ref'],
  ['fk_scope_recurso_plan', 'id_plan', 'plan_accion', 'id_plan'],
  ['fk_scope_recurso_actividad_plan', 'id_actividad', 'actividad', 'id_actividad'],
  ['fk_scope_recurso_actividad_plan', 'id_plan', 'actividad', 'id_plan']
].map(([constraintName, columnName, referencedTable, referencedColumn]) => ({
  constraintName, columnName, referencedTable, referencedColumn
}));
const authorityRelationships = [
  ['fk_scope_authority_target', 'id_usuario_objetivo', 'usuario', 'id_usuario'],
  ['fk_scope_authority_plan', 'id_plan', 'plan_accion', 'id_plan'],
  ['fk_scope_authority_requester', 'id_usuario_solicitante', 'usuario', 'id_usuario'],
  ['fk_scope_authority_decider', 'id_usuario_decisor', 'usuario', 'id_usuario'],
  ['fk_scope_authority_scope', 'id_scope_ref', 'rol_scope_ref', 'id_scope_ref'],
  ['fk_scope_authority_assignment', 'id_asignacion', 'rol_asignacion', 'id_asignacion']
].map(([constraintName, columnName, referencedTable, referencedColumn]) => ({
  constraintName, columnName, referencedTable, referencedColumn
}));

function makePool({
  columns = columnsByTable, relationships = scopeRelationships, authorityLinks = authorityRelationships,
  authorityRoles = [{id_rol: 9}], authorityPermissions = [{id_permiso: 68}], mutex = [{ mutex_id: 1 }]
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('information_schema.COLUMNS')) {
        return [Object.entries(columns).flatMap(([tableName, names]) =>
          names.map((columnName) => ({ tableName, columnName }))), []];
      }
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) {
        return [sql.includes("'rol_scope_authority_request'") ? authorityLinks : relationships, []];
      }
      if (sql.includes('FROM rol_autorizacion_mutex')) return [mutex, []];
      if (sql.includes("BINARY role.nombre_rol")) return [authorityRoles, []];
      if (sql.includes("BINARY codigo")) return [authorityPermissions, []];
      throw new Error('Unexpected non-read-only schema check query.');
    }
  };
}

test('production schema gate verifies required typed-resource columns, foreign keys and mutex read-only', async () => {
  const pool = makePool();
  await verifyRolePermissionSchema(pool);
  assert.equal(pool.calls.length, 6);
  assert.ok(pool.calls.every(({ sql }) => /^\s*SELECT\b/i.test(sql)));
});

test('production schema gate rejects missing migration columns, relationships or mutex singleton', async () => {
  const missingColumn = makePool({ columns: { ...columnsByTable, rol_scope_recurso: ['id_scope_ref'] } });
  await assert.rejects(verifyRolePermissionSchema(missingColumn), /ROLE_PERMISSION_SCHEMA_NOT_READY/);

  const missingRelationship = makePool({ relationships: scopeRelationships.slice(1) });
  await assert.rejects(verifyRolePermissionSchema(missingRelationship), /ROLE_PERMISSION_SCHEMA_NOT_READY/);

  const missingAuthorityRelationship = makePool({ authorityLinks: authorityRelationships.slice(1) });
  await assert.rejects(verifyRolePermissionSchema(missingAuthorityRelationship), /ROLE_PERMISSION_SCHEMA_NOT_READY/);

  const missingAuthorityRole = makePool({ authorityRoles: [] });
  await assert.rejects(verifyRolePermissionSchema(missingAuthorityRole), /ROLE_PERMISSION_SCHEMA_NOT_READY/);

  const missingAuthorityPermission = makePool({ authorityPermissions: [] });
  await assert.rejects(verifyRolePermissionSchema(missingAuthorityPermission), /ROLE_PERMISSION_SCHEMA_NOT_READY/);

  const missingMutex = makePool({ mutex: [] });
  await assert.rejects(verifyRolePermissionSchema(missingMutex), /ROLE_PERMISSION_SCHEMA_NOT_READY/);
});

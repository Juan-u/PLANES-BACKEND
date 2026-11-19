const MAX_INT = 2147483647;
const OPERATIONS = new Set(['assign-role', 'revoke-role', 'approve-role-change']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class AuthorizationRepositoryError extends Error {
  constructor(code, message) { super(message); this.name = 'AuthorizationRepositoryError'; this.code = code; }
}
function fail(code, message) { throw new AuthorizationRepositoryError(code, message); }
function requireTx(tx, mutex) {
  if (!tx || typeof tx.execute !== 'function') fail('TRANSACTION_REQUIRED', 'A transaction with execute() is required.');
  if (!mutex || typeof mutex.assertHeld !== 'function') fail('MUTEX_GUARD_REQUIRED', 'A mutex guard is required.');
  mutex.assertHeld(tx);
}
function readRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) fail('INVALID_PERSISTENCE_RESULT', 'Invalid mysql2 result.');
  return result[0];
}
function signedInt(value) {
  const number = typeof value === 'number' ? value :
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_INT) return null;
  return number;
}
function uuid(value) { return typeof value === 'string' && UUID_V4.test(value); }
function encodeScope(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return { kind: 'number', value: String(value) };
  }
  if (typeof value === 'string' && value.trim() !== '') return { kind: 'string', value };
  return false;
}
function authorizationResult(result) {
  const found = readRows(result);
  if (found.length !== 1 || !Object.hasOwn(found[0], 'authorized')) return false;
  const value = found[0].authorized;
  return value === 1 || value === '1' || value === true;
}

export function createAuthorizationRepository({ mutex } = {}) {
  async function access(context, tx, listResources = false) {
    requireTx(tx, mutex);
    if (!context || typeof context !== 'object') return listResources ? [] : false;
    const actorId = signedInt(context.actorId);
    const permissionCode = context.permissionCode;
    if (actorId == null || typeof permissionCode !== 'string' ||
        !/^[A-Z]\d{2}\.[a-z_]+\.[a-z_]+$/.test(permissionCode)) return listResources ? [] : false;
    const scope = encodeScope(context.scopeRef ?? null);
    if (scope === false) return listResources ? [] : false;
    let scopePredicate;
    const params = [permissionCode, actorId];
    if (listResources) {
      scopePredicate = `AND ((resource_scope.tipo_recurso = 'plan' AND resource_scope.id_actividad IS NULL)
          OR (resource_scope.tipo_recurso = 'activity' AND resource_scope.id_actividad IS NOT NULL))`;
    } else if (scope == null) {
      scopePredicate = 'AND assignment.id_scope_ref IS NULL AND config.requiere_ambito = 0';
    } else {
      scopePredicate = `AND EXISTS (
        SELECT 1
          FROM rol_scope_ref AS requested_scope
          JOIN rol_scope_permitido AS permitted_scope
            ON permitted_scope.id_scope_ref = requested_scope.id_scope_ref
           AND permitted_scope.id_rol = assignment.id_rol
         WHERE requested_scope.ref_kind = ?
           AND BINARY requested_scope.ref_value = BINARY ?
           AND requested_scope.activo = 1
           AND requested_scope.id_scope_ref = assignment.id_scope_ref
      )`;
      params.push(scope.kind, scope.value);
    }
    const resourceJoin = listResources ? `
        JOIN rol_scope_recurso AS resource_scope ON resource_scope.id_scope_ref = assignment.id_scope_ref
        JOIN rol_scope_ref AS active_scope ON active_scope.id_scope_ref = resource_scope.id_scope_ref
          AND active_scope.activo = 1
        JOIN rol_scope_permitido AS allowed_scope ON allowed_scope.id_scope_ref = resource_scope.id_scope_ref
          AND allowed_scope.id_rol = assignment.id_rol` : '';
    const query = `${listResources
      ? 'SELECT DISTINCT resource_scope.id_plan, resource_scope.id_actividad'
      : 'SELECT EXISTS (SELECT 1'}
        FROM rol_asignacion AS assignment
        JOIN rol_configuracion AS config ON config.id_rol = assignment.id_rol
        ${resourceJoin}
        JOIN rol_permiso AS role_permission ON role_permission.id_rol = assignment.id_rol
         AND role_permission.activo = 1
        JOIN permiso AS permission
          ON permission.id_permiso = role_permission.id_permiso
         AND BINARY permission.codigo = BINARY ?
         AND permission.activo = 1
       WHERE assignment.id_usuario = ?
         AND assignment.estado IN ('active', 'scheduled')
         AND assignment.vigente_desde <= UTC_TIMESTAMP(3)
         AND (assignment.vigente_hasta IS NULL OR assignment.vigente_hasta > UTC_TIMESTAMP(3))
         AND config.clasificacion_privilegio IN ('ordinary', 'privileged')
         AND config.requiere_ambito IN (0, 1)
         AND (config.requiere_ambito = 0 OR assignment.id_scope_ref IS NOT NULL)
         AND (
           config.clasificacion_privilegio = 'ordinary'
           OR EXISTS (
             SELECT 1
               FROM rol_solicitud AS approved_request
               JOIN rol_decision AS approval_decision
                 ON approval_decision.id_solicitud = approved_request.id_solicitud
              WHERE approved_request.id_asignacion_resultado = assignment.id_asignacion
                AND approved_request.tipo_accion = 'assign'
                AND approved_request.estado = 'approved'
                AND approved_request.id_usuario_solicitante = assignment.creado_por
                AND approval_decision.resultado = 'approved'
                AND approval_decision.tipo_actor = 'user'
                AND approval_decision.id_usuario_decisor IS NOT NULL
                AND approval_decision.id_usuario_decisor <> approved_request.id_usuario_solicitante
           )
         )
         ${scopePredicate}
    ${listResources ? '' : ') AS authorized'}`;
    const result = await tx.execute(query, params);
    return listResources ? readRows(result) : authorizationResult(result);
  }

  return Object.freeze({
    async getEffectivePermissionCodes(context, tx) {
      requireTx(tx, mutex);
      const actorId = signedInt(context?.actorId);
      if (actorId == null) return [];
      const found = readRows(await tx.execute(`SELECT DISTINCT permission.codigo
        FROM rol_asignacion AS assignment
        JOIN rol_configuracion AS config ON config.id_rol = assignment.id_rol
        JOIN rol_permiso AS role_permission ON role_permission.id_rol = assignment.id_rol AND role_permission.activo = 1
        JOIN permiso AS permission ON permission.id_permiso = role_permission.id_permiso AND permission.activo = 1
       WHERE assignment.id_usuario = ?
         AND assignment.estado IN ('active', 'scheduled')
         AND assignment.vigente_desde <= UTC_TIMESTAMP(3)
         AND (assignment.vigente_hasta IS NULL OR assignment.vigente_hasta > UTC_TIMESTAMP(3))
         AND config.clasificacion_privilegio IN ('ordinary', 'privileged')
         AND config.requiere_ambito IN (0, 1)
         AND ((assignment.id_scope_ref IS NULL AND config.requiere_ambito = 0)
           OR EXISTS (SELECT 1 FROM rol_scope_ref AS scope_ref
             JOIN rol_scope_permitido AS permitted_scope
               ON permitted_scope.id_scope_ref = scope_ref.id_scope_ref
              AND permitted_scope.id_rol = assignment.id_rol
            WHERE scope_ref.id_scope_ref = assignment.id_scope_ref AND scope_ref.activo = 1))
         AND (config.clasificacion_privilegio <> 'privileged' OR EXISTS (
           SELECT 1 FROM rol_solicitud AS approved_request
           JOIN rol_decision AS approval ON approval.id_solicitud = approved_request.id_solicitud
          WHERE approved_request.id_asignacion_resultado = assignment.id_asignacion
            AND approved_request.tipo_accion = 'assign' AND approved_request.estado = 'approved'
            AND approved_request.id_usuario_solicitante = assignment.creado_por
            AND approved_request.id_usuario_objetivo = assignment.id_usuario
            AND approved_request.id_rol = assignment.id_rol
            AND approved_request.id_scope_ref <=> assignment.id_scope_ref
            AND approval.resultado = 'approved' AND approval.tipo_actor = 'user'
            AND approval.id_usuario_decisor IS NOT NULL
            AND approval.id_usuario_decisor <> approved_request.id_usuario_solicitante))
       ORDER BY permission.codigo`, [actorId]));
      return found.map((row) => row.codigo).filter((code) => typeof code === 'string');
    },
    canAccess(context, tx) {
      return access(context, tx);
    },
    listActivityScopes(context, tx) {
      return access(context, tx, true);
    },
    async canManageRole(context, tx) {
      requireTx(tx, mutex);
      if (!context || typeof context !== 'object') return false;
      const actorId = signedInt(context.actorId);
      const targetUserId = signedInt(context.targetUserId);
      const targetRoleId = signedInt(context.roleId);
      const operation = context.operation;
      if (actorId == null || targetUserId == null || targetRoleId == null || !OPERATIONS.has(operation)) return false;

      const scope = encodeScope(context.scopeRef ?? null);
      if (scope === false) return false;
      const assignmentId = context.assignmentId == null ? null : context.assignmentId;
      const requestId = context.requestId == null ? null : context.requestId;
      if (assignmentId != null && !uuid(assignmentId)) return false;
      if (requestId != null && !uuid(requestId)) return false;
      if (operation === 'assign-role' && (assignmentId != null || requestId != null)) return false;
      if (operation === 'revoke-role' && (assignmentId == null || requestId != null)) return false;
      if (operation === 'approve-role-change' && requestId == null) return false;

      const params = [operation, targetRoleId, actorId, operation];
      let scopePredicate;
      if (scope == null) {
        scopePredicate = `AND manager_assignment.id_scope_ref IS NULL
          AND manager_config.requiere_ambito = 0
          AND target_config.requiere_ambito = 0`;
      } else {
        scopePredicate = `AND EXISTS (
          SELECT 1
            FROM rol_scope_ref AS requested_scope
            JOIN rol_scope_permitido AS target_scope
              ON target_scope.id_scope_ref = requested_scope.id_scope_ref
             AND target_scope.id_rol = target_config.id_rol
           WHERE requested_scope.ref_kind = ?
             AND BINARY requested_scope.ref_value = BINARY ?
             AND requested_scope.activo = 1
             AND (
               requested_scope.id_scope_ref = manager_assignment.id_scope_ref
               OR (
                 BINARY permission.codigo = BINARY 'M01.roles.manage'
                 AND manager_assignment.id_scope_ref IS NULL
                 AND manager_config.requiere_ambito = 0
                 AND EXISTS (
                   SELECT 1 FROM rol_scope_recurso AS typed_resource
                    WHERE typed_resource.id_scope_ref = requested_scope.id_scope_ref
                 )
               )
             )
        )`;
        params.push(scope.kind, scope.value);
      }
      let assignmentPredicate = '';
      if (assignmentId != null) {
        assignmentPredicate = `AND EXISTS (
          SELECT 1
            FROM rol_asignacion AS target_assignment
           WHERE target_assignment.id_asignacion = ?
             AND target_assignment.id_usuario = ?
             AND target_assignment.id_rol = ?
             AND target_assignment.id_scope_ref <=> manager_assignment.id_scope_ref
             AND target_assignment.estado IN ('active', 'scheduled')
             AND (target_assignment.vigente_hasta IS NULL OR target_assignment.vigente_hasta > UTC_TIMESTAMP(3))
        )`;
        params.push(assignmentId, targetUserId, targetRoleId);
      }
      let approvalPredicate = '';
      if (operation === 'approve-role-change') {
        approvalPredicate = assignmentId == null
          ? `AND EXISTS (
              SELECT 1
                FROM rol_solicitud AS approval_request
               WHERE approval_request.id_solicitud = ?
                 AND approval_request.tipo_accion = 'assign'
                 AND approval_request.estado = 'pending_approval'
                 AND approval_request.vence_en > UTC_TIMESTAMP(3)
                 AND approval_request.id_usuario_solicitante <> manager_assignment.id_usuario
                 AND approval_request.id_usuario_objetivo = ?
                 AND approval_request.id_rol = ?
                 AND approval_request.id_scope_ref <=> manager_assignment.id_scope_ref
            )`
          : `AND EXISTS (
              SELECT 1
                FROM rol_solicitud AS approval_request
               WHERE approval_request.id_solicitud = ?
                 AND approval_request.tipo_accion = 'revoke'
                 AND approval_request.estado = 'pending_approval'
                 AND approval_request.vence_en > UTC_TIMESTAMP(3)
                 AND approval_request.id_usuario_solicitante <> manager_assignment.id_usuario
                 AND approval_request.id_asignacion_objetivo = ?
            )`;
        params.push(requestId);
        if (assignmentId == null) params.push(targetUserId, targetRoleId);
        else params.push(assignmentId);
      }

      const query = `SELECT EXISTS (
        SELECT 1
          FROM rol_asignacion AS manager_assignment
          JOIN rol_configuracion AS manager_config
            ON manager_config.id_rol = manager_assignment.id_rol
          JOIN rol_permiso AS role_permission
            ON role_permission.id_rol = manager_assignment.id_rol
           AND role_permission.activo = 1
          JOIN permiso AS permission
            ON permission.id_permiso = role_permission.id_permiso
           AND (BINARY permission.codigo = BINARY ?
             OR BINARY permission.codigo = BINARY 'M01.roles.manage')
           AND permission.activo = 1
          JOIN rol_configuracion AS target_config
            ON target_config.id_rol = ?
          JOIN rol AS target_role
            ON target_role.id_rol = target_config.id_rol
         WHERE manager_assignment.id_usuario = ?
           AND manager_assignment.estado IN ('active', 'scheduled')
           AND manager_assignment.vigente_desde <= UTC_TIMESTAMP(3)
           AND (manager_assignment.vigente_hasta IS NULL OR manager_assignment.vigente_hasta > UTC_TIMESTAMP(3))
           AND manager_config.clasificacion_privilegio IN ('ordinary', 'privileged')
           AND manager_config.requiere_ambito IN (0, 1)
           AND target_config.clasificacion_privilegio IN ('ordinary', 'privileged')
           AND target_config.requiere_ambito IN (0, 1)
           AND (
             BINARY permission.codigo = BINARY ?
             OR (
               BINARY permission.codigo = BINARY 'M01.roles.manage'
               AND target_config.clasificacion_privilegio = 'ordinary'
               AND BINARY target_role.nombre_rol <> BINARY 'scope_authority_manager'
             )
           )
           AND (manager_config.requiere_ambito = 0 OR manager_assignment.id_scope_ref IS NOT NULL)
           AND (
             manager_config.clasificacion_privilegio = 'ordinary'
             OR EXISTS (
               SELECT 1
                 FROM rol_solicitud AS approved_request
                 JOIN rol_decision AS approval_decision
                   ON approval_decision.id_solicitud = approved_request.id_solicitud
                WHERE approved_request.id_asignacion_resultado = manager_assignment.id_asignacion
                  AND approved_request.tipo_accion = 'assign'
                  AND approved_request.estado = 'approved'
                  AND approved_request.id_usuario_solicitante = manager_assignment.creado_por
                  AND approval_decision.resultado = 'approved'
                  AND approval_decision.tipo_actor = 'user'
                  AND approval_decision.id_usuario_decisor IS NOT NULL
                  AND approval_decision.id_usuario_decisor <> approved_request.id_usuario_solicitante
             )
           )
           ${scopePredicate}
           ${assignmentPredicate}
           ${approvalPredicate}
      ) AS authorized`;
      const queryText = query
        .replace('${scopePredicate}', scopePredicate)
        .replace('${assignmentPredicate}', assignmentPredicate)
        .replace('${approvalPredicate}', approvalPredicate);
      return authorizationResult(await tx.execute(queryText, params));
    }
  });
}

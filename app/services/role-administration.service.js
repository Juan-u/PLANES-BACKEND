import { createAuthorizationRepository } from '../repositories/roles/authorization.repository.js';
import { createAuthorizationMutexRepository } from '../repositories/roles/authorization-mutex.repository.js';
import { createAuditRepository } from '../repositories/roles/audit.repository.js';
import { createMysqlTransactionManager } from './mysql-transaction-manager.js';
import { ROLE_PERMISSION_CATALOG } from '../config/role-permission-matrix.js';

const MAX_INT = 2_147_483_647;
const ROLE_OPERATIONS = ['assign-role', 'revoke-role', 'approve-role-change'];
const SCOPE_AUTHORITY_ROLE = 'scope_authority_manager';
const SCOPE_AUTHORITY_PERMISSION = 'M01.roles.manage_scope';
const SCOPE_AUTHORITY_PERMISSIONS = new Set([SCOPE_AUTHORITY_PERMISSION, ...ROLE_OPERATIONS]);
const KNOWN_PERMISSION_CODES = new Set([
  ...ROLE_PERMISSION_CATALOG.permissions.map((item) => item.code), ...ROLE_OPERATIONS, SCOPE_AUTHORITY_PERMISSION
]);
const SYSTEM_ADMIN_CODE = ROLE_PERMISSION_CATALOG.roles.find((role) => role.code === 'system_administrator');
const SYSTEM_ADMIN_PERMISSIONS = new Set([...SYSTEM_ADMIN_CODE.permissions, ...ROLE_OPERATIONS]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCOPE_RESOURCE_TYPES = new Set(['plan', 'activity']);

function dbId(value, name = 'id') {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_INT) throw new TypeError(`INVALID_${name.toUpperCase()}`);
  return number;
}
function requiredText(value, name, max = 255) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new TypeError(`INVALID_${name.toUpperCase()}`);
  return value.trim();
}
function rows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error('INVALID_PERSISTENCE_RESULT');
  return result[0];
}
function count(result) { return Number.isSafeInteger(result?.[0]?.affectedRows) ? result[0].affectedRows : 0; }
function instant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('CLOCK_UNAVAILABLE');
  return date.toISOString();
}
function safeResult(code) { return { ok: false, code }; }
function errorCode(error) { return error instanceof TypeError ? error.message : 'PERSISTENCE_FAILED'; }
function scopeRef(row) {
  if (row.id_scope_ref == null) return null;
  if (row.ref_kind === 'number') {
    const value = Number(row.ref_value);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  return row.ref_kind === 'string' && typeof row.ref_value === 'string' ? row.ref_value : undefined;
}
function parseIso(value, name) {
  const parts = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
    : null;
  if (!parts) {
    throw new TypeError(`INVALID_${name.toUpperCase()}`);
  }
  const [, yearPart, monthPart, dayPart, hourPart, minutePart, secondPart, zone, , offsetHour, offsetMinute] = parts;
  const year = Number(yearPart), month = Number(monthPart), day = Number(dayPart);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(hourPart) > 23 || Number(minutePart) > 59 || Number(secondPart) > 59 ||
      (zone !== 'Z' && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) {
    throw new TypeError(`INVALID_${name.toUpperCase()}`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`INVALID_${name.toUpperCase()}`);
  return date;
}
function utcDatabaseDate(value, name) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== 'string') throw new TypeError(`INVALID_${name.toUpperCase()}`);
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`INVALID_${name.toUpperCase()}`);
  return date;
}

/** Catalog and access administration. Every request rechecks its permission under the persistent mutex. */
export function createRoleAdministrationService({ pool, ids, clock } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') throw new TypeError('A mysql2/promise pool is required.');
  if (!ids || typeof ids.next !== 'function') throw new TypeError('A UUID v4 provider is required.');
  if (!clock || typeof clock.now !== 'function') throw new TypeError('A clock is required.');
  const transactions = createMysqlTransactionManager(pool);
  const mutex = createAuthorizationMutexRepository();
  const authorization = createAuthorizationRepository({ mutex });
  const audit = createAuditRepository({ mutex });

  async function run(actorContext, permissionCode, reason, work, fallbackPermissionCode = null) {
    let actorId;
    try {
      actorId = dbId(actorContext?.actorId, 'actor_id');
      if (!KNOWN_PERMISSION_CODES.has(permissionCode) ||
          (fallbackPermissionCode !== null && !KNOWN_PERMISSION_CODES.has(fallbackPermissionCode))) {
        return safeResult('INVALID_PERMISSION');
      }
      if (reason !== null) reason = requiredText(reason, 'reason', 4000);
    } catch (error) { return safeResult(errorCode(error)); }
    try {
      return await transactions.run((rawTx) => mutex.withLock(rawTx, async (tx) => {
        mutex.assertHeld(tx);
        let authorized = await authorization.canAccess({ actorId, permissionCode }, tx);
        if (!authorized && fallbackPermissionCode) {
          const effectivePermissions = await authorization.getEffectivePermissionCodes({actorId}, tx);
          authorized = effectivePermissions.includes(fallbackPermissionCode);
        }
        if (!authorized) return safeResult('AUTHORITY_REQUIRED');
        return work(tx, actorId, reason);
      }));
    } catch { return safeResult('PERSISTENCE_FAILED'); }
  }

  async function appendAudit(tx, actorId, action, reason, fields = {}) {
    const eventId = await ids.next();
    if (typeof eventId !== 'string' || !UUID_V4.test(eventId)) throw new TypeError('IDENTIFIER_UNAVAILABLE');
    await audit.append({ eventId, actorType: 'user', actorId, action,
      occurredAt: instant(await clock.now()), reason, ...fields }, tx);
  }

  return Object.freeze({
    async getCapabilities(actorContext) {
      let actorId;
      try { actorId = dbId(actorContext?.actorId, 'actor_id'); }
      catch (error) { return safeResult(errorCode(error)); }
      try {
        return await transactions.run((rawTx) => mutex.withLock(rawTx, async (tx) => {
          mutex.assertHeld(tx);
          const permissions = await authorization.getEffectivePermissionCodes({ actorId }, tx);
          return { ok: true, permissions };
        }));
      } catch { return safeResult('PERSISTENCE_FAILED'); }
    },

    async listCatalog(actorContext) {
      return run(actorContext, 'M01.roles.read', null, async (tx) => {
        const roles = rows(await tx.execute(
          `SELECT r.id_rol, r.nombre_rol, r.descripcion, rc.clasificacion_privilegio,
                  rc.permite_vigencia_indefinida, rc.requiere_ambito
             FROM rol AS r LEFT JOIN rol_configuracion AS rc ON rc.id_rol = r.id_rol
            ORDER BY r.id_rol`));
        const permissions = rows(await tx.execute(
          `SELECT rp.id_rol, p.codigo, rp.activo
             FROM rol_permiso AS rp JOIN permiso AS p ON p.id_permiso = rp.id_permiso
            ORDER BY rp.id_rol, p.codigo`));
        const byRole = new Map();
        for (const item of permissions) {
          if (!byRole.has(Number(item.id_rol))) byRole.set(Number(item.id_rol), []);
          byRole.get(Number(item.id_rol)).push({ code: item.codigo, active: item.activo === 1 || item.activo === '1' });
        }
        return { ok: true, roles: roles.map((role) => ({ id: Number(role.id_rol), name: role.nombre_rol,
          description: role.descripcion, classification: role.clasificacion_privilegio ?? null,
          allowOpenEndedAssignment: role.permite_vigencia_indefinida === 1 || role.permite_vigencia_indefinida === '1',
          requiresScope: role.requiere_ambito === 1 || role.requiere_ambito === '1',
          permissions: byRole.get(Number(role.id_rol)) ?? [] })) };
      }, SCOPE_AUTHORITY_PERMISSION);
    },

    async listPermissions(actorContext) {
      return run(actorContext, 'M01.permissions.read', null, async (tx) => {
        const data = rows(await tx.execute('SELECT id_permiso, codigo, descripcion, activo FROM permiso ORDER BY codigo'));
        return { ok: true, permissions: data.map((item) => ({ id: Number(item.id_permiso), code: item.codigo,
          description: item.descripcion, active: item.activo === 1 || item.activo === '1' })) };
      });
    },

    async listScopeResources(actorContext) {
      return run(actorContext, 'M01.roles.manage', null, async (tx) => {
        const plans = rows(await tx.execute(
          `SELECT id_plan AS id, nombre AS name
             FROM plan_accion
            ORDER BY nombre, id_plan`
        )).map((plan) => ({type: 'plan', id: Number(plan.id), name: plan.name, planId: Number(plan.id)}));
        const activities = rows(await tx.execute(
          `SELECT activity.id_actividad AS id, activity.id_plan AS planId,
                  plan.nombre AS planName,
                  COALESCE(NULLIF(institutional_activity.nombre, ''),
                           NULLIF(activity.descripcion, ''),
                           CONCAT('Actividad ', activity.id_actividad)) AS name
             FROM actividad AS activity
             JOIN plan_accion AS plan ON plan.id_plan = activity.id_plan
             LEFT JOIN actividad_institucional AS institutional_activity
               ON institutional_activity.id_actividad = activity.id_actividad
              AND institutional_activity.id_plan = activity.id_plan
            ORDER BY plan.nombre, activity.id_actividad`
        )).map((activity) => ({type: 'activity', id: Number(activity.id),
          name: activity.name, planId: Number(activity.planId), planName: activity.planName}));
        return {ok: true, resources: [...plans, ...activities]};
      });
    },

    async enableScopeResource(actorContext, input = {}) {
      let roleId, resourceId;
      try {
        roleId = dbId(input.roleId, 'role_id');
        resourceId = dbId(input.resourceId, 'resource_id');
        if (!SCOPE_RESOURCE_TYPES.has(input.resourceType)) throw new TypeError('INVALID_RESOURCE_TYPE');
        requiredText(input.reason, 'reason', 4000);
      } catch (error) {
        return safeResult(errorCode(error));
      }

      return run(actorContext, 'M01.roles.manage', input.reason, async (tx, actorId, reason) => {
        const roleRows = rows(await tx.execute(
          `SELECT r.nombre_rol, rc.clasificacion_privilegio, rc.requiere_ambito
             FROM rol AS r
             JOIN rol_configuracion AS rc ON rc.id_rol = r.id_rol
            WHERE r.id_rol = ? LIMIT 1 FOR UPDATE`,
          [roleId]
        ));
        if (roleRows.length !== 1) return safeResult('ROLE_NOT_FOUND');
        if (!(roleRows[0].requiere_ambito === 1 || roleRows[0].requiere_ambito === '1')) {
          return safeResult('ROLE_SCOPE_REQUIRED');
        }

        let resource;
        if (input.resourceType === 'plan') {
          const found = rows(await tx.execute(
            'SELECT id_plan AS id, nombre AS name FROM plan_accion WHERE id_plan = ? LIMIT 1 FOR UPDATE',
            [resourceId]
          ));
          if (found.length !== 1) return safeResult('SCOPE_RESOURCE_NOT_FOUND');
          resource = {id: Number(found[0].id), name: found[0].name, planId: Number(found[0].id)};
        } else {
          const found = rows(await tx.execute(
            `SELECT activity.id_actividad AS id, activity.id_plan AS planId,
                    COALESCE(NULLIF(institutional_activity.nombre, ''),
                             NULLIF(activity.descripcion, ''),
                             CONCAT('Actividad ', activity.id_actividad)) AS name
               FROM actividad AS activity
               LEFT JOIN actividad_institucional AS institutional_activity
                 ON institutional_activity.id_actividad = activity.id_actividad
                AND institutional_activity.id_plan = activity.id_plan
              WHERE activity.id_actividad = ? LIMIT 1 FOR UPDATE`,
            [resourceId]
          ));
          if (found.length !== 1) return safeResult('SCOPE_RESOURCE_NOT_FOUND');
          resource = {id: Number(found[0].id), name: found[0].name, planId: Number(found[0].planId)};
        }

        const mapping = rows(await tx.execute(
          `SELECT scoped.id_scope_ref, scope.ref_value, scope.activo
             FROM rol_scope_recurso AS scoped
             JOIN rol_scope_ref AS scope ON scope.id_scope_ref = scoped.id_scope_ref
            WHERE scoped.tipo_recurso = ? AND scoped.id_plan = ? AND scoped.id_actividad <=> ?
            LIMIT 1 FOR UPDATE`,
          [input.resourceType, resource.planId,
            input.resourceType === 'activity' ? resource.id : null]
        ));
        let scope;
        if (mapping.length) {
          scope = mapping[0];
          if (!(scope.activo === 1 || scope.activo === '1')) return safeResult('SCOPE_REFERENCE_INACTIVE');
        } else {
          const scopeRef = await ids.next();
          if (typeof scopeRef !== 'string' || !UUID_V4.test(scopeRef)) throw new TypeError('IDENTIFIER_UNAVAILABLE');
          const createdAt = instant(await clock.now()).slice(0, 23).replace('T', ' ');
          const inserted = await tx.execute(
            `INSERT INTO rol_scope_ref (ref_kind, ref_value, activo, creado_en, creado_por)
             VALUES ('string', ?, 1, ?, ?)`,
            [scopeRef, createdAt, actorId]
          );
          const scopeId = Number(inserted?.[0]?.insertId);
          if (!Number.isSafeInteger(scopeId) || scopeId < 1) throw new Error('SCOPE_RESOURCE_CREATE_FAILED');
          await tx.execute(
            `INSERT INTO rol_scope_recurso (id_scope_ref, tipo_recurso, id_plan, id_actividad)
             VALUES (?, ?, ?, ?)`,
            [scopeId, input.resourceType, resource.planId,
              input.resourceType === 'activity' ? resource.id : null]
          );
          scope = {id_scope_ref: scopeId, ref_value: scopeRef, activo: 1};
        }

        const existingPermission = rows(await tx.execute(
          'SELECT id_rol FROM rol_scope_permitido WHERE id_scope_ref = ? AND id_rol = ? LIMIT 1 FOR UPDATE',
          [scope.id_scope_ref, roleId]
        ));
        if (existingPermission.length) return safeResult('SCOPE_RESOURCE_ALREADY_ENABLED');
        await tx.execute(
          'INSERT INTO rol_scope_permitido (id_rol, id_scope_ref) VALUES (?, ?)',
          [roleId, scope.id_scope_ref]
        );
        await appendAudit(tx, actorId, 'role_scope_resource_enabled', reason, {
          roleId,
          after: JSON.stringify({
            resourceType: input.resourceType,
            resourceId: resource.id,
            resourceName: resource.name,
            planId: resource.planId,
            scopeRef: scope.ref_value
          })
        });
        return {ok: true, resource: {
          type: input.resourceType, id: resource.id, name: resource.name,
          planId: resource.planId, scopeRef: scope.ref_value
        }};
      });
    },

    async listInitialScopeAuthorityRequests(actorContext) {
      return run(actorContext, 'M01.roles.manage', null, async (tx) => {
        const requests = rows(await tx.execute(
          `SELECT request.id_solicitud, request.id_usuario_objetivo, target.nombre AS target_name,
                  request.id_plan, plan.nombre AS plan_name, request.referencia_institucional,
                  request.motivo, request.vigente_desde, request.vigente_hasta,
                  request.id_usuario_solicitante, requester.nombre AS requester_name,
                  request.estado, request.id_usuario_decisor, decider.nombre AS decider_name,
                  request.referencia_decision, request.motivo_decision, request.decidida_en,
                  request.id_asignacion
             FROM rol_scope_authority_request AS request
             JOIN usuario AS target ON target.id_usuario = request.id_usuario_objetivo
             JOIN usuario AS requester ON requester.id_usuario = request.id_usuario_solicitante
             JOIN plan_accion AS plan ON plan.id_plan = request.id_plan
             LEFT JOIN usuario AS decider ON decider.id_usuario = request.id_usuario_decisor
            ORDER BY request.solicitada_en DESC
            LIMIT 100`
        ));
        return {ok: true, requests: requests.map((request) => ({
          id: request.id_solicitud,
          targetUserId: Number(request.id_usuario_objetivo),
          targetName: request.target_name,
          planId: Number(request.id_plan),
          planName: request.plan_name,
          institutionalReference: request.referencia_institucional,
          reason: request.motivo,
          validFrom: request.vigente_desde,
          validUntil: request.vigente_hasta,
          requestedBy: Number(request.id_usuario_solicitante),
          requesterName: request.requester_name,
          status: request.estado,
          decidedBy: request.id_usuario_decisor == null ? null : Number(request.id_usuario_decisor),
          deciderName: request.decider_name,
          decisionReference: request.referencia_decision,
          decisionReason: request.motivo_decision,
          decidedAt: request.decidida_en,
          assignmentId: request.id_asignacion
        }))};
      });
    },

    async requestInitialScopeAuthority(actorContext, input = {}) {
      let targetUserId, planId, institutionalReference, reason, validFrom, validUntil;
      try {
        targetUserId = dbId(input.targetUserId, 'target_user_id');
        planId = dbId(input.planId, 'plan_id');
        institutionalReference = requiredText(input.institutionalReference, 'institutional_reference', 255);
        reason = requiredText(input.reason, 'reason', 4000);
        validFrom = input.validFrom == null ? null : parseIso(input.validFrom, 'valid_from');
        validUntil = parseIso(input.validUntil, 'valid_until');
        if (validFrom && validUntil <= validFrom) throw new TypeError('INVALID_VALIDITY');
      } catch (error) {
        return safeResult(errorCode(error));
      }

      return run(actorContext, 'M01.roles.manage', reason, async (tx, actorId) => {
        const now = new Date(instant(await clock.now()));
        const start = validFrom ?? now;
        if (start < now || validUntil <= start) return safeResult('INVALID_VALIDITY');
        const actorRows = rows(await tx.execute(
          `SELECT id_usuario FROM usuario
            WHERE id_usuario = ? AND LOWER(estado) = 'activo'
            LIMIT 1 FOR UPDATE`, [actorId]));
        if (actorRows.length !== 1) return safeResult('ACTOR_NOT_ACTIVE');
        const plans = rows(await tx.execute(
          'SELECT id_plan FROM plan_accion WHERE id_plan = ? LIMIT 1 FOR UPDATE', [planId]));
        if (plans.length !== 1) return safeResult('SCOPE_RESOURCE_NOT_FOUND');
        const targets = rows(await tx.execute(
          `SELECT id_usuario FROM usuario
            WHERE id_usuario = ? AND LOWER(estado) = 'activo'
            LIMIT 1 FOR UPDATE`, [targetUserId]));
        if (targets.length !== 1) return safeResult('TARGET_USER_NOT_ACTIVE');
        const roleRows = rows(await tx.execute(
          `SELECT role.id_rol, config.clasificacion_privilegio, config.permite_vigencia_indefinida,
                  config.requiere_ambito
             FROM rol AS role
             JOIN rol_configuracion AS config ON config.id_rol = role.id_rol
            WHERE BINARY role.nombre_rol = BINARY ?
            LIMIT 2 FOR UPDATE`, [SCOPE_AUTHORITY_ROLE]));
        if (roleRows.length !== 1 || roleRows[0].clasificacion_privilegio !== 'ordinary' ||
            Number(roleRows[0].permite_vigencia_indefinida) !== 0 ||
            Number(roleRows[0].requiere_ambito) !== 1) return safeResult('SCOPE_AUTHORITY_ROLE_NOT_READY');
        const prior = rows(await tx.execute(
          `SELECT id_solicitud FROM rol_scope_authority_request
            WHERE id_plan = ? AND estado IN ('pending', 'approved')
            LIMIT 1 FOR UPDATE`, [planId]));
        if (prior.length) return safeResult('INITIAL_SCOPE_AUTHORITY_ALREADY_EXISTS');
        const id = await ids.next();
        if (typeof id !== 'string' || !UUID_V4.test(id)) throw new TypeError('IDENTIFIER_UNAVAILABLE');
        const timestamp = instant(now).slice(0, 23).replace('T', ' ');
        const saved = await tx.execute(
          `INSERT INTO rol_scope_authority_request
            (id_solicitud, id_usuario_objetivo, id_plan, referencia_institucional, motivo,
             vigente_desde, vigente_hasta, id_usuario_solicitante, estado, solicitada_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [id, targetUserId, planId, institutionalReference, reason,
            start.toISOString().slice(0, 23).replace('T', ' '),
            validUntil.toISOString().slice(0, 23).replace('T', ' '), actorId, timestamp]);
        if (count(saved) !== 1) throw new Error('PERSISTENCE_FAILED');
        await appendAudit(tx, actorId, 'initial_scope_authority_requested', reason, {
          targetUserId, roleId: Number(roleRows[0].id_rol), authorizationReference: institutionalReference,
          after: JSON.stringify({planId, targetUserId, validFrom: start.toISOString(), validUntil: validUntil.toISOString()})
        });
        return {ok: true, requestId: id, status: 'pending'};
      });
    },

    async decideInitialScopeAuthority(actorContext, requestId, input = {}) {
      let id, decision, decisionReference, decisionReason;
      try {
        if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) throw new TypeError('INVALID_REQUEST_ID');
        id = requestId;
        if (!['approve', 'reject'].includes(input.decision)) throw new TypeError('INVALID_DECISION');
        decision = input.decision;
        decisionReference = requiredText(input.institutionalReference, 'institutional_reference', 255);
        decisionReason = requiredText(input.reason, 'reason', 4000);
      } catch (error) {
        return safeResult(errorCode(error));
      }

      return run(actorContext, 'M01.roles.manage', decisionReason, async (tx, actorId) => {
        const actorRows = rows(await tx.execute(
          `SELECT id_usuario FROM usuario
            WHERE id_usuario = ? AND LOWER(estado) = 'activo'
            LIMIT 1 FOR UPDATE`, [actorId]));
        if (actorRows.length !== 1) return safeResult('ACTOR_NOT_ACTIVE');
        const requests = rows(await tx.execute(
          `SELECT id_solicitud, id_usuario_objetivo, id_plan, referencia_institucional, motivo,
                  vigente_desde, vigente_hasta, id_usuario_solicitante, estado
             FROM rol_scope_authority_request
            WHERE id_solicitud = ? LIMIT 1 FOR UPDATE`, [id]));
        if (requests.length !== 1) return safeResult('INITIAL_SCOPE_AUTHORITY_REQUEST_NOT_FOUND');
        const request = requests[0];
        if (request.estado !== 'pending') return safeResult('INITIAL_SCOPE_AUTHORITY_ALREADY_DECIDED');
        if (Number(request.id_usuario_solicitante) === actorId) return safeResult('INDEPENDENT_APPROVAL_REQUIRED');
        if (request.referencia_institucional !== decisionReference) return safeResult('INSTITUTIONAL_REFERENCE_MISMATCH');

        if (decision === 'reject') {
          const now = instant(await clock.now()).slice(0, 23).replace('T', ' ');
          const updated = await tx.execute(
            `UPDATE rol_scope_authority_request
                SET estado = 'rejected', id_usuario_decisor = ?, referencia_decision = ?,
                    motivo_decision = ?, decidida_en = ?
              WHERE id_solicitud = ? AND estado = 'pending'`,
            [actorId, decisionReference, decisionReason, now, id]);
          if (count(updated) !== 1) return safeResult('INITIAL_SCOPE_AUTHORITY_ALREADY_DECIDED');
          await appendAudit(tx, actorId, 'initial_scope_authority_rejected', decisionReason, {
            targetUserId: Number(request.id_usuario_objetivo), authorizationReference: decisionReference,
            before: JSON.stringify({status: 'pending'}), after: JSON.stringify({status: 'rejected'})
          });
          return {ok: true, requestId: id, status: 'rejected'};
        }

        const targetId = Number(request.id_usuario_objetivo);
        const planId = Number(request.id_plan);
        const roles = rows(await tx.execute(
          `SELECT role.id_rol, config.clasificacion_privilegio, config.permite_vigencia_indefinida,
                  config.requiere_ambito
             FROM rol AS role
             JOIN rol_configuracion AS config ON config.id_rol = role.id_rol
            WHERE BINARY role.nombre_rol = BINARY ?
            LIMIT 2 FOR UPDATE`, [SCOPE_AUTHORITY_ROLE]));
        if (roles.length !== 1 || roles[0].clasificacion_privilegio !== 'ordinary' ||
            Number(roles[0].permite_vigencia_indefinida) !== 0 || Number(roles[0].requiere_ambito) !== 1) {
          return safeResult('SCOPE_AUTHORITY_ROLE_NOT_READY');
        }
        const roleId = Number(roles[0].id_rol);
        const target = rows(await tx.execute(
          `SELECT id_usuario FROM usuario
            WHERE id_usuario = ? AND LOWER(estado) = 'activo'
            LIMIT 1 FOR UPDATE`, [targetId]));
        if (target.length !== 1) return safeResult('TARGET_USER_NOT_ACTIVE');
        const plan = rows(await tx.execute(
          'SELECT id_plan FROM plan_accion WHERE id_plan = ? LIMIT 1 FOR UPDATE', [planId]));
        if (plan.length !== 1) return safeResult('SCOPE_RESOURCE_NOT_FOUND');
        const permissionRows = rows(await tx.execute(
          `SELECT id_permiso, codigo, activo FROM permiso
            WHERE codigo IN (?, ?, ?, ?) FOR UPDATE`,
          [...SCOPE_AUTHORITY_PERMISSIONS]));
        if (permissionRows.length !== SCOPE_AUTHORITY_PERMISSIONS.size ||
            permissionRows.some((permission) => Number(permission.activo) !== 1)) {
          return safeResult('SCOPE_AUTHORITY_ROLE_NOT_READY');
        }
        const permissionIds = new Map(permissionRows.map((permission) => [permission.codigo, Number(permission.id_permiso)]));
        const existingPermissions = rows(await tx.execute(
          `SELECT permission.codigo, role_permission.activo
             FROM rol_permiso AS role_permission
             JOIN permiso AS permission ON permission.id_permiso = role_permission.id_permiso
            WHERE role_permission.id_rol = ? FOR UPDATE`, [roleId]));
        if (existingPermissions.some((permission) => !SCOPE_AUTHORITY_PERMISSIONS.has(permission.codigo) ||
            Number(permission.activo) !== 1)) return safeResult('SCOPE_AUTHORITY_ROLE_CONFIGURATION_CONFLICT');
        if (existingPermissions.length > 0 &&
            (existingPermissions.length !== SCOPE_AUTHORITY_PERMISSIONS.size ||
             [...SCOPE_AUTHORITY_PERMISSIONS].some((code) =>
               !existingPermissions.some((permission) => permission.codigo === code)))) {
          return safeResult('SCOPE_AUTHORITY_ROLE_CONFIGURATION_CONFLICT');
        }
        const now = new Date(instant(await clock.now()));
        let validFrom, validUntil;
        try {
          validFrom = utcDatabaseDate(request.vigente_desde, 'valid_from');
          validUntil = utcDatabaseDate(request.vigente_hasta, 'valid_until');
        } catch (error) {
          return safeResult(errorCode(error));
        }
        if (validUntil <= now || validUntil <= validFrom) return safeResult('INVALID_VALIDITY');

        let scope = rows(await tx.execute(
          `SELECT mapping.id_scope_ref, reference.ref_value, reference.activo
             FROM rol_scope_recurso AS mapping
             JOIN rol_scope_ref AS reference ON reference.id_scope_ref = mapping.id_scope_ref
            WHERE mapping.tipo_recurso = 'plan' AND mapping.id_plan = ? AND mapping.id_actividad IS NULL
            LIMIT 2 FOR UPDATE`, [planId]));
        if (scope.length > 1) return safeResult('SCOPE_RESOURCE_AMBIGUOUS');
        let scopeId, scopeRef;
        if (scope.length === 1) {
          if (Number(scope[0].activo) !== 1) return safeResult('SCOPE_REFERENCE_INACTIVE');
          scopeId = Number(scope[0].id_scope_ref);
          scopeRef = scope[0].ref_value;
        } else {
          scopeRef = await ids.next();
          if (typeof scopeRef !== 'string' || !UUID_V4.test(scopeRef)) throw new TypeError('IDENTIFIER_UNAVAILABLE');
          const insertedScope = await tx.execute(
            `INSERT INTO rol_scope_ref (ref_kind, ref_value, activo, creado_en, creado_por)
             VALUES ('string', ?, 1, ?, ?)`,
            [scopeRef, now.toISOString().slice(0, 23).replace('T', ' '), actorId]);
          scopeId = Number(insertedScope?.[0]?.insertId);
          if (!Number.isSafeInteger(scopeId) || scopeId < 1) throw new Error('PERSISTENCE_FAILED');
          await tx.execute(
            `INSERT INTO rol_scope_recurso (id_scope_ref, tipo_recurso, id_plan, id_actividad)
             VALUES (?, 'plan', ?, NULL)`, [scopeId, planId]);
        }
        const allowed = rows(await tx.execute(
          'SELECT id_rol FROM rol_scope_permitido WHERE id_scope_ref = ? AND id_rol = ? LIMIT 1 FOR UPDATE',
          [scopeId, roleId]));
        if (!allowed.length) await tx.execute(
          'INSERT INTO rol_scope_permitido (id_rol, id_scope_ref) VALUES (?, ?)', [roleId, scopeId]);
        for (const permissionCode of SCOPE_AUTHORITY_PERMISSIONS) {
          const permissionId = permissionIds.get(permissionCode);
          const existing = existingPermissions.find((permission) => permission.codigo === permissionCode);
          if (existing) continue;
          await tx.execute(
            `INSERT INTO rol_permiso (id_rol, id_permiso, creado_en, creado_por, activo)
             VALUES (?, ?, ?, ?, 1)`, [roleId, permissionId, now.toISOString().slice(0, 23).replace('T', ' '), actorId]);
        }
        if (existingPermissions.length === 0) {
          await appendAudit(tx, actorId, 'role_permissions_updated', decisionReason, {
             roleId, before: JSON.stringify([]),
             after: JSON.stringify([...SCOPE_AUTHORITY_PERMISSIONS].sort())
          });
        }
        const active = rows(await tx.execute(
          `SELECT id_asignacion FROM rol_asignacion
            WHERE id_usuario = ? AND id_rol = ? AND id_scope_ref = ?
              AND estado IN ('active', 'scheduled')
              AND vigente_desde < ? AND (vigente_hasta IS NULL OR vigente_hasta > ?)
            LIMIT 1 FOR UPDATE`,
          [targetId, roleId, scopeId, validUntil.toISOString().slice(0, 23).replace('T', ' '),
            now.toISOString().slice(0, 23).replace('T', ' ')]));
        if (active.length) return safeResult('ASSIGNMENT_CONFLICT');
        const assignmentId = await ids.next();
        if (typeof assignmentId !== 'string' || !UUID_V4.test(assignmentId)) throw new TypeError('IDENTIFIER_UNAVAILABLE');
        const sqlNow = now.toISOString().slice(0, 23).replace('T', ' ');
        const assignmentReason = `${request.motivo}\nReferencia institucional: ${decisionReference}`;
        const assignment = await tx.execute(
          `INSERT INTO rol_asignacion
            (id_asignacion, id_usuario, id_rol, id_scope_ref, vigente_desde, vigente_hasta,
             estado, creado_por, creado_en, motivo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [assignmentId, targetId, roleId, scopeId, validFrom.toISOString().slice(0, 23).replace('T', ' '),
            validUntil.toISOString().slice(0, 23).replace('T', ' '),
            validFrom > now ? 'scheduled' : 'active', actorId, sqlNow, assignmentReason]);
        if (count(assignment) !== 1) throw new Error('PERSISTENCE_FAILED');
        const updated = await tx.execute(
          `UPDATE rol_scope_authority_request
              SET estado = 'approved', id_usuario_decisor = ?, referencia_decision = ?,
                  motivo_decision = ?, decidida_en = ?, id_scope_ref = ?, id_asignacion = ?
            WHERE id_solicitud = ? AND estado = 'pending'`,
          [actorId, decisionReference, decisionReason, sqlNow, scopeId, assignmentId, id]);
        if (count(updated) !== 1) return safeResult('INITIAL_SCOPE_AUTHORITY_ALREADY_DECIDED');
        await appendAudit(tx, actorId, 'initial_scope_authority_granted', decisionReason, {
          targetUserId: targetId, roleId, scopeRef, assignmentId,
          authorizationReference: decisionReference,
          after: JSON.stringify({planId, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString()})
        });
        return {ok: true, requestId: id, status: 'approved', assignmentId, scopeRef};
      });
    },

    async listAssignments(actorContext, userId) {
      let targetId;
      try { targetId = dbId(userId, 'target_user_id'); } catch (error) { return safeResult(errorCode(error)); }
      return run(actorContext, 'M01.assignments.read', null, async (tx) => {
        const data = rows(await tx.execute(
          `SELECT a.id_asignacion, a.id_usuario, a.id_rol, r.nombre_rol, a.id_scope_ref,
                  sr.ref_kind, sr.ref_value, a.vigente_desde, a.vigente_hasta, a.estado,
                  a.creado_por, a.creado_en, a.revocado_por, a.revocado_en
             FROM rol_asignacion AS a JOIN rol AS r ON r.id_rol = a.id_rol
             LEFT JOIN rol_scope_ref AS sr ON sr.id_scope_ref = a.id_scope_ref
            WHERE a.id_usuario = ? ORDER BY a.creado_en DESC LIMIT 200`, [targetId]));
        const actorId = dbId(actorContext?.actorId, 'actor_id');
        const assignments = await Promise.all(data.map(async (a) => {
          const ref = scopeRef(a);
          const canRevoke = ref !== undefined && await authorization.canManageRole({ actorId,
            operation: 'revoke-role', targetUserId: Number(a.id_usuario), roleId: Number(a.id_rol),
            scopeRef: ref, assignmentId: a.id_asignacion }, tx);
          return { id: a.id_asignacion, userId: Number(a.id_usuario), roleId: Number(a.id_rol), roleName: a.nombre_rol,
            scopeRef: ref === undefined ? null : ref, validFrom: a.vigente_desde, validUntil: a.vigente_hasta, status: a.estado,
            createdBy: Number(a.creado_por), createdAt: a.creado_en,
            revokedBy: a.revocado_por == null ? null : Number(a.revocado_por), revokedAt: a.revocado_en, canRevoke };
        }));
        return { ok: true, assignments };
      });
    },

    async listRequests(actorContext) {
      return run(actorContext, 'M01.requests.read', null, async (tx) => {
        const data = rows(await tx.execute(
          `SELECT q.id_solicitud, q.tipo_accion, q.id_usuario_solicitante,
                  COALESCE(q.id_usuario_objetivo, a.id_usuario) AS id_usuario_objetivo,
                  COALESCE(q.id_rol, a.id_rol) AS id_rol, r.nombre_rol,
                  q.id_asignacion_objetivo, q.id_asignacion_resultado,
                  COALESCE(q.id_scope_ref, a.id_scope_ref) AS id_scope_ref, sr.ref_kind, sr.ref_value, q.estado,
                  q.motivo, q.solicitada_en, q.vence_en, d.id_usuario_decisor,
                  d.resultado, d.decidida_en, d.motivo AS motivo_decision
             FROM rol_solicitud AS q
             LEFT JOIN rol_asignacion AS a ON a.id_asignacion = q.id_asignacion_objetivo
             LEFT JOIN rol_scope_ref AS sr ON sr.id_scope_ref = COALESCE(q.id_scope_ref, a.id_scope_ref)
             LEFT JOIN rol AS r ON r.id_rol = COALESCE(q.id_rol, a.id_rol)
             LEFT JOIN rol_decision AS d ON d.id_solicitud = q.id_solicitud
            ORDER BY q.solicitada_en DESC LIMIT 200`));
        const actorId = dbId(actorContext?.actorId, 'actor_id');
        const requests = await Promise.all(data.map(async (q) => {
          const ref = scopeRef(q);
          const targetUserId = q.id_usuario_objetivo == null ? null : Number(q.id_usuario_objetivo);
          const roleId = q.id_rol == null ? null : Number(q.id_rol);
          const canDecide = ref !== undefined && targetUserId != null && roleId != null &&
            await authorization.canManageRole({ actorId, operation: 'approve-role-change', targetUserId,
              roleId, scopeRef: ref, requestId: q.id_solicitud,
              assignmentId: q.tipo_accion === 'revoke' ? q.id_asignacion_objetivo : null }, tx);
          return { id: q.id_solicitud, action: q.tipo_accion,
            requestedBy: Number(q.id_usuario_solicitante), targetUserId, roleId, roleName: q.nombre_rol,
            targetAssignmentId: q.id_asignacion_objetivo, resultAssignmentId: q.id_asignacion_resultado,
            scopeRef: ref === undefined ? null : ref, status: q.estado, reason: q.motivo, requestedAt: q.solicitada_en, expiresAt: q.vence_en,
            decidedBy: q.id_usuario_decisor == null ? null : Number(q.id_usuario_decisor),
            decision: q.resultado, decidedAt: q.decidida_en, decisionReason: q.motivo_decision, canDecide };
        }));
        return { ok: true, requests };
      });
    },

    async createRole(actorContext, input = {}) {
      let name, description;
      try {
        name = requiredText(input.name, 'role_name', 100);
        description = input.description == null ? null : requiredText(input.description, 'role_description', 255);
      } catch (error) { return safeResult(errorCode(error)); }
      if (ROLE_PERMISSION_CATALOG.roles.some((role) => role.code === name)) return safeResult('RESERVED_ROLE_NAME');
      const classification = input.classification;
      if (!['ordinary', 'privileged'].includes(classification) || typeof input.requiresScope !== 'boolean' ||
          typeof input.allowOpenEndedAssignment !== 'boolean') return safeResult('INVALID_ROLE_CONFIGURATION');
      return run(actorContext, 'M01.roles.manage', input.reason, async (tx, actorId, reason) => {
        const duplicate = rows(await tx.execute('SELECT id_rol FROM rol WHERE BINARY nombre_rol = BINARY ? LIMIT 1 FOR UPDATE', [name]));
        if (duplicate.length) return safeResult('ROLE_ALREADY_EXISTS');
        const inserted = await tx.execute('INSERT INTO rol (nombre_rol, descripcion) VALUES (?, ?)', [name, description]);
        const roleId = inserted?.[0]?.insertId;
        if (!Number.isSafeInteger(roleId) || roleId < 1) throw new Error('ROLE_INSERT_FAILED');
        await tx.execute(
          `INSERT INTO rol_configuracion (id_rol, clasificacion_privilegio, permite_vigencia_indefinida, requiere_ambito)
           VALUES (?, ?, ?, ?)`, [roleId, classification, Number(input.allowOpenEndedAssignment), Number(input.requiresScope)]);
        await appendAudit(tx, actorId, 'role_catalog_created', reason, { roleId, after: JSON.stringify({ name, description, classification, requiresScope: input.requiresScope, allowOpenEndedAssignment: input.allowOpenEndedAssignment }) });
        return { ok: true, roleId };
      });
    },

    async updateRoleConfiguration(actorContext, roleId, input = {}) {
      let id;
      try { id = dbId(roleId, 'role_id'); } catch (error) { return safeResult(errorCode(error)); }
      return run(actorContext, 'M01.roles.manage', input.reason, async (tx, actorId, reason) => {
        const beforeRows = rows(await tx.execute(
          `SELECT r.id_rol, r.nombre_rol, rc.clasificacion_privilegio, rc.permite_vigencia_indefinida, rc.requiere_ambito
             FROM rol AS r LEFT JOIN rol_configuracion AS rc ON rc.id_rol = r.id_rol
            WHERE r.id_rol = ? LIMIT 1 FOR UPDATE`, [id]));
        if (!beforeRows.length) return safeResult('ROLE_NOT_FOUND');
        if (!['ordinary', 'privileged'].includes(input.classification) || typeof input.requiresScope !== 'boolean' ||
            typeof input.allowOpenEndedAssignment !== 'boolean') return safeResult('INVALID_ROLE_CONFIGURATION');
        const before = beforeRows[0];
        if (before.nombre_rol === 'system_administrator' &&
            (input.classification !== 'privileged' || input.requiresScope !== false || input.allowOpenEndedAssignment !== true)) {
          return safeResult('SYSTEM_ADMIN_ROLE_PROTECTED');
        }
        if (before.nombre_rol === SCOPE_AUTHORITY_ROLE &&
            (input.classification !== 'ordinary' || input.requiresScope !== true || input.allowOpenEndedAssignment !== false)) {
          return safeResult('SCOPE_AUTHORITY_ROLE_PROTECTED');
        }
        await tx.execute(
          `INSERT INTO rol_configuracion (id_rol, clasificacion_privilegio, permite_vigencia_indefinida, requiere_ambito)
           VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE clasificacion_privilegio = VALUES(clasificacion_privilegio),
             permite_vigencia_indefinida = VALUES(permite_vigencia_indefinida), requiere_ambito = VALUES(requiere_ambito)`,
          [id, input.classification, Number(input.allowOpenEndedAssignment), Number(input.requiresScope)]);
        await appendAudit(tx, actorId, 'role_configuration_updated', reason, { roleId: id,
          before: JSON.stringify({ classification: before.clasificacion_privilegio, requiresScope: before.requiere_ambito, allowOpenEndedAssignment: before.permite_vigencia_indefinida }),
          after: JSON.stringify({ classification: input.classification, requiresScope: input.requiresScope, allowOpenEndedAssignment: input.allowOpenEndedAssignment }) });
        return { ok: true, roleId: id };
      });
    },

    async setRolePermissions(actorContext, roleId, permissionCodes, reasonInput) {
      let id;
      try { id = dbId(roleId, 'role_id'); } catch (error) { return safeResult(errorCode(error)); }
      if (!Array.isArray(permissionCodes) || permissionCodes.length > KNOWN_PERMISSION_CODES.size ||
          permissionCodes.some((code) => typeof code !== 'string' || !KNOWN_PERMISSION_CODES.has(code)) ||
          new Set(permissionCodes).size !== permissionCodes.length) return safeResult('INVALID_PERMISSION_SET');
      return run(actorContext, 'M01.permissions.manage', reasonInput, async (tx, actorId, reason) => {
        const roleRows = rows(await tx.execute('SELECT id_rol, nombre_rol FROM rol WHERE id_rol = ? LIMIT 1 FOR UPDATE', [id]));
        if (!roleRows.length) return safeResult('ROLE_NOT_FOUND');
        if (roleRows[0].nombre_rol === SCOPE_AUTHORITY_ROLE) return safeResult('SCOPE_AUTHORITY_ROLE_PROTECTED');
        if (permissionCodes.includes(SCOPE_AUTHORITY_PERMISSION)) return safeResult('SYSTEM_PERMISSION_PROTECTED');
        if (roleRows[0].nombre_rol === 'system_administrator' &&
            (permissionCodes.length !== SYSTEM_ADMIN_PERMISSIONS.size || permissionCodes.some((code) => !SYSTEM_ADMIN_PERMISSIONS.has(code)))) {
          return safeResult('SYSTEM_ADMIN_ROLE_PROTECTED');
        }
        const catalog = rows(await tx.execute('SELECT id_permiso, codigo FROM permiso WHERE activo = 1 ORDER BY id_permiso'));
        const permissionIds = new Map(catalog.map((p) => [p.codigo, Number(p.id_permiso)]));
        const unknown = permissionCodes.filter((code) => !permissionIds.has(code));
        if (unknown.length) return safeResult('PERMISSION_NOT_CONFIGURED');
        const existing = rows(await tx.execute('SELECT id_permiso, activo FROM rol_permiso WHERE id_rol = ? ORDER BY id_permiso FOR UPDATE', [id]));
        const desired = new Set(permissionCodes.map((code) => permissionIds.get(code)));
        const currentCodes = existing.filter((item) => item.activo === 1 || item.activo === '1')
          .map((item) => catalog.find((p) => Number(p.id_permiso) === Number(item.id_permiso))?.codigo).filter(Boolean).sort();
        const nextCodes = [...permissionCodes].sort();
        if (JSON.stringify(currentCodes) === JSON.stringify(nextCodes)) return { ok: true, changed: false, roleId: id };
        const existingById = new Map(existing.map((item) => [Number(item.id_permiso), item]));
        for (const item of catalog) {
          const permissionId = Number(item.id_permiso);
          const shouldBeActive = desired.has(permissionId);
          const old = existingById.get(permissionId);
          if (!old && shouldBeActive) {
            await tx.execute('INSERT INTO rol_permiso (id_rol, id_permiso, creado_en, creado_por, activo) VALUES (?, ?, ?, ?, 1)',
              [id, permissionId, instant(await clock.now()).slice(0, 23).replace('T', ' '), actorId]);
          } else if (old && Number(old.activo) !== Number(shouldBeActive)) {
            await tx.execute('UPDATE rol_permiso SET activo = ?, modificado_en = ?, modificado_por = ? WHERE id_rol = ? AND id_permiso = ?',
              [Number(shouldBeActive), instant(await clock.now()).slice(0, 23).replace('T', ' '), actorId, id, permissionId]);
          }
        }
        await appendAudit(tx, actorId, 'role_permissions_updated', reason, { roleId: id,
          before: JSON.stringify(currentCodes), after: JSON.stringify(nextCodes) });
        return { ok: true, changed: true, roleId: id };
      });
    },

    async setPermissionActive(actorContext, permissionCode, active, reasonInput) {
      if (typeof permissionCode !== 'string' || !KNOWN_PERMISSION_CODES.has(permissionCode) || typeof active !== 'boolean') return safeResult('INVALID_PERMISSION');
      return run(actorContext, 'M01.permissions.manage', reasonInput, async (tx, actorId, reason) => {
        const found = rows(await tx.execute('SELECT id_permiso, activo FROM permiso WHERE BINARY codigo = BINARY ? LIMIT 1 FOR UPDATE', [permissionCode]));
        if (!found.length) return safeResult('PERMISSION_NOT_FOUND');
        const permissionId = Number(found[0].id_permiso);
        const previous = found[0].activo === 1 || found[0].activo === '1';
        if (!active && (SYSTEM_ADMIN_PERMISSIONS.has(permissionCode) ||
            permissionCode === SCOPE_AUTHORITY_PERMISSION)) return safeResult('SYSTEM_PERMISSION_PROTECTED');
        if (previous !== active) {
          await tx.execute('UPDATE permiso SET activo = ? WHERE id_permiso = ?', [Number(active), permissionId]);
          await appendAudit(tx, actorId, 'permission_activation_changed', reason, { permissionId,
            before: JSON.stringify({ active: previous }), after: JSON.stringify({ active }) });
        }
        return { ok: true, permissionId, active };
      });
    }
  });
}

import { createAuthorizationRepository } from '../repositories/roles/authorization.repository.js';
import { createAuthorizationMutexRepository } from '../repositories/roles/authorization-mutex.repository.js';
import { createAuditRepository } from '../repositories/roles/audit.repository.js';
import { createMysqlTransactionManager } from './mysql-transaction-manager.js';
import { ROLE_PERMISSION_CATALOG } from '../config/role-permission-matrix.js';

const MAX_INT = 2_147_483_647;
const ROLE_OPERATIONS = ['assign-role', 'revoke-role', 'approve-role-change'];
const KNOWN_PERMISSION_CODES = new Set([
  ...ROLE_PERMISSION_CATALOG.permissions.map((item) => item.code), ...ROLE_OPERATIONS
]);
const SYSTEM_ADMIN_CODE = ROLE_PERMISSION_CATALOG.roles.find((role) => role.code === 'system_administrator');
const SYSTEM_ADMIN_PERMISSIONS = new Set([...SYSTEM_ADMIN_CODE.permissions, ...ROLE_OPERATIONS]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

/** Catalog and access administration. Every request rechecks its permission under the persistent mutex. */
export function createRoleAdministrationService({ pool, ids, clock } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') throw new TypeError('A mysql2/promise pool is required.');
  if (!ids || typeof ids.next !== 'function') throw new TypeError('A UUID v4 provider is required.');
  if (!clock || typeof clock.now !== 'function') throw new TypeError('A clock is required.');
  const transactions = createMysqlTransactionManager(pool);
  const mutex = createAuthorizationMutexRepository();
  const authorization = createAuthorizationRepository({ mutex });
  const audit = createAuditRepository({ mutex });

  async function run(actorContext, permissionCode, reason, work) {
    let actorId;
    try {
      actorId = dbId(actorContext?.actorId, 'actor_id');
      if (!KNOWN_PERMISSION_CODES.has(permissionCode)) return safeResult('INVALID_PERMISSION');
      if (reason !== null) reason = requiredText(reason, 'reason', 4000);
    } catch (error) { return safeResult(errorCode(error)); }
    try {
      return await transactions.run((rawTx) => mutex.withLock(rawTx, async (tx) => {
        mutex.assertHeld(tx);
        if (!await authorization.canAccess({ actorId, permissionCode }, tx)) return safeResult('AUTHORITY_REQUIRED');
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
      });
    },

    async listPermissions(actorContext) {
      return run(actorContext, 'M01.permissions.read', null, async (tx) => {
        const data = rows(await tx.execute('SELECT id_permiso, codigo, descripcion, activo FROM permiso ORDER BY codigo'));
        return { ok: true, permissions: data.map((item) => ({ id: Number(item.id_permiso), code: item.codigo,
          description: item.descripcion, active: item.activo === 1 || item.activo === '1' })) };
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
        if (!active && SYSTEM_ADMIN_PERMISSIONS.has(permissionCode)) return safeResult('SYSTEM_PERMISSION_PROTECTED');
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

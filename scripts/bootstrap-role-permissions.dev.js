import { createPool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashPassword, verifyPassword } from '../app/services/password.service.js';
import { ROLE_PERMISSION_CATALOG } from '../app/config/role-permission-matrix.js';
import { createAuthorizationMutexRepository } from '../app/repositories/roles/authorization-mutex.repository.js';
import { createAuditRepository } from '../app/repositories/roles/audit.repository.js';

const CONFIRM = 'SEED_DEVELOPMENT_ROLE_PERMISSIONS';
const ROLE_OPS = ['assign-role', 'revoke-role', 'approve-role-change'];
const MAX_INT = 2_147_483_647;
const idOf = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN; return Number.isSafeInteger(n) && n > 0 && n <= MAX_INT ? n : null; };
const rows = (r) => { if (!Array.isArray(r) || !Array.isArray(r[0])) throw new Error('INVALID_QUERY_RESULT'); return r[0]; };
const sqlTime = (d) => d.toISOString().slice(0, 23).replace('T', ' ');

export function validateRoleBootstrapEnvironment(env) {
  if (env.NODE_ENV !== 'development') throw new Error('BOOTSTRAP_DEVELOPMENT_ONLY');
  if (env.ROLE_PERMISSION_BOOTSTRAP_CONFIRM !== CONFIRM) throw new Error('BOOTSTRAP_CONFIRMATION_REQUIRED');
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) throw new Error('BOOTSTRAP_LOCAL_DATABASE_ONLY');
  if (!/^(?:(?:sistema_)?planes_accion|planes)_(?:dev|development|test)(?:_[a-z0-9]+)?$/i.test(env.DB_NAME ?? '')) throw new Error('BOOTSTRAP_DATABASE_NAME_NOT_ALLOWED');
  if (!env.DB_USER || env.DB_USER.toLowerCase() === 'root' || !env.DB_PASSWORD) throw new Error('BOOTSTRAP_DATABASE_ACCOUNT_REQUIRED');
  const adminPrimaryId = idOf(env.ROLE_BOOTSTRAP_ADMIN_PRIMARY_ID);
  const adminSecondaryId = idOf(env.ROLE_BOOTSTRAP_ADMIN_SECONDARY_ID);
  if (!adminPrimaryId || !adminSecondaryId || adminPrimaryId === adminSecondaryId) throw new Error('BOOTSTRAP_TWO_DISTINCT_ADMINS_REQUIRED');
  const adminPrimaryName = typeof env.ROLE_BOOTSTRAP_ADMIN_PRIMARY_NAME === 'string' ? env.ROLE_BOOTSTRAP_ADMIN_PRIMARY_NAME.trim() : '';
  const adminSecondaryName = typeof env.ROLE_BOOTSTRAP_ADMIN_SECONDARY_NAME === 'string' ? env.ROLE_BOOTSTRAP_ADMIN_SECONDARY_NAME.trim() : '';
  if (!adminPrimaryName || !adminSecondaryName || adminPrimaryName === adminSecondaryName ||
      adminPrimaryName.length > 100 || adminSecondaryName.length > 100) throw new Error('BOOTSTRAP_ADMIN_IDENTITY_NAMES_REQUIRED');
  let users;
  try { users = JSON.parse(env.ROLE_BOOTSTRAP_TEST_USERS_JSON ?? ''); } catch { throw new Error('BOOTSTRAP_TEST_USERS_JSON_INVALID'); }
  const definitions = ROLE_PERMISSION_CATALOG.roles;
  if (!Array.isArray(users) || users.length !== definitions.length) throw new Error('BOOTSTRAP_ONE_TEST_USER_PER_ROLE_REQUIRED');
  const seen = new Set();
  for (const user of users) {
    const role = definitions.find((candidate) => candidate.code === user?.roleCode);
    if (!role || seen.has(user.roleCode) || typeof user.name !== 'string' || !user.name.trim() ||
        typeof user.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) ||
        typeof user.password !== 'string' || Buffer.byteLength(user.password, 'utf8') < 14 || Buffer.byteLength(user.password, 'utf8') > 1024 ||
        (role.requiresScope && !idOf(user.scopeRefId)) || (user.scopeRefId != null && !idOf(user.scopeRefId))) {
      throw new Error('BOOTSTRAP_TEST_USER_ENTRY_INVALID');
    }
    seen.add(user.roleCode);
  }
  if (seen.size !== definitions.length) throw new Error('BOOTSTRAP_ONE_TEST_USER_PER_ROLE_REQUIRED');
  return Object.freeze({ adminPrimaryId, adminSecondaryId, adminPrimaryName, adminSecondaryName, users: Object.freeze(users) });
}

async function seed(env = process.env) {
  const cfg = validateRoleBootstrapEnvironment(env);
  const pool = createPool({ host: env.DB_HOST, port: Number(env.DB_PORT ?? 3306), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME, waitForConnections: true, connectionLimit: 2, queueLimit: 0 });
  const mutex = createAuthorizationMutexRepository();
  const audit = createAuditRepository({ mutex });
  const cn = await pool.getConnection();
  let begun = false;
  try {
    await cn.beginTransaction(); begun = true;
    const raw = Object.freeze({ query: (...a) => cn.query(...a), execute: (...a) => cn.execute(...a) });
    const summary = await mutex.withLock(raw, async (tx) => {
      const now = new Date(), time = sqlTime(now), stamp = now.toISOString();
      const reason = 'Development initialization; identity and scope supplied by operator.';
      const admins = [cfg.adminPrimaryId, cfg.adminSecondaryId];
      const accounts = rows(await tx.execute('SELECT id_usuario, nombre, estado FROM usuario WHERE id_usuario IN (?, ?) ORDER BY id_usuario', admins));
      if (accounts.length !== 2 || accounts.some((u) => String(u.estado).toLowerCase() !== 'activo')) throw new Error('BOOTSTRAP_ADMIN_ACCOUNTS_MUST_BE_ACTIVE');
      const byAdminId = new Map(accounts.map((account) => [idOf(account.id_usuario), account]));
      if (byAdminId.get(cfg.adminPrimaryId)?.nombre !== cfg.adminPrimaryName ||
          byAdminId.get(cfg.adminSecondaryId)?.nombre !== cfg.adminSecondaryName) throw new Error('BOOTSTRAP_ADMIN_IDENTITY_MISMATCH');

      const roleIds = new Map(), roleDefs = ROLE_PERMISSION_CATALOG.roles;
      for (const role of roleDefs) {
        const found = rows(await tx.execute('SELECT id_rol FROM rol WHERE BINARY nombre_rol = BINARY ? LIMIT 2', [role.code]));
        if (found.length > 1) throw new Error('BOOTSTRAP_DUPLICATE_ROLE_NAME');
        let roleId = found.length ? idOf(found[0].id_rol) : null;
        if (!roleId) {
          const added = await tx.execute('INSERT INTO rol (nombre_rol, descripcion) VALUES (?, ?)', [role.code, role.description]);
          roleId = idOf(added?.[0]?.insertId);
          if (!roleId) throw new Error('BOOTSTRAP_ROLE_INSERT_FAILED');
          await tx.execute('INSERT INTO rol_configuracion (id_rol, clasificacion_privilegio, permite_vigencia_indefinida, requiere_ambito) VALUES (?, ?, ?, ?)',
            [roleId, role.classification, Number(role.allowOpenEnded), Number(role.requiresScope)]);
          await audit.append({ eventId: randomUUID(), actorType: 'user', actorId: cfg.adminPrimaryId,
            action: 'role_catalog_created', occurredAt: stamp, reason, roleId,
            after: JSON.stringify({ code: role.code, classification: role.classification, requiresScope: role.requiresScope }) }, tx);
        } else {
          const saved = rows(await tx.execute('SELECT clasificacion_privilegio, permite_vigencia_indefinida, requiere_ambito FROM rol_configuracion WHERE id_rol = ? LIMIT 1 FOR UPDATE', [roleId]))[0];
          if (!saved || saved.clasificacion_privilegio !== role.classification || Number(saved.permite_vigencia_indefinida) !== Number(role.allowOpenEnded) || Number(saved.requiere_ambito) !== Number(role.requiresScope)) throw new Error('BOOTSTRAP_ROLE_CONFIGURATION_CONFLICT');
        }
        roleIds.set(role.code, roleId);
      }

      const permissions = [...ROLE_PERMISSION_CATALOG.permissions, ...ROLE_OPS.map((code) => ({ code, description: 'Role assignment service operation.' }))];
      const permIds = new Map();
      for (const permission of permissions) {
        const found = rows(await tx.execute('SELECT id_permiso, activo FROM permiso WHERE BINARY codigo = BINARY ? LIMIT 2 FOR UPDATE', [permission.code]));
        if (found.length > 1) throw new Error('BOOTSTRAP_DUPLICATE_PERMISSION');
        let permissionId = found.length ? idOf(found[0].id_permiso) : null;
        if (!permissionId) {
          const added = await tx.execute('INSERT INTO permiso (codigo, descripcion, activo) VALUES (?, ?, 1)', [permission.code, permission.description]);
          permissionId = idOf(added?.[0]?.insertId);
          if (!permissionId) throw new Error('BOOTSTRAP_PERMISSION_INSERT_FAILED');
          await audit.append({ eventId: randomUUID(), actorType: 'user', actorId: cfg.adminPrimaryId,
            action: 'permission_catalog_created', occurredAt: stamp, reason, permissionId,
            after: JSON.stringify({ code: permission.code }) }, tx);
        } else if (Number(found[0].activo) !== 1) {
          await tx.execute('UPDATE permiso SET activo = 1 WHERE id_permiso = ?', [permissionId]);
          await audit.append({ eventId: randomUUID(), actorType: 'user', actorId: cfg.adminPrimaryId,
            action: 'permission_activation_changed', occurredAt: stamp, reason, permissionId,
            before: JSON.stringify({ active: false }), after: JSON.stringify({ active: true }) }, tx);
        }
        permIds.set(permission.code, permissionId);
      }

      const adminPerms = new Set([...roleDefs.find((r) => r.code === 'system_administrator').permissions, ...ROLE_OPS]);
      for (const role of roleDefs) {
        const desired = role.code === 'system_administrator' ? adminPerms : new Set(role.permissions);
        const roleId = roleIds.get(role.code);
        const existing = rows(await tx.execute('SELECT id_permiso, activo FROM rol_permiso WHERE id_rol = ? ORDER BY id_permiso FOR UPDATE', [roleId]));
        const existingById = new Map(existing.map((row) => [Number(row.id_permiso), row]));
        const desiredIds = new Set([...desired].map((code) => permIds.get(code)));
        if (existing.some((row) => Number(row.activo) === 1 && !desiredIds.has(Number(row.id_permiso)))) throw new Error('BOOTSTRAP_UNEXPECTED_ACTIVE_ROLE_PERMISSION');
        const beforeCodes = existing.filter((row) => Number(row.activo) === 1)
          .map((row) => permissions.find((permission) => permIds.get(permission.code) === Number(row.id_permiso))?.code)
          .filter(Boolean).sort();
        let mappingChanged = false;
        for (const code of desired) {
          const permissionId = permIds.get(code), old = existingById.get(permissionId);
          if (!old) {
            await tx.execute('INSERT INTO rol_permiso (id_rol, id_permiso, creado_en, creado_por, activo) VALUES (?, ?, ?, ?, 1)',
              [roleId, permissionId, time, cfg.adminPrimaryId]);
            mappingChanged = true;
          } else if (Number(old.activo) !== 1) {
            await tx.execute('UPDATE rol_permiso SET activo = 1, modificado_en = ?, modificado_por = ? WHERE id_rol = ? AND id_permiso = ?',
              [time, cfg.adminPrimaryId, roleId, permissionId]);
            mappingChanged = true;
          }
        }
        if (mappingChanged) await audit.append({ eventId: randomUUID(), actorType: 'user', actorId: cfg.adminPrimaryId,
          action: 'role_permissions_updated', occurredAt: stamp, reason, roleId,
          before: JSON.stringify(beforeCodes), after: JSON.stringify([...desired].sort()) }, tx);
      }

      const users = new Map();
      for (const input of cfg.users) {
        const found = rows(await tx.execute('SELECT id_usuario, nombre, estado FROM usuario WHERE correo = ? LIMIT 2 FOR UPDATE', [input.email]));
        if (found.length > 1) throw new Error('BOOTSTRAP_TEST_EMAIL_NOT_UNIQUE');
        let userId = found.length ? idOf(found[0].id_usuario) : null;
        if (found.length && (found[0].nombre !== input.name || String(found[0].estado).toLowerCase() !== 'activo')) throw new Error('BOOTSTRAP_TEST_ACCOUNT_CONFLICT');
        if (!userId) {
          const passwordHash = await hashPassword(input.password);
          const added = await tx.execute('INSERT INTO usuario (nombre, correo, `contraseña`, estado) VALUES (?, ?, ?, ?)',
            [input.name.trim(), input.email, passwordHash, 'Activo']);
          userId = idOf(added?.[0]?.insertId);
          if (!userId) throw new Error('BOOTSTRAP_TEST_USER_INSERT_FAILED');
          await audit.append({ eventId: randomUUID(), actorType: 'user', actorId: cfg.adminPrimaryId,
            action: 'test_user_account_created', occurredAt: stamp, reason, targetUserId: userId,
            after: JSON.stringify({ roleCode: input.roleCode, environment: 'development' }) }, tx);
        } else {
          const credential = rows(await tx.execute('SELECT `contraseña` FROM usuario WHERE id_usuario = ? LIMIT 1', [userId]))[0];
          if (!credential || !await verifyPassword(input.password, credential['contraseña'])) throw new Error('BOOTSTRAP_TEST_ACCOUNT_CREDENTIAL_MISMATCH');
        }
        if (admins.includes(userId)) throw new Error('BOOTSTRAP_TEST_USER_MUST_BE_DISTINCT_FROM_ADMINS');
        users.set(input.roleCode, { userId, input });
      }

      async function assign(userId, roleCode, scopeRefId, requestedBy, approvedBy) {
        const role = roleDefs.find((r) => r.code === roleCode), roleId = roleIds.get(roleCode);
        const until = role.allowOpenEnded ? null : sqlTime(new Date(now.getTime() + 365 * 86400000));
        let scopeId = null, scopeRef = null;
        if (role.requiresScope) {
          scopeId = idOf(scopeRefId);
          if (!scopeId) throw new Error('BOOTSTRAP_APPROVED_SCOPE_REQUIRED');
          const found = rows(await tx.execute(`SELECT sr.ref_kind, sr.ref_value FROM rol_scope_ref sr
            JOIN rol_scope_permitido sp ON sp.id_scope_ref = sr.id_scope_ref
            WHERE sr.id_scope_ref = ? AND sr.activo = 1 AND sp.id_rol = ? LIMIT 1 FOR UPDATE`, [scopeId, roleId]));
          if (found.length !== 1) throw new Error('BOOTSTRAP_SCOPE_NOT_ACTIVE_OR_ALLOWED');
          scopeRef = found[0].ref_kind === 'number' ? Number(found[0].ref_value) : found[0].ref_value;
          if (found[0].ref_kind === 'number' && !Number.isSafeInteger(scopeRef)) throw new Error('BOOTSTRAP_INVALID_SCOPE_VALUE');
        }
        const pending = rows(await tx.execute(`SELECT id_solicitud FROM rol_solicitud
          WHERE tipo_accion = 'assign' AND estado = 'pending_approval' AND id_usuario_objetivo = ?
            AND id_rol = ? AND id_scope_ref <=> ? AND vence_en > ? LIMIT 1 FOR UPDATE`, [userId, roleId, scopeId, time]));
        if (pending.length) throw new Error('BOOTSTRAP_PENDING_ASSIGNMENT_CONFLICT');
        const active = rows(await tx.execute(`SELECT id_asignacion, (vigente_desde <= ?) AS effective_now, EXISTS (
            SELECT 1 FROM rol_solicitud q JOIN rol_decision d ON d.id_solicitud = q.id_solicitud
             WHERE q.id_asignacion_resultado = rol_asignacion.id_asignacion AND q.estado = 'approved'
               AND q.tipo_accion = 'assign' AND d.resultado = 'approved' AND d.tipo_actor = 'user'
               AND d.id_usuario_decisor IS NOT NULL AND d.id_usuario_decisor <> q.id_usuario_solicitante
          ) AS approval_valid FROM rol_asignacion WHERE id_usuario = ? AND id_rol = ?
          AND id_scope_ref <=> ? AND estado IN ('active','scheduled')
          AND vigente_desde < COALESCE(?, '9999-12-31 23:59:59.999')
          AND (vigente_hasta IS NULL OR vigente_hasta > ?) LIMIT 2 FOR UPDATE`, [time, userId, roleId, scopeId, until, time]));
        if (active.length > 1) throw new Error('BOOTSTRAP_DUPLICATE_ACTIVE_ASSIGNMENT');
        if (active.length) {
          if (Number(active[0].effective_now) !== 1) throw new Error('BOOTSTRAP_ASSIGNMENT_OVERLAP_CONFLICT');
          if (role.classification === 'privileged' && Number(active[0].approval_valid) !== 1) throw new Error('BOOTSTRAP_EXISTING_PRIVILEGED_ASSIGNMENT_UNAPPROVED');
          return;
        }
        const assignmentId = randomUUID(), requestId = role.classification === 'privileged' ? randomUUID() : null;
        const why = 'Development role assignment approved during explicit bootstrap.';
        if (requestId) await tx.execute(`INSERT INTO rol_solicitud
          (id_solicitud,tipo_accion,id_usuario_solicitante,id_usuario_objetivo,id_rol,id_scope_ref,id_asignacion_objetivo,
           id_asignacion_resultado,vigente_desde,vigente_hasta,estado,motivo,solicitada_en,vence_en)
          VALUES (?,'assign',?,?,?,?,NULL,NULL,?,?, 'pending_approval',?,?,?)`,
          [requestId, requestedBy, userId, roleId, scopeId, time, until, why, time, sqlTime(new Date(now.getTime() + 10 * 60000))]);
        await tx.execute(`INSERT INTO rol_asignacion
          (id_asignacion,id_usuario,id_rol,id_scope_ref,vigente_desde,vigente_hasta,estado,creado_por,creado_en,motivo)
          VALUES (?,?,?,?,?,?,'active',?,?,?)`, [assignmentId,userId,roleId,scopeId,time,until,requestedBy,time,why]);
        if (requestId) {
          await tx.execute('UPDATE rol_solicitud SET id_asignacion_resultado = ? WHERE id_solicitud = ?', [assignmentId, requestId]);
          await tx.execute(`INSERT INTO rol_decision (id_solicitud,tipo_actor,id_usuario_decisor,resultado,decidida_en,motivo)
            VALUES (?,'user',?,'approved',?,?)`, [requestId, approvedBy, time, why]);
          await tx.execute("UPDATE rol_solicitud SET estado = 'approved' WHERE id_solicitud = ? AND estado = 'pending_approval'", [requestId]);
          await audit.append({ eventId: randomUUID(), actorType: 'user', actorId: approvedBy, action: 'role_assignment_approved',
            occurredAt: stamp, reason: why, requestId, assignmentId, targetUserId: userId, roleId, scopeRef }, tx);
        } else {
          await audit.append({ eventId: randomUUID(), actorType: 'user', actorId: requestedBy, action: 'role_assigned',
            occurredAt: stamp, reason: why, assignmentId, targetUserId: userId, roleId, scopeRef }, tx);
        }
      }

      await assign(cfg.adminPrimaryId, 'system_administrator', null, cfg.adminSecondaryId, cfg.adminPrimaryId);
      await assign(cfg.adminSecondaryId, 'system_administrator', null, cfg.adminPrimaryId, cfg.adminSecondaryId);
      for (const role of roleDefs) {
        const account = users.get(role.code);
        await assign(account.userId, role.code, account.input.scopeRefId, cfg.adminPrimaryId, cfg.adminSecondaryId);
      }
      return { roles: roleDefs.length, permissions: permissions.length, testUsers: users.size, systemAdministrators: 2 };
    });
    await cn.commit(); begun = false;
    return summary;
  } catch (error) {
    if (begun) { try { await cn.rollback(); } catch { /* preserve original failure */ } }
    throw error;
  } finally {
    try { cn.release(); } finally { await pool.end(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await seed();
    console.info(`Development role setup completed: ${summary.roles} roles, ${summary.permissions} permissions, ${summary.testUsers} test accounts.`);
  } catch (error) {
    console.error(`Development role setup failed safely: ${error?.message ?? 'BOOTSTRAP_FAILED'}`);
    process.exitCode = 1;
  }
}

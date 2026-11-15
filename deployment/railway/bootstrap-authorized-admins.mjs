import {createPool} from 'mysql2/promise';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hashPassword} from '../../app/services/password.service.js';
import {ROLE_PERMISSION_CATALOG} from '../../app/config/role-permission-matrix.js';
import {createAuthorizationMutexRepository} from '../../app/repositories/roles/authorization-mutex.repository.js';
import {createAuditRepository} from '../../app/repositories/roles/audit.repository.js';
import {validateProductionAdministratorBootstrap} from './production-policy.js';

const ROLE_OPERATIONS = ['assign-role', 'revoke-role', 'approve-role-change'];
const SESSION_SCHEMA_SHA256 = '41e69f3143b23c3cd33fadf3b95e07f233363e6dce6ef372ddd29b23df125f9d';
const env = process.env;
const config = validateProductionAdministratorBootstrap(env, process.argv.slice(2));
const manifest = JSON.parse(await readFile(new URL('../../schema/through-block-f.json', import.meta.url), 'utf8'));
const schema = await readFile(new URL('../../schema/through-block-f.sql', import.meta.url), 'utf8');
const sessionSchema = await readFile(new URL('web-sessions.up.sql', import.meta.url), 'utf8');
const roleDefinitions = ROLE_PERMISSION_CATALOG.roles;
const systemAdministrator = roleDefinitions.find((role) => role.code === 'system_administrator');

if (createHash('sha256').update(schema).digest('hex') !== manifest.sha256 ||
    createHash('sha256').update(sessionSchema).digest('hex') !== SESSION_SCHEMA_SHA256 ||
    manifest.tables !== 43 || manifest.foreignKeys !== 86 || manifest.triggers !== 20 ||
    !systemAdministrator || systemAdministrator.classification !== 'privileged' ||
    systemAdministrator.requiresScope || !systemAdministrator.allowOpenEnded) {
  throw new Error('PRODUCTION_ADMIN_ROLE_CATALOG_INVALID');
}

const preparedAdmins = await Promise.all(config.admins.map(async (admin) => ({
  ...admin,
  passwordHash: await hashPassword(admin.password)
})));
const permissionDefinitions = [
  ...ROLE_PERMISSION_CATALOG.permissions,
  ...ROLE_OPERATIONS.map((code) => ({code, description: 'Role assignment service operation.'}))
];
const reason = `Authorized initial production administrator bootstrap. Approval reference: ${config.approvalReference}`;
const now = new Date();
const sqlTime = (date) => date.toISOString().slice(0, 23).replace('T', ' ');
const stamp = now.toISOString();

function rows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_INVALID_QUERY_RESULT');
  }
  return result[0];
}

function insertedId(result, code) {
  const id = result?.[0]?.insertId;
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error(code);
  return Number(id);
}

async function assertPristineSchema(tx) {
  const [[database]] = await tx.execute('SELECT DATABASE() AS name, @@port AS port');
  const [[counts]] = await tx.execute(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()) AS tables_count,
       (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()) AS fks,
       (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE()) AS triggers_count`
  );
  const tables = rows(await tx.execute(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
  )).map(({name}) => name).sort();
  const expectedTables = [...Object.keys(manifest.definitions), 'web_sessions'].sort();
  if (database.name !== config.database || Number(database.port) !== 3306 ||
      Number(counts.tables_count) !== 44 || Number(counts.fks) !== 86 ||
      Number(counts.triggers_count) !== 20 ||
      JSON.stringify(tables) !== JSON.stringify(expectedTables)) {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_SCHEMA_MISMATCH');
  }

  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table)) throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_INVALID_TABLE_NAME');
    const [[count]] = await tx.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const expectedRows = table === 'rol_autorizacion_mutex' ? 1 : 0;
    if (Number(count.n) !== expectedRows) {
      throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_REQUIRES_EMPTY_SCHEMA');
    }
  }
  const mutexRows = rows(await tx.execute(
    'SELECT mutex_id FROM rol_autorizacion_mutex WHERE mutex_id = 1 FOR UPDATE'
  ));
  if (mutexRows.length !== 1) throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_MUTEX_MISSING');
}

async function createAdministratorAccounts(tx, audit) {
  const accounts = [];
  for (const admin of preparedAdmins) {
    const inserted = await tx.execute(
      'INSERT INTO usuario (nombre, correo, `contraseña`, estado) VALUES (?, ?, ?, ?)',
      [admin.name, admin.email, admin.passwordHash, 'Activo']
    );
    accounts.push({userId: insertedId(inserted, 'PRODUCTION_ADMIN_ACCOUNT_CREATE_FAILED'), admin});
  }
  for (const account of accounts) {
    await audit.append({
      eventId: randomUUID(),
      actorType: 'user',
      actorId: accounts[0].userId,
      action: 'user_account_created',
      occurredAt: stamp,
      reason,
      authorizationReference: config.approvalReference,
      targetUserId: account.userId,
      after: JSON.stringify({name: account.admin.name, email: account.admin.email, roleCode: 'system_administrator'})
    }, tx);
  }
  return accounts;
}

async function createRoleCatalog(tx, audit, actorId) {
  const roleIds = new Map();
  for (const role of roleDefinitions) {
    const inserted = await tx.execute(
      'INSERT INTO rol (nombre_rol, descripcion) VALUES (?, ?)',
      [role.code, role.description]
    );
    const roleId = insertedId(inserted, 'PRODUCTION_ADMIN_ROLE_CREATE_FAILED');
    await tx.execute(
      `INSERT INTO rol_configuracion
         (id_rol, clasificacion_privilegio, permite_vigencia_indefinida, requiere_ambito)
       VALUES (?, ?, ?, ?)`,
      [roleId, role.classification, Number(role.allowOpenEnded), Number(role.requiresScope)]
    );
    await audit.append({
      eventId: randomUUID(),
      actorType: 'user',
      actorId,
      action: 'role_catalog_created',
      occurredAt: stamp,
      reason,
      authorizationReference: config.approvalReference,
      roleId,
      after: JSON.stringify({
        code: role.code,
        classification: role.classification,
        requiresScope: role.requiresScope
      })
    }, tx);
    roleIds.set(role.code, roleId);
  }
  return roleIds;
}

async function createPermissionCatalog(tx, audit, actorId) {
  const permissionIds = new Map();
  for (const permission of permissionDefinitions) {
    const inserted = await tx.execute(
      'INSERT INTO permiso (codigo, descripcion, activo) VALUES (?, ?, 1)',
      [permission.code, permission.description]
    );
    const permissionId = insertedId(inserted, 'PRODUCTION_ADMIN_PERMISSION_CREATE_FAILED');
    await audit.append({
      eventId: randomUUID(),
      actorType: 'user',
      actorId,
      action: 'permission_catalog_created',
      occurredAt: stamp,
      reason,
      authorizationReference: config.approvalReference,
      permissionId,
      after: JSON.stringify({code: permission.code})
    }, tx);
    permissionIds.set(permission.code, permissionId);
  }
  return permissionIds;
}

async function assignAdministrator(tx, audit, roleId, target, requester, approver) {
  const requestId = randomUUID();
  const assignmentId = randomUUID();
  const requestedAt = sqlTime(now);
  const expiresAt = sqlTime(new Date(now.getTime() + 10 * 60 * 1000));

  await tx.execute(
    `INSERT INTO rol_solicitud
       (id_solicitud, tipo_accion, id_usuario_solicitante, id_usuario_objetivo,
        id_rol, id_scope_ref, id_asignacion_objetivo, id_asignacion_resultado,
        vigente_desde, vigente_hasta, estado, motivo, solicitada_en, vence_en)
     VALUES (?, 'assign', ?, ?, ?, NULL, NULL, NULL, ?, NULL, 'pending_approval', ?, ?, ?)`,
    [requestId, requester.userId, target.userId, roleId, requestedAt, reason, requestedAt, expiresAt]
  );
  await tx.execute(
    `INSERT INTO rol_asignacion
       (id_asignacion, id_usuario, id_rol, id_scope_ref, vigente_desde, vigente_hasta,
        estado, creado_por, creado_en, motivo)
     VALUES (?, ?, ?, NULL, ?, NULL, 'active', ?, ?, ?)`,
    [assignmentId, target.userId, roleId, requestedAt, requester.userId, requestedAt, reason]
  );
  await tx.execute(
    'UPDATE rol_solicitud SET id_asignacion_resultado = ? WHERE id_solicitud = ?',
    [assignmentId, requestId]
  );
  const decision = await tx.execute(
    `INSERT INTO rol_decision
       (id_solicitud, tipo_actor, id_usuario_decisor, resultado, decidida_en, motivo)
     VALUES (?, 'user', ?, 'approved', ?, ?)`,
    [requestId, approver.userId, requestedAt, reason]
  );
  const decisionId = insertedId(decision, 'PRODUCTION_ADMIN_DECISION_CREATE_FAILED');
  const updated = await tx.execute(
    "UPDATE rol_solicitud SET estado = 'approved' WHERE id_solicitud = ? AND estado = 'pending_approval'",
    [requestId]
  );
  if (Number(updated?.[0]?.affectedRows) !== 1) {
    throw new Error('PRODUCTION_ADMIN_REQUEST_APPROVAL_FAILED');
  }

  await audit.append({
    eventId: randomUUID(),
    actorType: 'user',
    actorId: approver.userId,
    action: 'role_assignment_approved',
    occurredAt: stamp,
    reason,
    authorizationReference: config.approvalReference,
    requestId,
    decisionId,
    assignmentId,
    targetUserId: target.userId,
    roleId
  }, tx);
}

async function installAdministratorCatalog(tx, audit, accounts) {
  const roleIds = await createRoleCatalog(tx, audit, accounts[0].userId);
  const permissionIds = await createPermissionCatalog(tx, audit, accounts[0].userId);
  const administratorPermissions = new Set([
    ...systemAdministrator.permissions,
    ...ROLE_OPERATIONS
  ]);
  for (const role of roleDefinitions) {
    const desired = role.code === 'system_administrator'
      ? administratorPermissions
      : new Set(role.permissions);
    const roleId = roleIds.get(role.code);
    for (const code of desired) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) throw new Error('PRODUCTION_ADMIN_PERMISSION_CATALOG_INCOMPLETE');
      await tx.execute(
        `INSERT INTO rol_permiso
           (id_rol, id_permiso, creado_en, creado_por, activo)
         VALUES (?, ?, ?, ?, 1)`,
        [roleId, permissionId, sqlTime(now), accounts[0].userId]
      );
    }
    await audit.append({
      eventId: randomUUID(),
      actorType: 'user',
      actorId: accounts[0].userId,
      action: 'role_permissions_updated',
      occurredAt: stamp,
      reason,
      authorizationReference: config.approvalReference,
      roleId,
      before: JSON.stringify([]),
      after: JSON.stringify([...desired].sort())
    }, tx);
  }
  const administratorRoleId = roleIds.get('system_administrator');
  if (!administratorRoleId) throw new Error('PRODUCTION_ADMIN_ROLE_MISSING');
  await assignAdministrator(tx, audit, administratorRoleId, accounts[0], accounts[1], accounts[0]);
  await assignAdministrator(tx, audit, administratorRoleId, accounts[1], accounts[0], accounts[1]);
  return {roles: roleIds.size, permissions: permissionIds.size};
}

const pool = createPool({
  host: config.host,
  port: 3306,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: config.database,
  waitForConnections: true,
  connectionLimit: 1,
  queueLimit: 0
});
const mutex = createAuthorizationMutexRepository();
const audit = createAuditRepository({mutex});
let connection;
let transactionStarted = false;
let summary;

try {
  connection = await pool.getConnection();
  await connection.beginTransaction();
  transactionStarted = true;
  const rawTransaction = Object.freeze({
    query: (...args) => connection.query(...args),
    execute: (...args) => connection.execute(...args)
  });
  summary = await mutex.withLock(rawTransaction, async (tx) => {
    await assertPristineSchema(tx);
    const accounts = await createAdministratorAccounts(tx, audit);
    const catalog = await installAdministratorCatalog(tx, audit, accounts);
    return {...catalog, administrators: accounts.length};
  });
  await connection.commit();
  transactionStarted = false;
  console.info(`Authorized initial administrators provisioned: ${summary.administrators} accounts, ${summary.roles} roles, ${summary.permissions} permissions.`);
} catch (error) {
  if (connection && transactionStarted) {
    try {
      await connection.rollback();
    } catch {
      console.error('Rollback outcome is unknown; inspect the database before any retry.');
    }
  }
  console.error('Administrator bootstrap failed. Inspect the database state; do not retry automatically.');
  console.error(error?.code ?? error?.message ?? 'PRODUCTION_ADMIN_BOOTSTRAP_FAILED');
  process.exitCode = 1;
} finally {
  if (connection) connection.release();
  try {
    await pool.end();
  } catch {
    console.error('Could not confirm closure of the bootstrap database pool.');
    process.exitCode = 1;
  }
}

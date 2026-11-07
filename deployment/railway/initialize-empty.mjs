// Explicit one-off initialization. Never called automatically by start or deploy.
import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const env = process.env;
if (process.argv.slice(2).join(' ') !== '--initialize-new-railway-test' || env.RAILWAY_ENVIRONMENT_NAME !== 'private-test' || !env.DB_HOST?.endsWith('.railway.internal') || env.DB_PORT !== '3306' || env.DB_NAME !== 'planes_accion_railway_test' || !env.BOOTSTRAP_DB_USER || !env.BOOTSTRAP_DB_PASSWORD || !env.DB_PASSWORD || !env.SESSION_DB_PASSWORD) throw new Error('Inicialización cancelada: destino o confirmación no válidos.');
const schema = await readFile(new URL('../../schema/through-block-f.sql', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../../schema/through-block-f.json', import.meta.url), 'utf8'));
if (createHash('sha256').update(schema).digest('hex') !== manifest.sha256) throw new Error('El esquema no coincide con su manifiesto.');
const connection = await mysql.createConnection({host: env.DB_HOST, port: 3306, database: env.DB_NAME, user: env.BOOTSTRAP_DB_USER, password: env.BOOTSTRAP_DB_PASSWORD, multipleStatements: true});
try {
  const [[destination]] = await connection.query('SELECT DATABASE() AS name, @@port AS port');
  const [[tables]] = await connection.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE()');
  if (destination.name !== env.DB_NAME || Number(destination.port) !== 3306 || Number(tables.n) !== 0) throw new Error('Se requiere exclusivamente una base cloud nueva y vacía.');
  // DDL is not transactional in MySQL. On any failure: stop, inspect, never retry on a nonempty schema.
  await connection.query(schema);
  await connection.query(await readFile(new URL('web-sessions.up.sql', import.meta.url), 'utf8'));
  await connection.execute('INSERT INTO rol_autorizacion_mutex (mutex_id) VALUES (?)', [1]);
  await connection.query("CREATE USER 'planes_backend'@'%' IDENTIFIED BY ?", [env.DB_PASSWORD]);
  await connection.query("CREATE USER 'planes_web_sessions'@'%' IDENTIFIED BY ?", [env.SESSION_DB_PASSWORD]);
  const [names] = await connection.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE()');
  for (const {name} of names) {
    const account = name === 'web_sessions' ? 'planes_web_sessions' : 'planes_backend';
    // MySQL requires TRIGGER privilege to expose trigger metadata used by the
    // existing fail-closed schema checks. No CREATE/ALTER/DROP table privileges.
    const privileges = account === 'planes_backend' ? 'SELECT, INSERT, UPDATE, DELETE, TRIGGER' : 'SELECT, INSERT, UPDATE, DELETE';
    await connection.query('GRANT ' + privileges + ' ON ?? . ?? TO ' + connection.escape(account) + "@'%'", [env.DB_NAME, name]);
  }
  const [[counts]] = await connection.query('SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()) AS tables_count, (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE()) AS fks, (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE()) AS triggers_count');
  if (Number(counts.tables_count) !== 44 || Number(counts.fks) !== 86 || Number(counts.triggers_count) !== 20) throw new Error('Estructura incompleta: detener activación.');
  console.log('Base cloud inicializada: 44 tablas, 86 relaciones, 20 disparadores. Sin cuentas ni registros institucionales.');
} catch {
  console.error('Inicialización detenida. Revisar el estado con el administrador; no reintentar ni ejecutar DOWN automáticamente.');
  process.exitCode = 1;
} finally { await connection.end(); }

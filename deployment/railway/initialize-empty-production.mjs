import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateProductionSchemaInitialization} from './production-policy.js';

const SESSION_SCHEMA_SHA256 = '41e69f3143b23c3cd33fadf3b95e07f233363e6dce6ef372ddd29b23df125f9d';
const env = process.env;
const target = validateProductionSchemaInitialization(env, process.argv.slice(2));
const schema = await readFile(new URL('../../schema/through-block-f.sql', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../../schema/through-block-f.json', import.meta.url), 'utf8'));
const sessionSchema = await readFile(new URL('web-sessions.up.sql', import.meta.url), 'utf8');

if (createHash('sha256').update(schema).digest('hex') !== manifest.sha256 ||
    createHash('sha256').update(sessionSchema).digest('hex') !== SESSION_SCHEMA_SHA256 ||
    manifest.tables !== 43 || manifest.foreignKeys !== 86 || manifest.triggers !== 20 ||
    !manifest.definitions || Object.keys(manifest.definitions).length !== 43) {
  throw new Error('PRODUCTION_SCHEMA_INTEGRITY_CHECK_FAILED');
}

let connection;
let lockAcquired = false;
try {
  connection = await mysql.createConnection({
    host: target.host,
    port: 3306,
    database: target.database,
    user: env.BOOTSTRAP_DB_USER,
    password: env.BOOTSTRAP_DB_PASSWORD,
    multipleStatements: true
  });

  const [[lock]] = await connection.query(
    'SELECT GET_LOCK(?, 0) AS acquired',
    ['planes-accion-production-schema-initialization']
  );
  if (Number(lock.acquired) !== 1) throw new Error('PRODUCTION_INITIALIZATION_ALREADY_RUNNING');
  lockAcquired = true;

  const [[destination]] = await connection.query('SELECT DATABASE() AS name, @@port AS port');
  const [[tableCount]] = await connection.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()'
  );
  const [technicalAccounts] = await connection.query(
    'SELECT COUNT(*) AS n FROM mysql.user WHERE user IN (?, ?)',
    ['planes_backend', 'planes_web_sessions']
  );
  if (destination.name !== target.database ||
      Number(destination.port) !== 3306 ||
      Number(tableCount.n) !== 0 ||
      Number(technicalAccounts[0]?.n) !== 0) {
    throw new Error('PRODUCTION_DATABASE_MUST_BE_NEW_AND_EMPTY');
  }

  await connection.query(schema);
  await connection.query(sessionSchema);
  await connection.execute('INSERT INTO rol_autorizacion_mutex (mutex_id) VALUES (?)', [1]);
  await connection.query("CREATE USER 'planes_backend'@'%' IDENTIFIED BY ?", [env.DB_PASSWORD]);
  await connection.query("CREATE USER 'planes_web_sessions'@'%' IDENTIFIED BY ?", [env.SESSION_DB_PASSWORD]);

  const [tables] = await connection.query(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
  );
  const expectedTables = [...Object.keys(manifest.definitions), 'web_sessions'].sort();
  const actualTables = tables.map(({name}) => name).sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new Error('PRODUCTION_SCHEMA_TABLE_SET_MISMATCH');
  }

  for (const {name} of tables) {
    const account = name === 'web_sessions' ? 'planes_web_sessions' : 'planes_backend';
    const privileges = account === 'planes_backend'
      ? 'SELECT, INSERT, UPDATE, DELETE, TRIGGER'
      : 'SELECT, INSERT, UPDATE, DELETE';
    await connection.query(
      'GRANT ' + privileges + ' ON ?? . ?? TO ' + connection.escape(account) + "@'%'",
      [target.database, name]
    );
  }

  const [[counts]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()) AS tables_count,
       (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()) AS fks,
       (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE()) AS triggers_count`
  );
  if (Number(counts.tables_count) !== 44 ||
      Number(counts.fks) !== 86 ||
      Number(counts.triggers_count) !== 20) {
    throw new Error('PRODUCTION_SCHEMA_POSTCHECK_FAILED');
  }

  console.info('Production schema initialized: 44 tables, 86 foreign keys, 20 triggers.');
} catch (error) {
  console.error('Production schema initialization stopped. Preserve the current database state; do not retry or run DOWN automatically.');
  const diagnostic = typeof error?.code === 'string'
    ? error.code
    : typeof error?.message === 'string' && /^PRODUCTION_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'PRODUCTION_SCHEMA_INITIALIZATION_FAILED';
  console.error(diagnostic);
  process.exitCode = 1;
} finally {
  if (connection) {
    if (lockAcquired) {
      try {
        await connection.query(
          'SELECT RELEASE_LOCK(?)',
          ['planes-accion-production-schema-initialization']
        );
      } catch {
        console.error('Could not confirm release of the initialization lock.');
        process.exitCode = 1;
      }
    }
    try {
      await connection.end();
    } catch {
      console.error('Could not confirm closure of the initialization database connection.');
      process.exitCode = 1;
    }
  }
}

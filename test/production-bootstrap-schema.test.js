import assert from 'node:assert/strict';
import test from 'node:test';
import {assertPristineSchema} from '../deployment/railway/production-bootstrap-schema.js';

const databaseName = 'planes_accion_production';
const applicationTables = [
  'rol_autorizacion_mutex',
  'usuario',
  ...Array.from({length: 41}, (_, index) => `application_table_${index + 1}`)
].sort();
const manifest = {definitions: Object.fromEntries(applicationTables.map((name) => [name, {}]))};

function createConnections({
  applicationCounts = {tables_count: 43, fks: 86, triggers_count: 20},
  applicationRows = {},
  sessionRows = 0,
  sessionTable = true
} = {}) {
  const applicationCalls = [];
  const sessionCalls = [];
  const applicationTx = {
    async execute(sql) {
      applicationCalls.push(sql);
      if (sql.includes('SELECT DATABASE()')) return [[{name: databaseName, port: 3306}]];
      if (sql.includes('referential_constraints')) {
        return [[applicationCounts]];
      }
      if (sql.includes('information_schema.tables')) {
        return [applicationTables.map((name) => ({name}))];
      }
      throw new Error(`Unexpected application execute: ${sql}`);
    },
    async query(sql) {
      applicationCalls.push(sql);
      const table = sql.match(/FROM `([a-z0-9_]+)`/)?.[1];
      return [[{n: applicationRows[table] ?? (table === 'rol_autorizacion_mutex' ? 1 : 0)}]];
    }
  };
  const sessionConnection = {
    async execute(sql) {
      sessionCalls.push(sql);
      if (sql.includes('SELECT DATABASE()')) return [[{name: databaseName, port: 3306}]];
      if (sql.includes('information_schema.tables')) {
        return [sessionTable ? [{name: 'web_sessions', type: 'BASE TABLE'}] : []];
      }
      throw new Error(`Unexpected session execute: ${sql}`);
    },
    async query(sql) {
      sessionCalls.push(sql);
      return [[{n: sessionRows}]];
    }
  };
  return {applicationTx, sessionConnection, applicationCalls, sessionCalls};
}

test('validates all application tables and checks web_sessions using its owning account', async () => {
  const connections = createConnections();

  assert.deepEqual(await assertPristineSchema({
    ...connections,
    databaseName,
    manifest
  }), {tables: 44, foreignKeys: 86, triggers: 20});
  assert.equal(
    connections.applicationCalls.some((sql) => /web_sessions/i.test(sql)),
    false,
    'planes_backend must not query web_sessions or its metadata'
  );
  assert.equal(
    connections.sessionCalls.some((sql) => /COUNT\(\*\).*web_sessions/i.test(sql)),
    true,
    'the session account must verify that its table is empty'
  );
});

test('rejects a non-empty or missing session table using the session account', async () => {
  await assert.rejects(
    assertPristineSchema({
      ...createConnections({sessionRows: 1}),
      databaseName,
      manifest
    }),
    {message: 'PRODUCTION_ADMIN_BOOTSTRAP_REQUIRES_EMPTY_SCHEMA'}
  );
  await assert.rejects(
    assertPristineSchema({
      ...createConnections({sessionTable: false}),
      databaseName,
      manifest
    }),
    {message: 'PRODUCTION_ADMIN_BOOTSTRAP_SCHEMA_MISMATCH'}
  );
});

test('rejects incomplete application schema counts and contents', async () => {
  const incompleteManifest = {
    definitions: Object.fromEntries(applicationTables.slice(0, -1).map((name) => [name, {}]))
  };
  await assert.rejects(
    assertPristineSchema({
      ...createConnections(),
      databaseName,
      manifest: incompleteManifest
    }),
    {message: 'PRODUCTION_ADMIN_BOOTSTRAP_SCHEMA_MISMATCH'}
  );
  for (const applicationCounts of [
    {tables_count: 42, fks: 86, triggers_count: 20},
    {tables_count: 43, fks: 85, triggers_count: 20},
    {tables_count: 43, fks: 86, triggers_count: 19}
  ]) {
    await assert.rejects(
      assertPristineSchema({
        ...createConnections({applicationCounts}),
        databaseName,
        manifest
      }),
      {message: 'PRODUCTION_ADMIN_BOOTSTRAP_SCHEMA_MISMATCH'}
    );
  }
  await assert.rejects(
    assertPristineSchema({
      ...createConnections({applicationRows: {usuario: 1}}),
      databaseName,
      manifest
    }),
    {message: 'PRODUCTION_ADMIN_BOOTSTRAP_REQUIRES_EMPTY_SCHEMA'}
  );
});

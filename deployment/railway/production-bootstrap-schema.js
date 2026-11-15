function rows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_INVALID_QUERY_RESULT');
  }
  return result[0];
}

export async function assertPristineSchema({applicationTx, sessionConnection, databaseName, manifest}) {
  const expectedApplicationTables = Object.keys(manifest.definitions).sort();
  if (expectedApplicationTables.length !== 43) {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_SCHEMA_MISMATCH');
  }
  const tablePlaceholders = expectedApplicationTables.map(() => '?').join(', ');
  const [[database]] = await applicationTx.execute('SELECT DATABASE() AS name, @@port AS port');
  const [[counts]] = await applicationTx.execute(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN (${tablePlaceholders})) AS tables_count,
       (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()) AS fks,
       (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE()) AS triggers_count`,
    expectedApplicationTables
  );
  const applicationTables = rows(await applicationTx.execute(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN (${tablePlaceholders})`,
    expectedApplicationTables
  )).map(({name}) => name).sort();
  if (database.name !== databaseName || Number(database.port) !== 3306 ||
      Number(counts.tables_count) !== 43 || Number(counts.fks) !== 86 ||
      Number(counts.triggers_count) !== 20 ||
      JSON.stringify(applicationTables) !== JSON.stringify(expectedApplicationTables)) {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_SCHEMA_MISMATCH');
  }

  for (const table of applicationTables) {
    if (!/^[a-z0-9_]+$/.test(table)) {
      throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_INVALID_TABLE_NAME');
    }
    const [[count]] = await applicationTx.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const expectedRows = table === 'rol_autorizacion_mutex' ? 1 : 0;
    if (Number(count.n) !== expectedRows) {
      throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_REQUIRES_EMPTY_SCHEMA');
    }
  }

  const [[sessionDatabase]] = await sessionConnection.execute(
    'SELECT DATABASE() AS name, @@port AS port'
  );
  const sessionTables = rows(await sessionConnection.execute(
    `SELECT table_name AS name, table_type AS type
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'web_sessions'`
  ));
  if (sessionDatabase.name !== databaseName || Number(sessionDatabase.port) !== 3306 ||
      sessionTables.length !== 1 ||
      sessionTables[0].name !== 'web_sessions' ||
      sessionTables[0].type !== 'BASE TABLE') {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_SCHEMA_MISMATCH');
  }
  const [[sessionCount]] = await sessionConnection.query(
    'SELECT COUNT(*) AS n FROM `web_sessions`'
  );
  if (Number(sessionCount.n) !== 0) {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_REQUIRES_EMPTY_SCHEMA');
  }

  return {tables: 44, foreignKeys: 86, triggers: 20};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(new URL(
  '../../migrations/role_permissions_v1.sql', import.meta.url
));

test('role migration defines ten role tables plus the singleton mutex and row', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const statements = sql.replace(/--.*$/gm, '');
  const tableMatches = [...statements.matchAll(/CREATE\s+TABLE\s+`([^`]+)`\s*\(([\s\S]*?)\)\s*ENGINE=InnoDB[^;]*;/gi)];
  const tableNames = tableMatches.map((match) => match[1]);
  const tables = new Map(tableMatches.map((match) => [match[1], match[2]]));
  const expectedTables = [
    'rol_configuracion', 'permiso', 'rol_permiso', 'rol_scope_ref', 'rol_scope_permitido',
    'rol_asignacion', 'rol_solicitud', 'rol_decision', 'rol_delegacion', 'rol_auditoria',
    'rol_autorizacion_mutex'
  ];
  assert.deepEqual(tableNames, expectedTables);
  assert.equal(new Set(tableNames).size, expectedTables.length);
  assert.match(sql, /CREATE TABLE `rol_autorizacion_mutex`\s*\([\s\S]*?`mutex_id` tinyint unsigned NOT NULL[\s\S]*?PRIMARY KEY \(`mutex_id`\)[\s\S]*?CHECK \(`mutex_id` = 1\)[\s\S]*?ENGINE=InnoDB/i);
  assert.match(sql, /INSERT INTO `rol_autorizacion_mutex`\s*\(`mutex_id`\) VALUES \(1\);/i);
  assert.equal((sql.match(/\bINSERT\b/gi) || []).length, 1);

  const foreignKeys = [];
  for (const [sourceTable, body] of tables) {
    for (const match of body.matchAll(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s*`([^`]+)`\s*\(([^)]+)\)\s*ON DELETE RESTRICT\s+ON UPDATE RESTRICT/gi)) {
      foreignKeys.push({ sourceTable, sourceColumns: match[1], targetTable: match[2], targetColumns: match[3] });
    }
  }
  assert.equal(foreignKeys.length, 36);
  const tablePosition = new Map(tableNames.map((name, index) => [name, index]));
  const typeFor = (table, column) => {
    const line = tables.get(table)?.split(/\r?\n/).find((entry) =>
      new RegExp('^\\s*`' + column + '`\\s+', 'i').test(entry));
    const match = line?.match(/^\s*`[^`]+`\s+([a-z]+(?:\(\d+(?:,\d+)?\))?)(?:\s+(unsigned))?/i);
    return match ? `${match[1].toLowerCase()} ${match[2]?.toLowerCase() ?? ''}`.trim() : null;
  };
  for (const fk of foreignKeys) {
    const fromTable = fk.sourceTable;
    const targetTable = fk.targetTable;
    assert.ok(tables.has(targetTable) || ['rol', 'usuario'].includes(targetTable), `Unknown FK target: ${targetTable}`);
    if (tables.has(targetTable)) {
      assert.ok(tablePosition.get(targetTable) < tablePosition.get(fromTable), `${fromTable} must follow ${targetTable}`);
      const fromColumns = fk.sourceColumns.split(',').map((part) => part.trim().replaceAll('`', ''));
      const targetColumns = fk.targetColumns.split(',').map((part) => part.trim().replaceAll('`', ''));
      assert.equal(fromColumns.length, targetColumns.length);
      for (let index = 0; index < fromColumns.length; index += 1) {
        assert.equal(typeFor(fromTable, fromColumns[index]), typeFor(targetTable, targetColumns[index]),
          `FK type mismatch: ${fromTable}.${fromColumns[index]} -> ${targetTable}.${targetColumns[index]}`);
      }
    }
  }
  assert.equal((statements.match(/\bCHECK\s*\(/gi) || []).length > 0, true);
  assert.equal((statements.match(/\bENGINE=InnoDB\b/gi) || []).length, 11);
  const commands = statements.split(';').map((item) => item.trim()).filter(Boolean);
  assert.ok(commands.every((command) => /^CREATE\s+TABLE\b/i.test(command) ||
    /^INSERT\s+INTO\s+`rol_autorizacion_mutex`\s*\(/i.test(command)));
  assert.doesNotMatch(statements, /INSERT INTO `(?!rol_autorizacion_mutex`)/i);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('follow-up/evidence migration is additive, references existing IDs, and contains no data mutation', async () => {
  const sql = await readFile(new URL('../../migrations/20261030_followup_evidence_v1.sql', import.meta.url), 'utf8');
  const created = [...sql.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(created, ['periodo_seguimiento', 'seguimiento_actividad', 'seguimiento_decision', 'evidencia_archivo_meta']);
  assert.match(sql, /REFERENCES usuario \(id_usuario\)/);
  assert.match(sql, /REFERENCES actividad \(id_actividad\)/);
  assert.match(sql, /REFERENCES periodo_seguimiento \(id_periodo\)/);
  assert.match(sql, /REFERENCES evidencia \(id_evidencia\)/);
  assert.doesNotMatch(sql.replace(/ON DELETE RESTRICT ON UPDATE RESTRICT/gi, ''), /\b(ALTER|INSERT|UPDATE|DELETE|DROP)\b/i);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
  assert.match(sql, /ENGINE=InnoDB/);
});

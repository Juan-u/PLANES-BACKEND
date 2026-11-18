import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationDirectory = new URL('../../migrations/', import.meta.url);

test('typed-resource migration creates explicit links without assigning legacy scopes by ID', async () => {
  const up = await readFile(new URL('20261118_role_scope_resources.up.sql', migrationDirectory), 'utf8');
  assert.match(up, /CREATE TABLE rol_scope_recurso/);
  assert.match(up, /FOREIGN KEY \(id_scope_ref\) REFERENCES rol_scope_ref/);
  assert.match(up, /FOREIGN KEY \(id_plan\) REFERENCES plan_accion/);
  assert.match(up, /FOREIGN KEY \(id_actividad, id_plan\) REFERENCES actividad \(id_actividad, id_plan\)/);
  assert.match(up, /tipo_recurso = 'plan' AND id_actividad IS NULL/);
  assert.match(up, /tipo_recurso = 'activity' AND id_actividad IS NOT NULL/);
  assert.doesNotMatch(up, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?rol_scope_(?:ref|recurso)\b/i);
});

test('initial authority migration adds a two-person request log without assigning a user', async () => {
  const up = await readFile(new URL('20261119_initial_scope_authority.up.sql', migrationDirectory), 'utf8');
  assert.match(up, /CREATE TABLE rol_scope_authority_request/);
  assert.match(up, /referencia_institucional VARCHAR\(255\) NOT NULL/);
  assert.match(up, /referencia_decision VARCHAR\(255\) NULL/);
  assert.match(up, /id_usuario_solicitante INT NOT NULL/);
  assert.match(up, /id_usuario_decisor INT NULL/);
  assert.match(up, /scope_authority_manager/);
  assert.match(up, /M01\.roles\.manage_scope/);
  assert.doesNotMatch(up, /INSERT\s+INTO\s+rol_asignacion/i);
  assert.doesNotMatch(up, /INSERT\s+INTO\s+rol_scope_permitido/i);
  assert.doesNotMatch(up, /INSERT\s+INTO\s+rol_scope_recurso/i);
  assert.doesNotMatch(up, /(?:UPDATE|DELETE)\s+(?:rol_asignacion|rol_scope_ref|rol_scope_recurso)\b/i);
});

test('rollback removes only the new typed-resource relation table', async () => {
  const down = await readFile(new URL('20261118_role_scope_resources.down.sql', migrationDirectory), 'utf8');
  assert.match(down, /^\s*--[\s\S]*DROP TABLE rol_scope_recurso;\s*$/);
  assert.doesNotMatch(down, /DROP TABLE rol_scope_ref|DELETE FROM rol_asignacion/i);
});

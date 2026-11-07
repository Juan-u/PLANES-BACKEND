import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvidenceController } from '../../app/controllers/controller.evidence.js';

function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, type(value) { this.contentType = value; return this; }, attachment(value) { this.filename = value; return this; }, send(body) { this.body = body; return this; } }; }
function setup({ failMetadata = false } = {}) {
  const calls = [];
  const connection = { async query(){throw Object.assign(new Error(),{code:'ER_NO_SUCH_TABLE'});}, async beginTransaction() {}, async execute(sql, params) { calls.push({ sql, params }); if (sql.startsWith('SELECT id_actividad')) return [[{ id_actividad: 2 }], []]; if (sql.startsWith('INSERT INTO evidencia (')) return [{ insertId: 7 }, []]; if (failMetadata && sql.startsWith('INSERT INTO evidencia_archivo_meta')) throw new Error('private DB detail'); return [{ insertId: 1 }, []]; }, async commit() {}, async rollback() { calls.push({ rollback: true }); }, release() {} };
  const pool = { async query(sql, params) { calls.push({ sql, params }); return [[{ id_evidencia: 7, storage_key: '123e4567-e89b-42d3-a456-426614174000', nombre_original: 'x.txt', mime_type: 'text/plain', bytes: 3, sha256: 'hash' }], []]; }, async getConnection() { return connection; } };
  const store = { async save(input) { calls.push({ save: input }); return { storageKey: '123e4567-e89b-42d3-a456-426614174000', originalName: 'x.txt', mimeType: 'text/plain', bytes: 3, sha256: 'hash' }; }, async read() { return Buffer.from('abc'); }, async remove(input) { calls.push({ remove: input }); } };
  return { controller: createEvidenceController({ pool, storage: store }), calls };
}

test('uploads an allowed evidence and atomically links file metadata to an activity', async () => {
  const { controller, calls } = setup();
  const res = response();
  await controller.upload({ usuario: { sub: '9' }, body: { id_actividad: '2', nombre_original: 'x.txt', mime_type: 'text/plain', contenido_base64: 'YWJj', observaciones: 'nota' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.id_evidencia, 7);
  assert.equal(calls.some((call) => call.sql?.startsWith('INSERT INTO evidencia_archivo_meta')), true);
  assert.equal(calls.some((call) => call.sql?.startsWith('INSERT INTO historico')), true);
});

test('cleans the file when metadata persistence fails', async () => {
  const { controller, calls } = setup({ failMetadata: true });
  const res = response();
  await controller.upload({ usuario: { sub: '9' }, body: { id_actividad: 2, nombre_original: 'x.txt', mime_type: 'text/plain', contenido_base64: 'YWJj' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(calls.some((call) => call.rollback), true);
  assert.equal(calls.some((call) => call.remove), true);
  assert.doesNotMatch(JSON.stringify(res.body), /private DB detail/);
});

test('downloads only metadata-backed file content and rejects absent evidence', async () => {
  const { controller } = setup();
  const res = response();
  await controller.download({ params: { id: '7' } }, res);
  assert.equal(res.filename, 'x.txt');
  assert.equal(res.contentType, 'text/plain');
  assert.equal(res.body.toString(), 'abc');
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createEvidenceStorage, MAX_EVIDENCE_BYTES } from '../../app/services/evidence-storage.service.js';

const key = '123e4567-e89b-42d3-a456-426614174000';

test('saves under a generated private key and verifies hash and size on read', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pa-evidence-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createEvidenceStorage({ directory, ids: { next: () => key } });
  const saved = await storage.save({ originalName: 'folder\\nota.txt', mimeType: 'text/plain', base64: Buffer.from('Hello').toString('base64') });
  assert.equal(saved.originalName, 'nota.txt');
  assert.equal(saved.bytes, 5);
  assert.equal((await storage.read({ storageKey: saved.storageKey, mimeType: saved.mimeType, expectedBytes: saved.bytes, expectedSha256: saved.sha256 })).toString(), 'Hello');
  await assert.rejects(storage.read({ storageKey: saved.storageKey, mimeType: saved.mimeType, expectedBytes: 4, expectedSha256: saved.sha256 }));
});

test('rejects unsupported MIME, malformed encoding, oversized bytes and unsafe IDs', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pa-evidence-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createEvidenceStorage({ directory, ids: { next: () => key } });
  await assert.rejects(storage.save({ originalName: 'x.exe', mimeType: 'application/octet-stream', base64: 'eA==' }), TypeError);
  await assert.rejects(storage.save({ originalName: 'x.txt', mimeType: 'text/plain', base64: '%%%=' }), TypeError);
  await assert.rejects(storage.save({ originalName: 'x.txt', mimeType: 'text/plain', base64: Buffer.alloc(MAX_EVIDENCE_BYTES + 1).toString('base64') }), RangeError);
  await assert.rejects(storage.save({ originalName: 'spoof.pdf', mimeType: 'application/pdf', base64: Buffer.from('not a pdf').toString('base64') }), TypeError);
  await assert.rejects(storage.read({ storageKey: '../outside', mimeType: 'text/plain', expectedBytes: 1, expectedSha256: 'x' }), TypeError);
});

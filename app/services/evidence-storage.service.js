import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const LEGACY_EVIDENCE_BYTES = 65_536;
export const EVIDENCE_TYPES = Object.freeze({
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'text/plain': 'txt'
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeName(value) {
  if (typeof value !== 'string') return null;
  const basename = value.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!basename || basename.length > 255 || basename === '.' || basename === '..') return null;
  return basename;
}

function matchesMime(bytes, mimeType) {
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'text/plain') {
    if (bytes.includes(0)) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
  }
  return false;
}

export function createEvidenceStorage({ directory = process.env.EVIDENCE_STORAGE_DIR || path.resolve(process.cwd(), 'storage', 'evidence'), ids = { next: randomUUID } } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof ids?.next !== 'function') {
    throw new TypeError('An absolute private directory and UUID generator are required.');
  }
  const root = path.resolve(directory);
  function filePath(key, mime) {
    if (typeof key !== 'string' || !UUID.test(key) || !Object.hasOwn(EVIDENCE_TYPES, mime)) throw new TypeError('Invalid evidence storage reference.');
    return path.join(root, `${key}.${EVIDENCE_TYPES[mime]}`);
  }
  return Object.freeze({
    async save({ originalName, mimeType, base64 }) {
      const name = safeName(originalName);
      if (!name || !Object.hasOwn(EVIDENCE_TYPES, mimeType) || typeof base64 !== 'string' || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
        throw new TypeError('Invalid evidence payload.');
      }
      if(base64.length>4*Math.ceil(MAX_EVIDENCE_BYTES/3))throw new RangeError('Evidence size is invalid.');
      const bytes = Buffer.from(base64, 'base64');
      if (!bytes.length || bytes.length > MAX_EVIDENCE_BYTES || bytes.toString('base64') !== base64) throw new RangeError('Evidence size or encoding is invalid.');
      if (!matchesMime(bytes, mimeType)) throw new TypeError('File content does not match its declared MIME type.');
      const key = ids.next();
      if (typeof key !== 'string' || !UUID.test(key)) throw new TypeError('Evidence ID provider must return a UUID.');
      await mkdir(root, { recursive: true, mode: 0o700 });
      const destination = filePath(key, mimeType);
      await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
      return { storageKey: key, originalName: name, mimeType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), destination };
    },
    async saveBytes({originalName,mimeType,bytes}) {
      const name=safeName(originalName),extension=path.extname(name||'').toLowerCase();
      const allowed={'application/pdf':['.pdf'],'image/png':['.png'],'image/jpeg':['.jpg','.jpeg'],'text/plain':['.txt']};
      if(!name||!allowed[mimeType]?.includes(extension)||!Buffer.isBuffer(bytes))throw new TypeError('Invalid evidence file name or type.');
      if(!bytes.length||bytes.length>MAX_EVIDENCE_BYTES)throw new RangeError('Evidence size is invalid.');
      if(!matchesMime(bytes,mimeType))throw new TypeError('File content does not match MIME type.');
      const key=ids.next();const destination=filePath(key,mimeType);
      await mkdir(root,{recursive:true,mode:0o700});await writeFile(destination,bytes,{flag:'wx',mode:0o600});
      return {storageKey:key,originalName:name,mimeType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),destination};
    },
    async read({ storageKey, mimeType, expectedBytes, expectedSha256 }) {
      const bytes = await readFile(filePath(storageKey, mimeType));
      if (bytes.length !== expectedBytes || createHash('sha256').update(bytes).digest('hex') !== expectedSha256) {
        throw new Error('Stored evidence integrity check failed.');
      }
      return bytes;
    },
    async remove({ storageKey, mimeType }) {
      await rm(filePath(storageKey, mimeType), { force: true });
    }
  });
}

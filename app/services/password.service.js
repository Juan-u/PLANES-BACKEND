import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback);

const VERSION = 'v1';
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_PASSWORD_BYTES = 1_024;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const HASH_PATTERN = /^scrypt\$v1\$N=16384,r=8,p=1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;

function validatePassword(password) {
  if (typeof password !== 'string') {
    throw new TypeError('La contraseña debe ser texto.');
  }

  const passwordBytes = Buffer.byteLength(password, 'utf8');
  if (passwordBytes === 0 || passwordBytes > MAX_PASSWORD_BYTES) {
    throw new RangeError('La contraseña no cumple los límites permitidos.');
  }
}

function decodeCanonicalBase64Url(value) {
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

async function deriveKey(password, salt) {
  try {
    return await scrypt(password, salt, KEY_BYTES, {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
      maxmem: MAX_MEMORY_BYTES
    });
  } catch {
    throw new Error('No fue posible procesar la contraseña.');
  }
}

/** Generates a versioned scrypt hash suitable for storage. */
export async function hashPassword(password) {
  validatePassword(password);

  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(password, salt);

  return [
    'scrypt',
    VERSION,
    `N=${COST},r=${BLOCK_SIZE},p=${PARALLELIZATION}`,
    salt.toString('base64url'),
    derivedKey.toString('base64url')
  ].join('$');
}

/** Returns false for incorrect passwords and unsupported or malformed hashes. */
export async function verifyPassword(password, encodedHash) {
  validatePassword(password);

  if (typeof encodedHash !== 'string') {
    return false;
  }

  const match = HASH_PATTERN.exec(encodedHash);
  if (!match) {
    return false;
  }

  const salt = decodeCanonicalBase64Url(match[1]);
  const expectedKey = decodeCanonicalBase64Url(match[2]);
  if (!salt || salt.length !== SALT_BYTES || !expectedKey || expectedKey.length !== KEY_BYTES) {
    return false;
  }

  const actualKey = await deriveKey(password, salt);
  return timingSafeEqual(actualKey, expectedKey);
}

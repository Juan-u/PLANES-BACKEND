import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

process.env.JWT_SECRET = randomBytes(48).toString('base64url');
const { validateJwtSecret } = await import('../../app/config/auth.js');

test('JWT secret validation accepts at least 32 bytes', () => {
  const validSecret = randomBytes(32).toString('base64url');

  assert.equal(validateJwtSecret(validSecret), validSecret);
});

test('JWT secret validation rejects missing, non-string, and weak values', () => {
  for (const invalidSecret of [undefined, null, '', 'a'.repeat(31), 'A'.repeat(43)]) {
    assert.throws(
      () => validateJwtSecret(invalidSecret),
      { message: 'JWT_SECRET debe ser una clave Base64URL de al menos 32 bytes.' }
    );
  }
});

test('JWT secret validation requires canonical Base64URL encoding', () => {
  const validSecret = randomBytes(32).toString('base64url');

  assert.throws(() => validateJwtSecret(`${validSecret}=`));
});

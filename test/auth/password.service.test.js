import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../../app/services/password.service.js';

test('hash includes an explicit algorithm version and parameters', async () => {
  const encodedHash = await hashPassword('sample-password-for-test');

  assert.match(
    encodedHash,
    /^scrypt\$v1\$N=16384,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/
  );
});

test('each generated hash uses a distinct random salt', async () => {
  const firstHash = await hashPassword('sample-password-for-test');
  const secondHash = await hashPassword('sample-password-for-test');

  assert.notEqual(firstHash, secondHash);
});

test('verification accepts the matching password and rejects a different one', async () => {
  const encodedHash = await hashPassword('sample-password-for-test');

  assert.equal(await verifyPassword('sample-password-for-test', encodedHash), true);
  assert.equal(await verifyPassword('different-sample-password', encodedHash), false);
});

test('verification rejects malformed, unsupported, and modified hashes', async () => {
  const encodedHash = await hashPassword('sample-password-for-test');
  const parts = encodedHash.split('$');
  const modifiedHash = [...parts.slice(0, 4), `${parts[4][0] === 'A' ? 'B' : 'A'}${parts[4].slice(1)}`].join('$');

  for (const malformedHash of [
    '',
    'legacy-format',
    encodedHash.replace('$v1$', '$v2$'),
    encodedHash.replace('N=16384,r=8,p=1', 'N=1,r=1,p=1'),
    encodedHash.replace(parts[3], 'invalid-salt'),
    modifiedHash
  ]) {
    assert.equal(await verifyPassword('sample-password-for-test', malformedHash), false);
  }
});

test('hashing and verification reject invalid password inputs', async () => {
  for (const invalidPassword of ['', 'x'.repeat(1_025), null, 123]) {
    await assert.rejects(hashPassword(invalidPassword));
    await assert.rejects(verifyPassword(invalidPassword, 'malformed-hash'));
  }
});

test('verification rejects non-string hash inputs', async () => {
  assert.equal(await verifyPassword('sample-password-for-test', null), false);
});

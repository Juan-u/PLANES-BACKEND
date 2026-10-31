import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLE_PERMISSION_CATALOG } from '../../app/config/role-permission-matrix.js';
import { validateRoleBootstrapEnvironment } from '../../scripts/bootstrap-role-permissions.dev.js';

function validEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'development', ROLE_PERMISSION_BOOTSTRAP_CONFIRM: 'SEED_DEVELOPMENT_ROLE_PERMISSIONS',
    DB_HOST: '127.0.0.1', DB_NAME: 'planes_accion_dev', DB_USER: 'planes_dev', DB_PASSWORD: 'provided-only-by-test',
    ROLE_BOOTSTRAP_ADMIN_PRIMARY_ID: '17', ROLE_BOOTSTRAP_ADMIN_SECONDARY_ID: '18',
    ROLE_BOOTSTRAP_ADMIN_PRIMARY_NAME: 'Erick test account', ROLE_BOOTSTRAP_ADMIN_SECONDARY_NAME: 'Juan Esteban test account',
    ROLE_BOOTSTRAP_TEST_USERS_JSON: JSON.stringify(ROLE_PERMISSION_CATALOG.roles.map((role, index) => ({
      roleCode: role.code, name: `Test User ${index + 1}`, email: `test-${index + 1}@example.test`,
      password: 'x'.repeat(14), ...(role.requiresScope ? { scopeRefId: '3' } : {})
    }))),
    ...overrides
  };
}

test('bootstrap validation requires a local development database and explicit confirmation', () => {
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ NODE_ENV: 'production' })), /DEVELOPMENT_ONLY/);
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ DB_HOST: 'db.example.test' })), /LOCAL_DATABASE_ONLY/);
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ DB_NAME: 'planes_accion' })), /DATABASE_NAME_NOT_ALLOWED/);
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ ROLE_PERMISSION_BOOTSTRAP_CONFIRM: '' })), /CONFIRMATION_REQUIRED/);
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ DB_USER: 'root' })), /DATABASE_ACCOUNT_REQUIRED/);
});

test('bootstrap validation requires two distinct configured admin accounts and one credential-supplied test account per role', () => {
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ ROLE_BOOTSTRAP_ADMIN_SECONDARY_ID: '17' })), /TWO_DISTINCT_ADMINS/);
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ ROLE_BOOTSTRAP_ADMIN_PRIMARY_NAME: '' })), /ADMIN_IDENTITY_NAMES_REQUIRED/);
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ ROLE_BOOTSTRAP_TEST_USERS_JSON: '[]' })), /ONE_TEST_USER_PER_ROLE/);
  const cfg = validateRoleBootstrapEnvironment(validEnvironment());
  assert.equal(cfg.users.length, ROLE_PERMISSION_CATALOG.roles.length);
  assert.equal(cfg.users[0].password, 'x'.repeat(14));
});

test('bootstrap validation refuses scoped test roles without an operator-supplied existing scope reference', () => {
  const users = JSON.parse(validEnvironment().ROLE_BOOTSTRAP_TEST_USERS_JSON);
  users.find((user) => ROLE_PERMISSION_CATALOG.roles.find((role) => role.code === user.roleCode).requiresScope).scopeRefId = undefined;
  assert.throws(() => validateRoleBootstrapEnvironment(validEnvironment({ ROLE_BOOTSTRAP_TEST_USERS_JSON: JSON.stringify(users) })), /TEST_USER_ENTRY_INVALID/);
});

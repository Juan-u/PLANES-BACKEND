import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_ADMIN_BOOTSTRAP_CONFIRMATION,
  validateProductionAdministratorBootstrap,
  validateProductionSchemaInitialization,
  validateProductionTarget
} from '../deployment/railway/production-policy.js';

const base = {
  DEPLOYMENT_PROFILE: 'railway-production',
  NODE_ENV: 'production',
  RAILWAY_PROJECT_NAME: 'courteous-grace',
  RAILWAY_ENVIRONMENT_NAME: 'production',
  PRODUCTION_MYSQL_SERVICE_NAME: 'MySQL-EZwX',
  PRODUCTION_DB_HOST: 'mysql-production.railway.internal',
  PRODUCTION_DB_NAME: 'planes_accion_production',
  DB_HOST: 'mysql-production.railway.internal',
  DB_PORT: '3306',
  DB_NAME: 'planes_accion_production',
  DB_USER: 'planes_backend',
  DB_PASSWORD: 'synthetic-only'
};

const adminAccounts = [
  {name: 'Admin One', email: 'admin-one@example.invalid', password: 'synthetic-password-one'},
  {name: 'Admin Two', email: 'admin-two@example.invalid', password: 'synthetic-password-two'}
];

test('production destination validation is exact and read-only', () => {
  assert.deepEqual(validateProductionTarget(base), {
    host: base.PRODUCTION_DB_HOST,
    database: base.PRODUCTION_DB_NAME
  });
  for (const override of [
    {RAILWAY_PROJECT_NAME: 'another-project'},
    {RAILWAY_ENVIRONMENT_NAME: 'private-test'},
    {PRODUCTION_MYSQL_SERVICE_NAME: 'another-mysql'},
    {DB_HOST: 'mysql-other.railway.internal'},
    {PRODUCTION_DB_HOST: 'localhost'},
    {PRODUCTION_DB_NAME: 'REPLACE_WITH_THE_EXACT_DATABASE_NAME_FROM_RAILWAY', DB_NAME: 'REPLACE_WITH_THE_EXACT_DATABASE_NAME_FROM_RAILWAY'},
    {DB_NAME: 'planes_accion_test'},
    {DB_PORT: '3307'}
  ]) assert.throws(() => validateProductionTarget({...base, ...override}));
});

test('schema initialization requires the exact one-shot command and temporary credentials', () => {
  const environment = {
    ...base,
    BOOTSTRAP_DB_USER: 'temporary_admin',
    BOOTSTRAP_DB_PASSWORD: 'synthetic-only',
    SESSION_DB_PASSWORD: 'synthetic-only'
  };
  assert.equal(
    validateProductionSchemaInitialization(environment, ['--initialize-new-railway-production']).database,
    base.DB_NAME
  );
  assert.throws(() => validateProductionSchemaInitialization(environment, ['--initialize-new-railway-test']));
  assert.throws(() => validateProductionSchemaInitialization({...environment, BOOTSTRAP_DB_USER: 'planes_backend'}, ['--initialize-new-railway-production']));
  assert.throws(() => validateProductionSchemaInitialization({...environment, DB_NAME: 'other'}, ['--initialize-new-railway-production']));
});

test('administrator bootstrap requires two unique approved accounts and a reference', () => {
  const environment = {
    ...base,
    PRODUCTION_ADMIN_BOOTSTRAP_CONFIRMATION,
    SESSION_DB_PASSWORD: 'synthetic-only',
    PRODUCTION_ADMIN_APPROVAL_REFERENCE: 'APPROVAL-123',
    PRODUCTION_ADMIN_ACCOUNTS_JSON: JSON.stringify(adminAccounts)
  };
  const validated = validateProductionAdministratorBootstrap(
    environment,
    ['--create-authorized-production-admins']
  );
  assert.equal(validated.admins.length, 2);
  assert.equal(validated.admins[0].email, 'admin-one@example.invalid');
  assert.throws(() => validateProductionAdministratorBootstrap(
    {...environment, SESSION_DB_PASSWORD: ''},
    ['--create-authorized-production-admins']
  ), {message: 'PRODUCTION_SESSION_DATABASE_CREDENTIALS_REQUIRED'});
  assert.throws(() => validateProductionAdministratorBootstrap(environment, []));
  assert.throws(() => validateProductionAdministratorBootstrap({...environment, PRODUCTION_ADMIN_APPROVAL_REFERENCE: ''}, ['--create-authorized-production-admins']));
  assert.throws(() => validateProductionAdministratorBootstrap({
    ...environment,
    PRODUCTION_ADMIN_ACCOUNTS_JSON: JSON.stringify([adminAccounts[0], {...adminAccounts[1], email: 'ADMIN-ONE@example.invalid'}])
  }, ['--create-authorized-production-admins']));
  assert.throws(() => validateProductionAdministratorBootstrap({
    ...environment,
    PRODUCTION_ADMIN_ACCOUNTS_JSON: JSON.stringify([adminAccounts[0], {...adminAccounts[1], password: 'short'}])
  }, ['--create-authorized-production-admins']));
  assert.throws(() => validateProductionAdministratorBootstrap({
    ...environment,
    PRODUCTION_ADMIN_ACCOUNTS_JSON: JSON.stringify([adminAccounts[0], {...adminAccounts[1], password: adminAccounts[0].password}])
  }, ['--create-authorized-production-admins']));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {railwayConfiguration} from '../app/config/railway-profile.js';
import {PRODUCTION_ROLE_PERMISSION_CONFIRMATION} from '../app/config/railway-profile.js';
const valid = {DEPLOYMENT_PROFILE: 'railway-private-test', NODE_ENV: 'staging', DB_HOST: 'mysql.railway.internal', DB_PORT: '3306', DB_NAME: 'planes_accion_railway_test', DB_USER: 'planes_backend', DB_PASSWORD: 'synthetic-only', ENABLE_ROLE_PERMISSION_ROUTES: 'true', EVIDENCE_STORAGE_DIR: '/data/evidence', RAILWAY_VOLUME_MOUNT_PATH: '/data/evidence'};
test('backend local profile is unchanged', () => assert.equal(railwayConfiguration({}), null));
test('backend private test is explicitly staging', () => assert.equal(railwayConfiguration(valid).database, 'planes_accion_railway_test'));
test('backend fails closed for commercial targets, root, missing volumes or production', () => {
  for (const override of [{DB_HOST: '127.0.0.1'}, {DB_PORT: '3307'}, {DB_NAME: 'planes_accion_test'}, {DB_USER: 'root'}, {RAILWAY_VOLUME_MOUNT_PATH: ''}, {EVIDENCE_STORAGE_DIR: '/tmp'}, {NODE_ENV: 'production'}, {ENABLE_ROLE_PERMISSION_ROUTES: 'false'}, {DEPLOYMENT_PROFILE: 'other'}]) assert.throws(() => railwayConfiguration({...valid, ...override}));
});
test('backend production profile requires exact Railway target and keeps role-assignment routes disabled', () => {
  const production = {
    DEPLOYMENT_PROFILE: 'railway-production', NODE_ENV: 'production',
    RAILWAY_PROJECT_NAME: 'courteous-grace', RAILWAY_ENVIRONMENT_NAME: 'production',
    PRODUCTION_MYSQL_SERVICE_NAME: 'MySQL-EZwX',
    PRODUCTION_DB_HOST: 'mysql-production.railway.internal', PRODUCTION_DB_NAME: 'planes_accion_production',
    DB_HOST: 'mysql-production.railway.internal', DB_PORT: '3306', DB_NAME: 'planes_accion_production',
    DB_USER: 'planes_backend', DB_PASSWORD: 'synthetic-only', ENABLE_ROLE_PERMISSION_ROUTES: 'false',
    ENABLE_ROLE_PERMISSION_ADMINISTRATION: 'false',
    EVIDENCE_STORAGE_DIR: '/data/evidence', RAILWAY_VOLUME_MOUNT_PATH: '/data/evidence'
  };
  assert.equal(railwayConfiguration(production).database, 'planes_accion_production');
  for (const override of [
    {RAILWAY_PROJECT_NAME: 'other'}, {RAILWAY_ENVIRONMENT_NAME: 'private-test'},
    {PRODUCTION_MYSQL_SERVICE_NAME: 'other'}, {DB_HOST: 'another.railway.internal'},
    {DB_NAME: 'other_database'}, {PRODUCTION_DB_HOST: '127.0.0.1'},
    {ENABLE_ROLE_PERMISSION_ROUTES: 'true'},
    {ENABLE_ROLE_PERMISSION_ADMINISTRATION: 'true'},
    {ENABLE_ROLE_PERMISSION_ROUTES: 'invalid'}
  ]) assert.throws(() => railwayConfiguration({...production, ...override}));
  const enabled = {
    ...production,
    ENABLE_ROLE_PERMISSION_ROUTES: 'true',
    ENABLE_ROLE_PERMISSION_ADMINISTRATION: 'true',
    ROLE_PERMISSION_PRODUCTION_CONFIRMATION: PRODUCTION_ROLE_PERMISSION_CONFIRMATION,
    ROLE_APPROVAL_WINDOW_MS: '3600000'
  };
  assert.equal(railwayConfiguration(enabled).database, production.DB_NAME);
  for (const override of [
    {ENABLE_ROLE_PERMISSION_ROUTES: 'false'},
    {ENABLE_ROLE_PERMISSION_ADMINISTRATION: 'false'},
    {ROLE_PERMISSION_PRODUCTION_CONFIRMATION: 'wrong'},
    {ROLE_APPROVAL_WINDOW_MS: '0'},
    {ROLE_APPROVAL_WINDOW_MS: 'not-a-number'}
  ]) assert.throws(() => railwayConfiguration({...enabled, ...override}));
});

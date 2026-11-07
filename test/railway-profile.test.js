import test from 'node:test';
import assert from 'node:assert/strict';
import {railwayConfiguration} from '../app/config/railway-profile.js';
const valid = {DEPLOYMENT_PROFILE: 'railway-private-test', NODE_ENV: 'staging', DB_HOST: 'mysql.railway.internal', DB_PORT: '3306', DB_NAME: 'planes_accion_railway_test', DB_USER: 'planes_backend', DB_PASSWORD: 'synthetic-only', ENABLE_ROLE_PERMISSION_ROUTES: 'true', EVIDENCE_STORAGE_DIR: '/data/evidence', RAILWAY_VOLUME_MOUNT_PATH: '/data/evidence'};
test('backend local profile is unchanged', () => assert.equal(railwayConfiguration({}), null));
test('backend private test is explicitly staging', () => assert.equal(railwayConfiguration(valid).database, 'planes_accion_railway_test'));
test('backend fails closed for commercial targets, root, missing volumes or production', () => {
  for (const override of [{DB_HOST: '127.0.0.1'}, {DB_PORT: '3307'}, {DB_NAME: 'planes_accion_test'}, {DB_USER: 'root'}, {RAILWAY_VOLUME_MOUNT_PATH: ''}, {EVIDENCE_STORAGE_DIR: '/tmp'}, {NODE_ENV: 'production'}, {ENABLE_ROLE_PERMISSION_ROUTES: 'false'}, {DEPLOYMENT_PROFILE: 'other'}]) assert.throws(() => railwayConfiguration({...valid, ...override}));
});

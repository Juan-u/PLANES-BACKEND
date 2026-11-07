import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const backendDirectory = fileURLToPath(new URL('../../', import.meta.url));

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('functional and role-administration routes are protected while role assignments stay optional', async t => {
  const port = await availablePort();
  const backend = spawn(process.execPath, ['index.js'], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ENABLE_ROLE_PERMISSION_ROUTES: 'false',
      PORT: String(port),
      APP_HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (backend.exitCode !== null || backend.signalCode !== null) return;
    await new Promise(resolve => {
      backend.once('exit', resolve);
      backend.kill('SIGTERM');
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !ready) {
    if (backend.exitCode !== null) assert.fail('Backend exited before listening.');
    try {
      const response = await fetch(`${baseUrl}/`);
      ready = response.ok;
    } catch {
      await delay(100);
    }
  }
  assert.equal(ready, true, 'Backend should listen on the isolated test port.');

  for (const path of [
    '/api/planes',
    '/api/planeacion',
    '/api/actividades',
    '/api/periodos',
    '/api/seguimiento/integrado',
    '/api/informes/calificaciones',
    '/api/informes/institucional',
    '/api/control-interno'
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} must be mounted and require authentication.`);
  }

  for (const path of [
    '/api/roles/capacidades',
    '/api/roles/catalogo',
    '/api/roles/permisos',
    '/api/roles/solicitudes'
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} must be mounted and require authentication.`);
  }

  const unusedRoot = await fetch(`${baseUrl}/api/roles`);
  assert.equal(unusedRoot.status, 404, 'The frontend does not consume an /api/roles root route.');
  const roleAssignment = await fetch(`${baseUrl}/api/roles/asignaciones`, { method: 'POST' });
  assert.equal(roleAssignment.status, 404, 'Role assignment must remain opt-in.');
});

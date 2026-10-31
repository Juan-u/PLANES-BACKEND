import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorizationMutexRepository } from '../../../app/repositories/roles/authorization-mutex.repository.js';
import { createAssignmentsRepository } from '../../../app/repositories/roles/assignments.repository.js';
import { createChangeRequestsRepository } from '../../../app/repositories/roles/change-requests.repository.js';
import { createAuditRepository } from '../../../app/repositories/roles/audit.repository.js';

const MUTEX_REQUIRED = (error) => error?.code === 'MUTEX_REQUIRED';

test('write repositories reject an ordinary transaction before issuing SQL', async () => {
  const mutex = createAuthorizationMutexRepository();
  const repositories = [
    createAssignmentsRepository({ mutex }),
    createChangeRequestsRepository({ mutex }),
    createAuditRepository({ mutex })
  ];
  let queries = 0;
  const ordinaryTx = {
    async query() { queries += 1; return [[], []]; },
    async execute() { queries += 1; return [[], []]; }
  };
  const operations = [
    repositories[0].create({}, ordinaryTx),
    repositories[0].revoke({}, ordinaryTx),
    repositories[1].createPending({}, ordinaryTx),
    repositories[1].decideIfPending('00000000-0000-4000-8000-000000000000', {}, ordinaryTx),
    repositories[2].append({}, ordinaryTx)
  ];

  for (const operation of operations) await assert.rejects(operation, MUTEX_REQUIRED);
  assert.equal(queries, 0);
});

test('a transaction facade issued under the mutex can reach the repository on the same connection', async () => {
  const mutex = createAuthorizationMutexRepository();
  const events = [];
  const tx = {
    async execute(sql) {
      events.push(sql);
      if (sql.includes('rol_autorizacion_mutex')) return [[{ mutex_id: 1 }], []];
      if (sql.includes('rol_configuracion')) {
        return [[{ id_rol: 7, clasificacion_privilegio: 'ordinary',
          permite_vigencia_indefinida: 0, requiere_ambito: 0 }], []];
      }
      throw new Error('Unexpected query');
    },
    async query(sql) { return this.execute(sql); }
  };
  const catalog = (await import('../../../app/repositories/roles/role-catalog.repository.js'))
    .createRoleCatalogRepository({ mutex });

  const result = await mutex.withLock(tx, (protectedTx) => catalog.getById(7, protectedTx));
  assert.equal(result.classification, 'ordinary');
  assert.equal(events.length, 2);
  assert.match(events[0], /rol_autorizacion_mutex/);
  assert.match(events[1], /LEFT JOIN rol_configuracion/);
});

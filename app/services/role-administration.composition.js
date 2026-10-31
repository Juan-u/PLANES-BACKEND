import { createRoleAdministrationService } from './role-administration.service.js';

const composed = new WeakSet();

export function isProtectedRoleAdministrationService(service) {
  return service != null && typeof service === 'object' && composed.has(service);
}

export function createRoleAdministrationComposition(options = {}) {
  if (!options.pool || typeof options.pool.getConnection !== 'function') throw new TypeError('A mysql2/promise pool is required.');
  if (!options.ids || typeof options.ids.next !== 'function') throw new TypeError('An ID provider is required.');
  if (!options.clock || typeof options.clock.now !== 'function') throw new TypeError('A clock is required.');
  const service = createRoleAdministrationService(options);
  Object.freeze(service);
  composed.add(service);
  return Object.freeze({ service });
}

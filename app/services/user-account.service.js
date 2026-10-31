import { createAuthorizationRepository } from '../repositories/roles/authorization.repository.js';
import { createAuthorizationMutexRepository } from '../repositories/roles/authorization-mutex.repository.js';
import { createAuditRepository } from '../repositories/roles/audit.repository.js';
import { createMysqlTransactionManager } from './mysql-transaction-manager.js';
import { hashPassword } from './password.service.js';

const MAX_INT = 2_147_483_647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function positiveId(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_INT ? number : null;
}
function text(value, max) { return typeof value === 'string' && value.trim() !== '' && value.length <= max ? value.trim() : null; }
function rows(result) { return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : null; }
function dateString(value) { const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('CLOCK_UNAVAILABLE'); return date.toISOString(); }

export function createUserAccountService({ pool, ids, clock } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') throw new TypeError('A mysql2/promise pool is required.');
  if (!ids || typeof ids.next !== 'function') throw new TypeError('A UUID provider is required.');
  if (!clock || typeof clock.now !== 'function') throw new TypeError('A clock is required.');
  const mutex = createAuthorizationMutexRepository();
  const transactions = createMysqlTransactionManager(pool);
  const authorization = createAuthorizationRepository({ mutex });
  const audit = createAuditRepository({ mutex });

  async function run(actorContext, permission, work) {
    const actorId = positiveId(actorContext?.actorId);
    if (!actorId) return { ok: false, code: 'AUTHENTICATION_REQUIRED' };
    try {
      return await transactions.run((rawTx) => mutex.withLock(rawTx, async (tx) => {
        mutex.assertHeld(tx);
        if (!await authorization.canAccess({ actorId, permissionCode: permission }, tx)) return { ok: false, code: 'AUTHORITY_REQUIRED' };
        return work(tx, actorId);
      }));
    } catch { return { ok: false, code: 'PERSISTENCE_FAILED' }; }
  }

  async function record(tx, actorId, targetUserId, action, reason, before, after) {
    const eventId = await ids.next();
    if (typeof eventId !== 'string' || !UUID_V4.test(eventId)) throw new Error('IDENTIFIER_UNAVAILABLE');
    await audit.append({ eventId, actorType: 'user', actorId, targetUserId, action,
      occurredAt: dateString(await clock.now()), reason, before: before == null ? null : JSON.stringify(before),
      after: after == null ? null : JSON.stringify(after) }, tx);
  }

  return Object.freeze({
    async create(actorContext, input = {}) {
      const name = text(input.nombre, 100), email = text(input.email, 150), reason = text(input.reason, 4000);
      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !reason || typeof input.password !== 'string') return { ok: false, code: 'INVALID_USER_INPUT' };
      let passwordHash;
      try { passwordHash = await hashPassword(input.password); } catch { return { ok: false, code: 'INVALID_PASSWORD' }; }
      return run(actorContext, 'M01.users.create', async (tx, actorId) => {
        const created = await tx.execute('INSERT INTO usuario (nombre, correo, `contraseña`, estado) VALUES (?, ?, ?, ?)',
          [name, email, passwordHash, 'Activo']);
        const userId = positiveId(created?.[0]?.insertId);
        if (!userId) throw new Error('USER_INSERT_FAILED');
        await record(tx, actorId, userId, 'user_account_created', reason, null, { nombre: name, email, estado: 'Activo' });
        return { ok: true, user: { id: userId, nombre: name, email, estado: 'Activo' } };
      });
    },

    async update(actorContext, userId, input = {}) {
      const targetId = positiveId(userId), name = text(input.nombre, 100), email = text(input.email, 150), reason = text(input.reason, 4000);
      if (!targetId || !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !reason) return { ok: false, code: 'INVALID_USER_INPUT' };
      return run(actorContext, 'M01.users.update', async (tx, actorId) => {
        const before = rows(await tx.execute('SELECT id_usuario, nombre, correo, estado FROM usuario WHERE id_usuario = ? LIMIT 1 FOR UPDATE', [targetId]));
        if (!before) throw new Error('INVALID_QUERY_RESULT');
        if (!before.length) return { ok: false, code: 'USER_NOT_FOUND' };
        const updated = await tx.execute('UPDATE usuario SET nombre = ?, correo = ? WHERE id_usuario = ?', [name, email, targetId]);
        if (updated?.[0]?.affectedRows !== 1) return { ok: false, code: 'USER_NOT_FOUND' };
        await record(tx, actorId, targetId, 'user_account_updated', reason,
          { nombre: before[0].nombre, email: before[0].correo, estado: before[0].estado },
          { nombre: name, email, estado: before[0].estado });
        return { ok: true, user: { id: targetId, nombre: name, email, estado: before[0].estado } };
      });
    },

    async deactivate(actorContext, userId, reasonInput) {
      const targetId = positiveId(userId), reason = text(reasonInput, 4000);
      if (!targetId || !reason) return { ok: false, code: 'INVALID_USER_INPUT' };
      return run(actorContext, 'M01.users.deactivate', async (tx, actorId) => {
        if (actorId === targetId) return { ok: false, code: 'SELF_DEACTIVATION_DENIED' };
        const found = rows(await tx.execute('SELECT id_usuario, estado FROM usuario WHERE id_usuario = ? LIMIT 1 FOR UPDATE', [targetId]));
        if (!found) throw new Error('INVALID_QUERY_RESULT');
        if (!found.length) return { ok: false, code: 'USER_NOT_FOUND' };
        if (String(found[0].estado).toLowerCase() !== 'activo') return { ok: true, changed: false, status: found[0].estado };
        const result = await tx.execute("UPDATE usuario SET estado = 'Inactivo' WHERE id_usuario = ? AND LOWER(estado) = 'activo'", [targetId]);
        if (result?.[0]?.affectedRows !== 1) throw new Error('USER_STATE_CHANGED');
        await record(tx, actorId, targetId, 'user_account_deactivated', reason, { estado: found[0].estado }, { estado: 'Inactivo' });
        return { ok: true, changed: true, status: 'Inactivo' };
      });
    },

    async reactivate(actorContext, userId, reasonInput) {
      const targetId = positiveId(userId), reason = text(reasonInput, 4000);
      if (!targetId || !reason) return { ok: false, code: 'INVALID_USER_INPUT' };
      return run(actorContext, 'M01.users.update', async (tx, actorId) => {
        const found = rows(await tx.execute('SELECT id_usuario, estado FROM usuario WHERE id_usuario = ? LIMIT 1 FOR UPDATE', [targetId]));
        if (!found) throw new Error('INVALID_QUERY_RESULT');
        if (!found.length) return { ok: false, code: 'USER_NOT_FOUND' };
        if (String(found[0].estado).toLowerCase() === 'activo') return { ok: true, changed: false, status: found[0].estado };
        const result = await tx.execute("UPDATE usuario SET estado = 'Activo' WHERE id_usuario = ? AND LOWER(estado) <> 'activo'", [targetId]);
        if (result?.[0]?.affectedRows !== 1) throw new Error('USER_STATE_CHANGED');
        await record(tx, actorId, targetId, 'user_account_reactivated', reason, { estado: found[0].estado }, { estado: 'Activo' });
        return { ok: true, changed: true, status: 'Activo' };
      });
    }
  });
}

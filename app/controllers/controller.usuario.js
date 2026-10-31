import pool from '../config/db.js';
import { randomUUID } from 'node:crypto';
import { createUserAccountService } from '../services/user-account.service.js';

const users = createUserAccountService({ pool, ids: { next: randomUUID }, clock: { now: () => new Date() } });
const MAX_ID = 2_147_483_647;
const STATUS = new Map([
  ['AUTHENTICATION_REQUIRED', 401], ['AUTHORITY_REQUIRED', 403], ['SELF_DEACTIVATION_DENIED', 403],
  ['USER_NOT_FOUND', 404], ['INVALID_USER_INPUT', 400], ['INVALID_PASSWORD', 400]
]);

function actor(req) {
  const subject = req?.usuario?.sub;
  if (typeof subject !== 'string' || !/^[1-9]\d{0,9}$/.test(subject)) return null;
  const actorId = Number(subject);
  return Number.isSafeInteger(actorId) && actorId <= MAX_ID ? { actorId } : null;
}
function result(res, output, success) {
  if (output?.ok) return res.status(success.status ?? 200).json(success.body ?? output);
  return res.status(STATUS.get(output?.code) ?? 503).json({ error: STATUS.has(output?.code) ? output.code : 'No fue posible completar la operación.' });
}

export const listarUsuarios = async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT id_usuario AS id, nombre, correo AS email, estado FROM usuario ORDER BY id_usuario');
    return res.json(rows);
  } catch {
    return res.status(503).json({ error: 'No fue posible listar los usuarios.' });
  }
};

export const obtenerUsuario = async (req, res) => {
  const rawId = req.params?.id;
  if (typeof rawId !== 'string' || !/^[1-9]\d{0,9}$/.test(rawId) || Number(rawId) > MAX_ID) {
    return res.status(400).json({ error: 'Identificador de usuario inválido.' });
  }
  try {
    const [rows] = await pool.query('SELECT id_usuario AS id, nombre, correo AS email, estado FROM usuario WHERE id_usuario = ? LIMIT 1', [Number(rawId)]);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    return res.json(rows[0]);
  } catch {
    return res.status(503).json({ error: 'No fue posible consultar el usuario.' });
  }
};

export const crearUsuario = async (req, res) => {
  const output = await users.create(actor(req), req.body ?? {});
  return result(res, output, { status: 201, body: output.ok ? output.user : undefined });
};

export const actualizarUsuario = async (req, res) => {
  const output = await users.update(actor(req), req.params?.id, req.body ?? {});
  return result(res, output, { body: output.ok ? { message: 'Usuario actualizado correctamente.', user: output.user } : undefined });
};

export const eliminarUsuario = async (req, res) => {
  const output = await users.deactivate(actor(req), req.params?.id, req.body?.reason);
  return result(res, output, { body: output.ok ? { message: 'Usuario desactivado sin borrar su historial.', status: output.status } : undefined });
};

export const reactivarUsuario = async (req, res) => {
  const output = await users.reactivate(actor(req), req.params?.id, req.body?.reason);
  return result(res, output, { body: output.ok ? { message: 'Usuario reactivado.', status: output.status } : undefined });
};

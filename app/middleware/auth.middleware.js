import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { JWT_SECRET } from '../config/auth.js';

const MAX_SIGNED_INT = 2147483647;

function cuentaActiva(estado) {
  return typeof estado === 'string' && estado.toLowerCase() === 'activo';
}

const FORBIDDEN_MESSAGE = 'No tienes permiso para realizar esta operaci\u00f3n.';
const UNAUTHORIZED_MESSAGE = 'Token inválido o cuenta no autorizada';

function unauthorized(res) {
  return res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
}

export const verificarToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const [scheme, token, ...extraParts] = typeof authHeader === 'string'
    ? authHeader.trim().split(/\s+/)
    : [];

  if (scheme?.toLowerCase() !== 'bearer' || !token || extraParts.length > 0) {
    return res.status(401).json({ error: 'Token no proporcionado o formato inválido' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return unauthorized(res);
  }

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded) ||
    typeof decoded.exp !== 'number' ||
    !Number.isFinite(decoded.exp)
  ) {
    return unauthorized(res);
  }

  const subject = decoded.sub;
  if (typeof subject !== 'string' || !/^\d+$/.test(subject)) {
    return unauthorized(res);
  }

  const accountId = Number(subject);
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || accountId > MAX_SIGNED_INT) {
    return unauthorized(res);
  }

  let rows;
  try {
    [rows] = await pool.query(
      'SELECT u.id_usuario, u.estado, r.nombre_rol FROM usuario AS u LEFT JOIN rol AS r ON r.id_rol = u.id_rol WHERE u.id_usuario = ? LIMIT 1',
      [accountId]
    );
  } catch {
    return res.status(503).json({ error: 'No fue posible verificar la cuenta' });
  }

  const account = Array.isArray(rows) ? rows[0] : undefined;
  if (!account || !cuentaActiva(account.estado)) {
    return unauthorized(res);
  }

  // El rol procede de la base de datos, no de un claim incluido en el JWT.
  req.usuario = { ...decoded, rol: account.nombre_rol ?? null };
  return next();
};

/** Crea una barrera por rol para montarse después de verificarToken. */
export const autorizarRoles = (...rolesPermitidos) => {
  const roles = new Set(
    rolesPermitidos.filter((role) => typeof role === 'string' && role.trim().length > 0)
  );

  if (roles.size === 0) {
    throw new TypeError('autorizarRoles requiere al menos un rol válido.');
  }

  return (req, res, next) => {
    if (!req.usuario || typeof req.usuario.sub !== 'string') {
      return res.status(401).json({ error: 'Autenticación requerida.' });
    }

    if (typeof req.usuario.rol !== 'string' || !roles.has(req.usuario.rol)) {
      return res.status(403).json({ error: FORBIDDEN_MESSAGE });
    }

    return next();
  };
};

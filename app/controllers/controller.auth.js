import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { JWT_SECRET } from '../config/auth.js';
import { verifyPassword } from '../services/password.service.js';

const INVALID_CREDENTIALS = 'Credenciales inv\u00e1lidas';
const TEMPORARY_LOGIN_ERROR = 'No fue posible iniciar sesi\u00f3n temporalmente.';
const MAX_SIGNED_INT = 2_147_483_647;

function cuentaActiva(estado) {
  return typeof estado === 'string' && estado.toLowerCase() === 'activo';
}

function rejectCredentials(res) {
  return res.status(401).json({ error: INVALID_CREDENTIALS });
}

function rejectTemporarily(res) {
  return res.status(503).json({ error: TEMPORARY_LOGIN_ERROR });
}

export const login = async (req, res) => {
  const { correo, password } = req.body ?? {};
  if (
    typeof correo !== 'string' ||
    correo.length === 0 ||
    typeof password !== 'string' ||
    password.length === 0 ||
    Buffer.byteLength(password, 'utf8') > 1_024
  ) {
    return rejectCredentials(res);
  }

  let rows;
  try {
    [rows] = await pool.query(
      'SELECT id_usuario, estado, `contrase\u00f1a` FROM usuario WHERE correo = ? LIMIT 1',
      [correo]
    );
  } catch {
    return rejectTemporarily(res);
  }

  const account = Array.isArray(rows) ? rows[0] : undefined;
  if (!account || !cuentaActiva(account.estado)) {
    return rejectCredentials(res);
  }

  let passwordMatches;
  try {
    passwordMatches = await verifyPassword(password, account['contrase\u00f1a']);
  } catch {
    return rejectTemporarily(res);
  }

  if (!passwordMatches) {
    return rejectCredentials(res);
  }

  const accountId = account.id_usuario;
  if (
    !Number.isSafeInteger(accountId) ||
    accountId <= 0 ||
    accountId > MAX_SIGNED_INT
  ) {
    return rejectTemporarily(res);
  }

  try {
    const token = jwt.sign(
      { sub: String(accountId) },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '2h' }
    );
    return res.status(200).json({ token });
  } catch {
    return rejectTemporarily(res);
  }
};

export const verificarSesion = (_req, res) => {
  return res.status(200).json({ ok: true });
};

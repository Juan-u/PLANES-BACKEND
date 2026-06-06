import jwt from 'jsonwebtoken';

const SECRET = 'mi_clave_secreta_123';

export const verificarToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, SECRET);

    req.usuario = decoded;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
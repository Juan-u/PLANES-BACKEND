import db from '../config/db.js';
import jwt from 'jsonwebtoken';

// POST /api/login
export const login = async (req, res) => {
    const { correo, contraseña } = req.body;

    if (!correo || !contraseña) {
        return res.status(400).json({ message: 'Correo y contraseña son requeridos' });
    }

    try {
        const [rows] = await db.execute(
            'SELECT * FROM usuario WHERE correo = ? AND contraseña = ?',
            [correo, contraseña]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Correo o contraseña incorrectos' });
        }

        const usuario = rows[0];

        const token = jwt.sign(
            { id: usuario.id_usuario, correo: usuario.correo, nombre: usuario.nombre },
            process.env.JWT_SECRET || 'mi_secreto_jwt_planes_accion',
            { expiresIn: '2h' }
        );

        res.json({
            message: 'Login exitoso',
            token,
            usuario: {
                id      : usuario.id_usuario,
                nombre  : usuario.nombre,
                correo  : usuario.correo,
                estado  : usuario.estado
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

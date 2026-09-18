import db from '../config/db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// POST /api/login
export const login = async (req, res) => {
    const { correo, contraseña } = req.body;

    if (!correo || !contraseña) {
        return res.status(400).json({
            message: 'Correo y contraseña son requeridos'
        });
    }

    try {
        // Buscar usuario únicamente por correo
        const [rows] = await db.execute(
            `
            SELECT 
                id,
                nombre,
                correo,
                contraseña,
                estado,
                area_id
            FROM usuarios
            WHERE correo = ?
            LIMIT 1
            `,
            [correo]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                message: 'Correo o contraseña incorrectos'
            });
        }

        const usuario = rows[0];

        // Verificar estado
        if (usuario.estado !== 'Activo') {
            return res.status(403).json({
                message: 'El usuario está inactivo'
            });
        }

        // Comparar contraseña enviada con el hash almacenado
        const contraseñaValida = await bcrypt.compare(
            contraseña,
            usuario.contraseña
        );

        if (!contraseñaValida) {
            return res.status(401).json({
                message: 'Correo o contraseña incorrectos'
            });
        }

        // Crear JWT
        const token = jwt.sign(
            {
                id: usuario.id,
                correo: usuario.correo,
                nombre: usuario.nombre
            },
            process.env.JWT_SECRET || 'mi_secreto_jwt_planes_accion',
            {
                expiresIn: '2h'
            }
        );

        return res.json({
            message: 'Login exitoso',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                correo: usuario.correo,
                estado: usuario.estado,
                area_id: usuario.area_id
            }
        });

    } catch (error) {
        console.error('Error en login:', error);

        return res.status(500).json({
            message: 'Error del servidor'
        });
    }
};

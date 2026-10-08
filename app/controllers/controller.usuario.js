
import db from '../config/db.js';


// listar

export const getUsuarios = async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT 
                u.id_usuario,
                u.nombre,
                u.correo,
                u.area_id,
                u.rol_id,
                a.nombre AS area,
                r.nombre AS rol
            FROM usuarios u
            LEFT JOIN areas a ON u.area_id = a.id_area
            LEFT JOIN roles r ON u.rol_id = r.id_rol
            ORDER BY u.id_usuario DESC
        `);

        res.json(rows);

    } catch (error) {
        console.error('Error al obtener usuarios:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};



// GET /api/usuarios/:id

export const getUsuariosById = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.execute(`
            SELECT 
                id_usuario,
                nombre,
                correo,
                area_id,
                rol_id
            FROM usuarios
            WHERE id_usuario = ?
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Usuario no encontrado'
            });
        }

        res.json(rows[0]);

    } catch (error) {
        console.error('Error al obtener usuario:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};



// PostCrear 

export const crearUsuarios = async (req, res) => {
    const {
        nombre,
        correo,
        password,
        area_id,
        rol_id
    } = req.body;

    if (!nombre || !correo || !password || !rol_id) {
        return res.status(400).json({
            message: 'Nombre, correo, password y rol son requeridos'
        });
    }

    try {
        const [result] = await db.execute(`
            INSERT INTO usuarios
                (nombre, correo, password, area_id, rol_id)
            VALUES (?, ?, ?, ?, ?)
        `, [
            nombre,
            correo,
            password,
            area_id || null,
            rol_id
        ]);

        res.status(201).json({
            message: 'Usuario creado correctamente',
            id_usuario: result.insertId
        });

    } catch (error) {
        console.error('Error al crear usuario:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};



// Post editar
export const actualizarUsuarios = async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        correo,
        password,
        area_id,
        rol_id
    } = req.body;

    if (!nombre || !correo || !rol_id) {
        return res.status(400).json({
            message: 'Nombre, correo y rol son requeridos'
        });
    }

    try {
        let result;

        if (password && password.trim() !== '') {

            [result] = await db.execute(`
                UPDATE usuarios
                SET nombre = ?,
                    correo = ?,
                    password = ?,
                    area_id = ?,
                    rol_id = ?
                WHERE id_usuario = ?
            `, [
                nombre,
                correo,
                password,
                area_id || null,
                rol_id,
                id
            ]);

        } else {

            [result] = await db.execute(`
                UPDATE usuarios
                SET nombre = ?,
                    correo = ?,
                    area_id = ?,
                    rol_id = ?
                WHERE id_usuario = ?
            `, [
                nombre,
                correo,
                area_id || null,
                rol_id,
                id
            ]);
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'Usuario no encontrado'
            });
        }

        res.json({
            message: 'Usuario actualizado correctamente'
        });

    } catch (error) {
        console.error('Error al actualizar usuario:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};



// eliminar

export const eliminarUsuarios = async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.execute(
            'DELETE FROM usuarios WHERE id_usuario = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'Usuario no encontrado'
            });
        }

        res.json({
            message: 'Usuario eliminado correctamente'
        });

    } catch (error) {
        console.error('Error al eliminar usuario:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


import db from '../config/db.js';

// ============================================================
// GET /api/usuarios
// GET /api/usuarios?id_usuario=X
// ============================================================
export const getUsuarios = async (req, res) => {
    const { id } = req.query;

    try {
        let rows;

        if (id) {
            [rows] = await db.execute(
                'SELECT * FROM usuarios WHERE id = ? ORDER BY id DESC',
                [id]
            );
        } else {
            [rows] = await db.execute(
                'SELECT * FROM usuarios ORDER BY id DESC'
            );
        }

        res.json(rows);

    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// ============================================================
// GET /api/usuarios/:id
// ============================================================
export const getUsuariosById = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.execute(
            'SELECT * FROM usuarios WHERE id = ?',
            [id]
        );

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


// ============================================================
// POST /api/usuarios
// ============================================================
export const crearUsuarios = async (req, res) => {
    const {
        nombre,
        correo,
        password,
        area_id
    } = req.body;

    // Validaciones
    if (!nombre || !correo || !password) {
        return res.status(400).json({
            message: 'Nombre, correo y password son requeridos'
        });
    }

    try {
        const [result] = await db.execute(
            `INSERT INTO usuarios
            (nombre, correo, password, area_id)
            VALUES (?, ?, ?, ?)`,
            [
                nombre,
                correo,
                password,
                area_id || null
            ]
        );

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


// ============================================================
// PUT /api/usuarios/:id
// ============================================================
export const actualizarUsuarios = async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        correo,
        password,
        area_id 
    } = req.body;

    if (!nombre || !correo) {
        return res.status(400).json({
            message: 'Nombre y correo son requeridos'
        });
    }

    try {
        let result;

        if (password) {
            [result] = await db.execute(
                `UPDATE usuarios
                 SET nombre = ?,
                     correo = ?,
                     password = ?,
                     area_id = ?
                 WHERE id_usuario = ?`,
                [
                    nombre,
                    correo,
                    password,
                    area_id || null,
                    id
                ]
            );
        } else {
            [result] = await db.execute(
                `UPDATE usuarios
                 SET nombre = ?,
                     correo = ?,
                     area_id = ?
                 WHERE id_usuario = ?`,
                [
                    nombre,
                    correo,
                    area_id || null,
                    id
                ]
            );
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


// ============================================================
// DELETE /api/usuarios/:id
// ============================================================
export const eliminarUsuarios = async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.execute(
            'DELETE FROM usuarios WHERE id = ?',
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

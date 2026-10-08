import db from '../config/db.js';


// ============================================
// GET /api/usuarios
// ============================================

export const getUsuarios = async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT
                u.id,
                u.nombre,
                u.correo,
                u.estado,
                u.area_id,
                u.rol_id,
                a.nombre AS area,
                r.nombre AS rol
            FROM usuarios u
            LEFT JOIN areas a
                ON u.area_id = a.id
            LEFT JOIN roles r
                ON u.rol_id = r.id
            ORDER BY u.id DESC
        `);

        res.json(rows);

    } catch (error) {
        console.error('Error al obtener usuarios:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// ============================================
// GET /api/usuarios/:id
// ============================================

export const getUsuariosById = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.execute(`
            SELECT
                u.id,
                u.nombre,
                u.correo,
                u.estado,
                u.area_id,
                u.rol_id,
                a.nombre AS area,
                r.nombre AS rol
            FROM usuarios u
            LEFT JOIN areas a
                ON u.area_id = a.id
            LEFT JOIN roles r
                ON u.rol_id = r.id
            WHERE u.id = ?
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


// ============================================
// POST /api/usuarios
// ============================================

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
            message: 'Nombre, correo, contraseña y rol son requeridos'
        });
    }

    try {
        const [result] = await db.execute(`
            INSERT INTO usuarios
                (nombre, correo, contraseña, area_id, rol_id)
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
            id: result.insertId
        });

    } catch (error) {
        console.error('Error al crear usuario:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                message: 'El correo ya está registrado'
            });
        }

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// ============================================
// PUT /api/usuarios/:id
// ============================================

export const actualizarUsuarios = async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        correo,
        password,
        area_id,
        rol_id,
        estado
    } = req.body;

    if (!nombre || !correo || !rol_id) {
        return res.status(400).json({
            message: 'Nombre, correo y rol son requeridos'
        });
    }

    try {

        // Si enviaron nueva contraseña
        if (password && password.trim() !== '') {

            const [result] = await db.execute(`
                UPDATE usuarios
                SET
                    nombre = ?,
                    correo = ?,
                    contraseña = ?,
                    area_id = ?,
                    rol_id = ?,
                    estado = ?
                WHERE id = ?
            `, [
                nombre,
                correo,
                password,
                area_id || null,
                rol_id,
                estado || 'Activo',
                id
            ]);

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Usuario no encontrado'
                });
            }

        } else {

            // Mantener contraseña actual
            const [result] = await db.execute(`
                UPDATE usuarios
                SET
                    nombre = ?,
                    correo = ?,
                    area_id = ?,
                    rol_id = ?,
                    estado = ?
                WHERE id = ?
            `, [
                nombre,
                correo,
                area_id || null,
                rol_id,
                estado || 'Activo',
                id
            ]);

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Usuario no encontrado'
                });
            }
        }

        res.json({
            message: 'Usuario actualizado correctamente'
        });

    } catch (error) {
        console.error('Error al actualizar usuario:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                message: 'El correo ya está registrado'
            });
        }

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// ============================================
// DELETE /api/usuarios/:id
// ============================================

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
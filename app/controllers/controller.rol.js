import db from '../config/db.js';

// GET /api/periodos
export const getRoles = async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT * FROM roles ORDER BY id DESC'
        );

        res.json(rows);

    } catch (error) {
        console.error('Error al obtener roles:', error);
        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// GET /api/periodos/:id
export const getRolById = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.execute(
            'SELECT * FROM roles WHERE id = ?',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Rol no encontrado'
            });
        }

        res.json(rows[0]);

    } catch (error) {
        console.error('Error al obtener rol:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// POST /api/periodos
export const crearRol = async (req, res) => {
    const {
        nombre
  
    } = req.body;

    if (!nombre) {
        return res.status(400).json({
            message: 'Nombre es requeridos'
        });
    }

    try {
        const [result] = await db.execute(
            `INSERT INTO roles
             (nombre)
             VALUES (?)`,
            [
                nombre
            ]
        );

        res.status(201).json({
            message: 'Rol creado correctamente',
            id: result.insertId
        });

    } catch (error) {
        console.error('Error al crear rol:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// PUT /api/periodos/:id
export const actualizarRol = async (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;

    if (!nombre) {
        return res.status(400).json({
            message: 'El nombre del rol es requerido'
        });
    }

    try {
        const [result] = await db.execute(
            `UPDATE roles
             SET nombre = ?
             WHERE id = ?`,
            [nombre, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'Rol no encontrado'
            });
        }

        res.json({
            message: 'Rol actualizada correctamente'
        });

    } catch (error) {
        console.error('Error al actualizar rol:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


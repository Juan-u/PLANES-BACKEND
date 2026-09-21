import db from '../config/db.js';

// GET /api/periodos
export const getAreas = async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT * FROM areas ORDER BY id_area DESC'
        );

        res.json(rows);

    } catch (error) {
        console.error('Error al obtener areas:', error);
        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// GET /api/periodos/:id
export const getAreasById = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.execute(
            'SELECT * FROM areas WHERE id_area = ?',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Area no encontrado'
            });
        }

        res.json(rows[0]);

    } catch (error) {
        console.error('Error al obtener area:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// POST /api/periodos
export const crearArea = async (req, res) => {
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
            `INSERT INTO areas
             (nombre)
             VALUES (?)`,
            [
                nombre
            ]
        );

        res.status(201).json({
            message: 'Area creado correctamente',
            id_area: result.insertId
        });

    } catch (error) {
        console.error('Error al crear area:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// PUT /api/periodos/:id
export const actualizarArea = async (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;

    if (!nombre) {
        return res.status(400).json({
            message: 'El nombre del área es requerido'
        });
    }

    try {
        const [result] = await db.execute(
            `UPDATE areas
             SET nombre = ?
             WHERE id_area = ?`,
            [nombre, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'Área no encontrada'
            });
        }

        res.json({
            message: 'Área actualizada correctamente'
        });

    } catch (error) {
        console.error('Error al actualizar área:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


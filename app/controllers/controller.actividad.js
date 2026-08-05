import db from '../config/db.js';

// GET /api/actividades?id_plan=X
export const getActividades = async (req, res) => {
    const { id_plan } = req.query;
    try {
        let rows;
        if (id_plan) {
            [rows] = await db.execute(
                'SELECT * FROM actividad WHERE id_plan = ? ORDER BY id_actividad DESC',
                [id_plan]
            );
        } else {
            [rows] = await db.execute(
                'SELECT * FROM actividad ORDER BY id_actividad DESC'
            );
        }
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener actividades:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// GET /api/actividades/:id
export const getActividadById = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT * FROM actividad WHERE id_actividad = ?',
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Actividad no encontrada' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Error al obtener actividad:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// POST /api/actividades
export const crearActividad = async (req, res) => {
    const { descripcion, responsable, fecha_inicio, fecha_fin, estado, id_plan } = req.body;

    if (!descripcion || !id_plan) {
        return res.status(400).json({ message: 'Descripción e id_plan son requeridos' });
    }

    try {
        const [result] = await db.execute(
            'INSERT INTO actividad (descripcion, responsable, fecha_inicio, fecha_fin, estado, id_plan) VALUES (?, ?, ?, ?, ?, ?)',
            [descripcion, responsable || null, fecha_inicio || null, fecha_fin || null, estado || 'Pendiente', id_plan]
        );

        res.status(201).json({
            message       : 'Actividad creada correctamente',
            id_actividad  : result.insertId
        });
    } catch (error) {
        console.error('Error al crear actividad:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// PUT /api/actividades/:id
export const actualizarActividad = async (req, res) => {
    const { id } = req.params;
    const { descripcion, responsable, fecha_inicio, fecha_fin, estado } = req.body;

    if (!descripcion) {
        return res.status(400).json({ message: 'La descripción es requerida' });
    }

    try {
        const [result] = await db.execute(
            'UPDATE actividad SET descripcion = ?, responsable = ?, fecha_inicio = ?, fecha_fin = ?, estado = ? WHERE id_actividad = ?',
            [descripcion, responsable || null, fecha_inicio || null, fecha_fin || null, estado || 'Pendiente', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Actividad no encontrada' });
        }

        res.json({ message: 'Actividad actualizada correctamente' });
    } catch (error) {
        console.error('Error al actualizar actividad:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// DELETE /api/actividades/:id
export const eliminarActividad = async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.execute(
            'DELETE FROM actividad WHERE id_actividad = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Actividad no encontrada' });
        }

        res.json({ message: 'Actividad eliminada correctamente' });
    } catch (error) {
        console.error('Error al eliminar actividad:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

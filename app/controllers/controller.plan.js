import db from '../config/db.js';

// GET /api/planes
export const getPlanes = async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT * FROM plan_accion ORDER BY id_plan DESC'
        );
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener planes:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// GET /api/planes/:id
export const getPlanById = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT * FROM plan_accion WHERE id_plan = ?',
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Plan no encontrado' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Error al obtener plan:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// POST /api/planes
export const crearPlan = async (req, res) => {
    const { nombre, descripcion, estado } = req.body;

    if (!nombre) {
        return res.status(400).json({ message: 'El nombre del plan es requerido' });
    }

    try {
        const fecha_creacion = new Date().toISOString().split('T')[0];
        const estadoFinal = estado || 'Activo';

        const [result] = await db.execute(
            'INSERT INTO plan_accion (nombre, descripcion, fecha_creacion, estado) VALUES (?, ?, ?, ?)',
            [nombre, descripcion || null, fecha_creacion, estadoFinal]
        );

        res.status(201).json({
            message : 'Plan creado correctamente',
            id_plan : result.insertId
        });
    } catch (error) {
        console.error('Error al crear plan:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// PUT /api/planes/:id
export const actualizarPlan = async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, estado } = req.body;

    if (!nombre) {
        return res.status(400).json({ message: 'El nombre del plan es requerido' });
    }

    try {
        const [result] = await db.execute(
            'UPDATE plan_accion SET nombre = ?, descripcion = ?, estado = ? WHERE id_plan = ?',
            [nombre, descripcion || null, estado || 'Activo', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Plan no encontrado' });
        }

        res.json({ message: 'Plan actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar plan:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

// DELETE /api/planes/:id
export const eliminarPlan = async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.execute(
            'DELETE FROM plan_accion WHERE id_plan = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Plan no encontrado' });
        }

        res.json({ message: 'Plan eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar plan:', error);
        res.status(500).json({ message: 'Error del servidor' });
    }
};

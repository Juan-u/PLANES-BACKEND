import db from '../config/db.js';

// GET /api/periodos
export const getPeriodos = async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT * FROM periodos ORDER BY id_periodo DESC'
        );

        res.json(rows);

    } catch (error) {
        console.error('Error al obtener periodos:', error);
        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// GET /api/periodos/:id
export const getPeriodoById = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.execute(
            'SELECT * FROM periodos WHERE id_periodo = ?',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Periodo no encontrado'
            });
        }

        res.json(rows[0]);

    } catch (error) {
        console.error('Error al obtener periodo:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// POST /api/periodos
export const crearPeriodo = async (req, res) => {
    const {
        nombre,
        fecha_inicio,
        fecha_fin,
        estado
    } = req.body;

    if (!nombre || !fecha_inicio || !fecha_fin) {
        return res.status(400).json({
            message: 'Nombre, fecha de inicio y fecha de fin son requeridos'
        });
    }

    try {
        const [result] = await db.execute(
            `INSERT INTO periodos
             (nombre, fecha_inicio, fecha_fin, estado)
             VALUES (?, ?, ?, ?)`,
            [
                nombre,
                fecha_inicio,
                fecha_fin,
                estado || 'Activo'
            ]
        );

        res.status(201).json({
            message: 'Periodo creado correctamente',
            id_periodo: result.insertId
        });

    } catch (error) {
        console.error('Error al crear periodo:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// PUT /api/periodos/:id
export const actualizarPeriodo = async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        fecha_inicio,
        fecha_fin,
        estado
    } = req.body;

    if (!nombre || !fecha_inicio || !fecha_fin) {
        return res.status(400).json({
            message: 'Nombre, fecha de inicio y fecha de fin son requeridos'
        });
    }

    try {
        const [result] = await db.execute(
            `UPDATE periodos
             SET nombre = ?,
                 fecha_inicio = ?,
                 fecha_fin = ?,
                 estado = ?
             WHERE id_periodo = ?`,
            [
                nombre,
                fecha_inicio,
                fecha_fin,
                estado || 'Activo',
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'Periodo no encontrado'
            });
        }

        res.json({
            message: 'Periodo actualizado correctamente'
        });

    } catch (error) {
        console.error('Error al actualizar periodo:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};

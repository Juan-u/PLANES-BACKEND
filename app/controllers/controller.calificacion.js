
import db from '../config/db.js';

// ============================================
// GET /api/calificaciones
// Obtener todas las calificaciones
// ============================================

export const getCalificaciones = async (req, res) => {

    try {

        const [rows] = await db.execute(`
            SELECT
                c.id,
                c.planeacion_id,
                c.periodo_id,
                c.resultado_obtenido,
                c.fecha_registro,

                p.actividad,

                pe.nombre AS periodo,
                pe.estado AS estado_periodo

            FROM calificacion c

            INNER JOIN planeacion p
                ON c.planeacion_id = p.id

            INNER JOIN periodos pe
                ON c.periodo_id = pe.id

            ORDER BY c.id DESC
        `);

        res.json(rows);

    } catch (error) {

        console.error('Error al obtener calificaciones:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// ============================================
// GET /api/calificaciones/:id
// Obtener una calificación
// ============================================

export const getCalificacionById = async (req, res) => {

    const { id } = req.params;

    try {

        const [rows] = await db.execute(`
            SELECT
                c.id,
                c.planeacion_id,
                c.periodo_id,
                c.resultado_obtenido,
                c.fecha_registro,

                p.actividad,

                pe.nombre AS periodo,
                pe.estado AS estado_periodo

            FROM calificacion c

            INNER JOIN planeacion p
                ON c.planeacion_id = p.id

            INNER JOIN periodos pe
                ON c.periodo_id = pe.id

            WHERE c.id = ?
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Calificación no encontrada'
            });
        }

        res.json(rows[0]);

    } catch (error) {

        console.error('Error al obtener calificación:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// ============================================
// POST /api/calificaciones
// Crear calificación
// ============================================

export const crearCalificacion = async (req, res) => {

    const {
        planeacion_id,
        periodo_id,
        resultado_obtenido
    } = req.body;

    // --------------------------------------------
    // Validación de datos obligatorios
    // --------------------------------------------

    if (!planeacion_id || !periodo_id || resultado_obtenido === undefined) {

        return res.status(400).json({
            message: 'planeacion_id, periodo_id y resultado_obtenido son requeridos'
        });
    }

    try {

        // --------------------------------------------
        // Verificar que exista la actividad
        // --------------------------------------------

        const [planeacion] = await db.execute(
            `SELECT id
             FROM planeacion
             WHERE id = ?`,
            [planeacion_id]
        );

        if (planeacion.length === 0) {

            return res.status(404).json({
                message: 'La actividad de planeación no existe'
            });
        }


        // --------------------------------------------
        // Verificar que exista el periodo
        // --------------------------------------------

        const [periodos] = await db.execute(
            `SELECT id, estado
             FROM periodos
             WHERE id = ?`,
            [periodo_id]
        );

        if (periodos.length === 0) {

            return res.status(404).json({
                message: 'El periodo no existe'
            });
        }


        // --------------------------------------------
        // Verificar que el periodo esté abierto
        // --------------------------------------------

        if (periodos[0].estado !== 'Abierto') {

            return res.status(400).json({
                message: 'El periodo está cerrado. No se puede registrar la calificación.'
            });
        }


        // --------------------------------------------
        // Verificar si ya existe una calificación
        // --------------------------------------------

        const [existente] = await db.execute(
            `SELECT id
             FROM calificacion
             WHERE planeacion_id = ?
             AND periodo_id = ?`,
            [planeacion_id, periodo_id]
        );

        if (existente.length > 0) {

            return res.status(409).json({
                message: 'Ya existe una calificación para esta actividad en este periodo'
            });
        }


        // --------------------------------------------
        // Crear calificación
        // --------------------------------------------

        const [result] = await db.execute(
            `INSERT INTO calificacion
                (planeacion_id, periodo_id, resultado_obtenido)
             VALUES (?, ?, ?)`,
            [
                planeacion_id,
                periodo_id,
                resultado_obtenido
            ]
        );


        res.status(201).json({
            message: 'Calificación creada correctamente',
            id_calificacion: result.insertId
        });

    } catch (error) {

        console.error('Error al crear calificación:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};


// ============================================
// PUT /api/calificaciones/:id
// Actualizar calificación
// ============================================

export const actualizarCalificacion = async (req, res) => {

    const { id } = req.params;

    const {
        resultado_obtenido
    } = req.body;


    if (resultado_obtenido === undefined) {

        return res.status(400).json({
            message: 'El resultado_obtenido es requerido'
        });
    }


    try {

        // --------------------------------------------
        // Buscar calificación y periodo
        // --------------------------------------------

        const [rows] = await db.execute(`
            SELECT
                c.id,
                c.periodo_id,
                pe.estado AS estado_periodo

            FROM calificacion c

            INNER JOIN periodos pe
                ON c.periodo_id = pe.id

            WHERE c.id = ?
        `, [id]);


        if (rows.length === 0) {

            return res.status(404).json({
                message: 'Calificación no encontrada'
            });
        }


        // --------------------------------------------
        // Verificar periodo abierto
        // --------------------------------------------

        if (rows[0].estado_periodo !== 'Abierto') {

            return res.status(400).json({
                message: 'El periodo está cerrado. No se puede modificar la calificación.'
            });
        }


        // --------------------------------------------
        // Actualizar calificación
        // --------------------------------------------

        const [result] = await db.execute(
            `UPDATE calificacion
             SET resultado_obtenido = ?
             WHERE id = ?`,
            [
                resultado_obtenido,
                id
            ]
        );


        if (result.affectedRows === 0) {

            return res.status(404).json({
                message: 'Calificación no encontrada'
            });
        }


        res.json({
            message: 'Calificación actualizada correctamente'
        });

    } catch (error) {

        console.error('Error al actualizar calificación:', error);

        res.status(500).json({
            message: 'Error del servidor'
        });
    }
};

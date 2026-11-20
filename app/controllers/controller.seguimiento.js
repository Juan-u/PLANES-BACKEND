import db from '../config/db.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../uploads');
const audit = async (req, accion, entidad, entidadId, detalle = '') => {
  try {
    await db.execute(
      'INSERT INTO logs_auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [req.usuario?.id || null, accion, entidad, entidadId == null ? null : String(entidadId), detalle, req.ip || null]
    );
  } catch (e) { console.error('No se pudo registrar auditoría:', e.message); }
};
const notify = async (titulo, mensaje, tipo = 'info', usuarioId = null) => {
  try { await db.execute('INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo) VALUES (?, ?, ?, ?)', [usuarioId, titulo, mensaje, tipo]); }
  catch (e) { console.error('No se pudo crear notificación:', e.message); }
};

export const getDashboard = async (_req, res) => {
  try {
    const [[planes]] = await db.query('SELECT COUNT(*) AS total FROM plan_accion WHERE estado = \'Activo\'');
    const [[actividades]] = await db.query('SELECT COUNT(*) AS total FROM actividad');
    const [[periodosAbiertos]] = await db.query("SELECT COUNT(*) AS total FROM periodos WHERE estado = 'Abierto'");
    const [[calificaciones]] = await db.query('SELECT COUNT(*) AS total FROM calificacion');
    const [[pendientes]] = await db.query("SELECT COUNT(*) AS total FROM calificacion c LEFT JOIN revisiones_calificacion r ON r.calificacion_id=c.id WHERE COALESCE(r.estado,'Pendiente')='Pendiente'");
    const [porPeriodo] = await db.query(`SELECT p.id, p.nombre, p.estado, COUNT(c.id) AS calificaciones,
      SUM(CASE WHEN COALESCE(r.estado,'Pendiente')='Aprobada' THEN 1 ELSE 0 END) AS aprobadas,
      SUM(CASE WHEN COALESCE(r.estado,'Pendiente')='Observada' THEN 1 ELSE 0 END) AS observadas
      FROM periodos p LEFT JOIN calificacion c ON c.periodo_id=p.id LEFT JOIN revisiones_calificacion r ON r.calificacion_id=c.id
      GROUP BY p.id,p.nombre,p.estado ORDER BY p.id DESC`);
    const [porArea] = await db.query(`SELECT a.nombre AS area, COUNT(DISTINCT pl.id) AS actividades, AVG(c.resultado_obtenido) AS promedio
      FROM areas a LEFT JOIN planeacion pl ON pl.area_id=a.id LEFT JOIN calificacion c ON c.planeacion_id=pl.id GROUP BY a.id,a.nombre ORDER BY a.nombre`);
    res.json({ resumen: { planes: planes.total, actividades: actividades.total, periodosAbiertos: periodosAbiertos.total, calificaciones: calificaciones.total, pendientes: pendientes.total }, porPeriodo, porArea });
  } catch (e) { console.error('Dashboard:', e); res.status(500).json({ message: 'No se pudo cargar el dashboard' }); }
};

export const getPlaneaciones = async (_req, res) => {
  try {
    const [rows] = await db.query(`
       SELECT
        pl.id,
        pl.actividad,
        pl.area_id,
        a.nombre AS area,
        pl.periodo_id,
        p.nombre AS periodo
      FROM planeacion pl
      INNER JOIN areas a ON a.id = pl.area_id
      INNER JOIN periodos p ON p.id = pl.periodo_id
      ORDER BY pl.id DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error al consultar planeaciones:', error);
    res.status(500).json({
      message: 'No se pudieron consultar las actividades de planeación'
    });
  }
};

export const crearPlaneacion = async (req, res) => {
const { actividad, area_id, periodo_id, plan_accion_id } = req.body;

if (!actividad?.trim() || !area_id || !periodo_id || !plan_accion_id) {
return res.status(400).json({
message: 'Actividad, área, periodo y plan de acción son obligatorios'
});
}

try {
const [planes] = await db.execute(
"SELECT id FROM plan_accion WHERE id = ? AND estado = 'Activo'",
[plan_accion_id]
);

if (!planes.length) {
  return res.status(400).json({
    message: 'El plan seleccionado no existe o está inactivo'
  });
}

const [result] = await db.execute(
  `INSERT INTO planeacion
    (actividad, area_id, periodo_id, id_plan)
   VALUES (?, ?, ?, ?)`,
  [
    actividad.trim(),
    area_id,
    periodo_id,
    plan_accion_id
  ]
);

await audit(
  req,
  'CREAR',
  'planeacion',
  result.insertId,
  `Actividad: ${actividad.trim()}, plan: ${plan_accion_id}`
);

await notify(
  'Nueva actividad de planeación',
  `Se registró la actividad: ${actividad.trim()}`,
  'info'
);

res.status(201).json({
  message: 'Actividad de planeación creada correctamente',
  id: result.insertId
});

} catch (error) {
console.error('Error al crear actividad:', error);
res.status(500).json({
message: 'No se pudo crear la actividad de planeación'
});
}
};

export const getSeguimiento = async (_req, res) => {
  try {
    const [rows] = await db.query(`SELECT c.id, c.planeacion_id, pl.actividad, a.nombre AS area, c.periodo_id, p.nombre AS periodo,
      p.estado AS estado_periodo, c.resultado_obtenido, c.observacion, c.fecha_registro,
      COALESCE(r.estado,'Pendiente') AS estado_revision, r.observacion AS observacion_revision,
      r.fecha_revision, u.nombre AS revisor,
      (SELECT COUNT(*) FROM evidencias e WHERE e.calificacion_id=c.id) AS total_evidencias,
      (SELECT GROUP_CONCAT(e.id ORDER BY e.id DESC SEPARATOR ',') FROM evidencias e WHERE e.calificacion_id=c.id) AS evidencia_ids,
      (SELECT GROUP_CONCAT(e.nombre_original ORDER BY e.id DESC SEPARATOR '|||') FROM evidencias e WHERE e.calificacion_id=c.id) AS evidencia_nombres
      FROM calificacion c JOIN planeacion pl ON pl.id=c.planeacion_id JOIN areas a ON a.id=pl.area_id
      JOIN periodos p ON p.id=c.periodo_id LEFT JOIN revisiones_calificacion r ON r.calificacion_id=c.id
      LEFT JOIN usuarios u ON u.id=r.revisado_por ORDER BY c.fecha_registro DESC`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: 'No se pudo cargar el seguimiento' }); }
};

export const crearCalificacion = async (req, res) => {
  const { planeacion_id, periodo_id, resultado_obtenido, observacion } = req.body;
  const nota = Number(resultado_obtenido);
  if (!planeacion_id || !periodo_id || resultado_obtenido === '' || !Number.isFinite(nota) || nota < 1 || nota > 4) {
    return res.status(400).json({ message: 'Selecciona actividad y periodo e ingresa una calificación entre 1 y 4' });
  }
  try {
    const [periodos] = await db.execute("SELECT id, estado FROM periodos WHERE id=?", [periodo_id]);
    if (!periodos.length) return res.status(404).json({ message: 'Periodo no encontrado' });
    if (periodos[0].estado !== 'Abierto') return res.status(400).json({ message: 'El periodo está cerrado. No se puede registrar la calificación.' });
    const [plan] = await db.execute('SELECT id FROM planeacion WHERE id=? AND periodo_id=?', [planeacion_id, periodo_id]);
    if (!plan.length) return res.status(400).json({ message: 'La actividad seleccionada no pertenece al periodo indicado' });
    const [result] = await db.execute('INSERT INTO calificacion (planeacion_id, periodo_id, resultado_obtenido, observacion) VALUES (?, ?, ?, ?)', [planeacion_id, periodo_id, nota, observacion?.trim() || null]);
    await db.execute('INSERT INTO revisiones_calificacion (calificacion_id, estado) VALUES (?, \'Pendiente\')', [result.insertId]);
    await audit(req, 'CREAR', 'calificacion', result.insertId, `Nota ${nota} para planeación ${planeacion_id}, periodo ${periodo_id}`);
    await notify('Calificación pendiente de revisión', `La calificación ${result.insertId} requiere revisión de Planeación.`, 'revision');
    res.status(201).json({ message: 'Calificación registrada y enviada a revisión', id: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ya existe una calificación para esta actividad y periodo' });
    console.error(e); res.status(500).json({ message: 'No se pudo registrar la calificación' });
  }
};

export const revisarCalificacion = async (req, res) => {
  const { id } = req.params;
  const { estado, observacion } = req.body;
  if (!['Aprobada', 'Observada'].includes(estado)) return res.status(400).json({ message: 'El estado debe ser Aprobada u Observada' });
  if (estado === 'Observada' && !observacion?.trim()) return res.status(400).json({ message: 'Escribe la observación para devolver la calificación' });
  try {
    const [rows] = await db.execute('SELECT id FROM calificacion WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Calificación no encontrada' });
    await db.execute(`INSERT INTO revisiones_calificacion (calificacion_id, estado, observacion, revisado_por, fecha_revision)
      VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE estado=VALUES(estado), observacion=VALUES(observacion), revisado_por=VALUES(revisado_por), fecha_revision=NOW()`,
      [id, estado, observacion?.trim() || null, req.usuario?.id || null]);
    await audit(req, 'REVISAR', 'calificacion', id, `${estado}: ${observacion || ''}`);
    await notify(`Calificación ${estado.toLowerCase()}`, `La calificación ${id} fue marcada como ${estado}. ${observacion || ''}`, estado === 'Aprobada' ? 'success' : 'warning');
    res.json({ message: `Calificación ${estado.toLowerCase()} correctamente` });
  } catch (e) { console.error(e); res.status(500).json({ message: 'No se pudo revisar la calificación' }); }
};

export const subirEvidencia = async (req, res) => {
  const calificacionId = Number(req.query.calificacion_id);
  const original = String(req.query.filename || 'evidencia').replace(/[\\/\0]/g, '_').slice(0, 250);
  if (!calificacionId) return res.status(400).json({ message: 'calificacion_id es obligatorio' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: 'No se recibió un archivo' });
  if (req.body.length > 10 * 1024 * 1024) return res.status(413).json({ message: 'El archivo supera el límite de 10 MB' });
  try {
    const [calif] = await db.execute('SELECT c.id,p.estado FROM calificacion c JOIN periodos p ON p.id=c.periodo_id WHERE c.id=?', [calificacionId]);
    if (!calif.length) return res.status(404).json({ message: 'Calificación no encontrada' });
    if (calif[0].estado !== 'Abierto') return res.status(400).json({ message: 'El periodo está cerrado; no se pueden cargar evidencias' });
    const ext = path.extname(original).slice(0, 12);
    const stored = `${crypto.randomUUID()}${ext}`;
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, stored), req.body, { flag: 'wx' });
    const [result] = await db.execute('INSERT INTO evidencias (calificacion_id,nombre_original,nombre_archivo,mime_type,tamano_bytes,cargado_por) VALUES (?,?,?,?,?,?)', [calificacionId, original, stored, req.headers['x-original-mime'] || req.headers['content-type'] || null, req.body.length, req.usuario?.id || null]);
    await audit(req, 'CARGAR_EVIDENCIA', 'evidencias', result.insertId, `${original} (${req.body.length} bytes)`);
    await notify('Nueva evidencia cargada', `Se adjuntó ${original} a la calificación ${calificacionId}.`, 'info');
    res.status(201).json({ message: 'Evidencia cargada correctamente', id: result.insertId, nombre: original });
  } catch (e) { console.error(e); res.status(500).json({ message: 'No se pudo guardar la evidencia' }); }
};

export const descargarEvidencia = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT nombre_original,nombre_archivo,mime_type FROM evidencias WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Evidencia no encontrada' });
    const filePath = path.join(uploadDir, rows[0].nombre_archivo);
    await fs.access(filePath);
    res.setHeader('Content-Type', rows[0].mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].nombre_original)}`);
    res.sendFile(filePath);
  } catch (e) { if (e.code !== 'ENOENT') console.error(e); res.status(404).json({ message: 'El archivo no está disponible' }); }
};

export const getEvidencias = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id,calificacion_id,nombre_original,tamano_bytes,fecha_carga FROM evidencias WHERE calificacion_id=? ORDER BY id DESC', [req.params.calificacionId]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: 'No se pudieron consultar las evidencias' }); }
};

export const getAuditoria = async (_req, res) => {
  try {
    const [rows] = await db.query(`SELECT l.id,l.accion,l.entidad,l.entidad_id,l.detalle,l.ip,l.fecha,u.nombre AS usuario
      FROM logs_auditoria l LEFT JOIN usuarios u ON u.id=l.usuario_id ORDER BY l.fecha DESC LIMIT 500`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: 'No se pudo consultar la auditoría' }); }
};

export const getNotificaciones = async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT id,titulo,mensaje,tipo,leida,fecha FROM notificaciones WHERE usuario_id IS NULL OR usuario_id=? ORDER BY fecha DESC LIMIT 100`, [req.usuario?.id || 0]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: 'No se pudieron consultar las notificaciones' }); }
};

export const marcarNotificacionLeida = async (req, res) => {
  try {
    const [result] = await db.execute('UPDATE notificaciones SET leida=1 WHERE id=? AND (usuario_id IS NULL OR usuario_id=?)', [req.params.id, req.usuario?.id || 0]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Notificación no encontrada' });
    res.json({ message: 'Notificación marcada como leída' });
  } catch (e) { console.error(e); res.status(500).json({ message: 'No se pudo actualizar la notificación' }); }
};

export const getPlanesAccion = async (_req, res) => {
  try {
    const [planes] = await db.query(`
      SELECT id, nombre, descripcion, fecha_creacion, estado
      FROM plan_accion
      WHERE estado = 'Activo'
      ORDER BY nombre ASC
    `);

    res.json(planes);
  } catch (error) {
    console.error('Error al consultar planes de acción:', error);
    res.status(500).json({
      message: 'No se pudieron consultar los planes de acción'
    });
  }
};

import { createMysqlTransactionManager } from '../services/mysql-transaction-manager.js';
import { createEvidenceStorage, EVIDENCE_TYPES, MAX_EVIDENCE_BYTES } from '../services/evidence-storage.service.js';

const MAX_INT = 2_147_483_647;
const idValue = (value) => { const n = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN; return Number.isSafeInteger(n) && n > 0 && n <= MAX_INT ? n : null; };
const cleanName = (name) => typeof name === 'string' ? name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';

export function createEvidenceController({ pool, storage = createEvidenceStorage() } = {}) {
  if (!pool?.query || !pool?.getConnection || !storage?.save || !storage?.read || !storage?.remove) throw new TypeError('Pool and private evidence storage are required.');
  const transactions = createMysqlTransactionManager(pool);

  async function listByActivity(req, res) {
    const id = idValue(req.params?.id);
    if (!id) return res.status(400).json({ error: 'Identificador de actividad inválido.' });
    try {
      const [rows] = await pool.query(`SELECT e.id_evidencia, e.fecha_subida, e.observaciones, e.id_actividad,
          m.nombre_original, m.mime_type, m.bytes
        FROM evidencia AS e LEFT JOIN evidencia_archivo_meta AS m ON m.id_evidencia = e.id_evidencia
        WHERE e.id_actividad = ? ORDER BY e.fecha_subida DESC, e.id_evidencia DESC`, [id]);
      return res.json(rows ?? []);
    } catch { return res.status(503).json({ error: 'No fue posible consultar las evidencias.' }); }
  }

  async function upload(req, res) {
    const actor = idValue(req?.usuario?.sub), activityId = idValue(req.body?.id_actividad);
    const { nombre_original: originalName, mime_type: mimeType, contenido_base64: base64, observaciones } = req.body ?? {};
    if (!actor) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!activityId || !cleanName(originalName) || cleanName(originalName).length > 255 || !Object.hasOwn(EVIDENCE_TYPES, mimeType) ||
        typeof base64 !== 'string' || Buffer.byteLength(base64, 'utf8') > 88_000 ||
        (observaciones != null && (typeof observaciones !== 'string' || Buffer.byteLength(observaciones, 'utf8') > 2_048))) {
      return res.status(400).json({ error: `Archivo o datos inválidos. Máximo ${MAX_EVIDENCE_BYTES} bytes; se permiten PDF, PNG, JPEG y texto plano.` });
    }
    let saved;
    try {
      const result = await transactions.run(async (tx) => {
        const [activities] = await tx.execute('SELECT id_actividad FROM actividad WHERE id_actividad = ? LIMIT 1 FOR UPDATE', [activityId]);
        if (!activities.length) return { missing: true };
        saved = await storage.save({ originalName, mimeType, base64 });
        const [evidence] = await tx.execute('INSERT INTO evidencia (archivo, fecha_subida, observaciones, id_actividad) VALUES (?, UTC_DATE(), ?, ?)',
          [saved.storageKey, observaciones || null, activityId]);
        await tx.execute(`INSERT INTO evidencia_archivo_meta (id_evidencia, storage_key, nombre_original, mime_type, sha256, bytes)
          VALUES (?, ?, ?, ?, ?, ?)`, [evidence.insertId, saved.storageKey, saved.originalName, saved.mimeType, saved.sha256, saved.bytes]);
        await tx.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)', [`evidence_uploaded:${evidence.insertId}:activity:${activityId}`, actor]);
        return { evidence: { id_evidencia: evidence.insertId, id_actividad: activityId, nombre_original: saved.originalName, mime_type: saved.mimeType, bytes: saved.bytes } };
      });
      if (result.missing) return res.status(404).json({ error: 'Actividad no encontrada.' });
      return res.status(201).json(result.evidence);
    } catch {
      if (saved) {
        try { await storage.remove({ storageKey: saved.storageKey, mimeType: saved.mimeType }); }
        catch { process.emitWarning('No se pudo limpiar un archivo de evidencia tras un fallo de persistencia.'); }
      }
      return res.status(503).json({ error: 'No fue posible almacenar la evidencia.' });
    }
  }

  async function download(req, res) {
    const id = idValue(req.params?.id);
    if (!id) return res.status(400).json({ error: 'Identificador de evidencia inválido.' });
    try {
      const [rows] = await pool.query(`SELECT e.id_evidencia, m.storage_key, m.nombre_original, m.mime_type, m.bytes, m.sha256
        FROM evidencia AS e JOIN evidencia_archivo_meta AS m ON m.id_evidencia = e.id_evidencia
        WHERE e.id_evidencia = ? LIMIT 1`, [id]);
      if (!rows.length) return res.status(404).json({ error: 'Evidencia descargable no encontrada.' });
      const row = rows[0];
      if (!Object.hasOwn(EVIDENCE_TYPES, row.mime_type)) return res.status(409).json({ error: 'El tipo almacenado no está permitido.' });
      const bytes = await storage.read({ storageKey: row.storage_key, mimeType: row.mime_type, expectedBytes: row.bytes, expectedSha256: row.sha256 });
      return res.status(200).type(row.mime_type).attachment(cleanName(row.nombre_original)).send(bytes);
    } catch { return res.status(503).json({ error: 'No fue posible descargar la evidencia.' }); }
  }

  return Object.freeze({ listByActivity, upload, download });
}

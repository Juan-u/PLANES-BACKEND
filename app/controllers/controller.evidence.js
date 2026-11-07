import { integrationReady, recordUpload, assertLinkable } from '../services/quarterly-integration.context.js';
import { IntegrationError } from '../services/quarterly-integration.rules.js';
import { createMysqlTransactionManager } from '../services/mysql-transaction-manager.js';
import { createEvidenceStorage, EVIDENCE_TYPES, LEGACY_EVIDENCE_BYTES, MAX_EVIDENCE_BYTES } from '../services/evidence-storage.service.js';

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
        typeof base64 !== 'string' || Buffer.byteLength(base64, 'utf8') > 88_000 || Buffer.from(base64,'base64').length > LEGACY_EVIDENCE_BYTES ||
        (observaciones != null && (typeof observaciones !== 'string' || Buffer.byteLength(observaciones, 'utf8') > 2_048))) {
      return res.status(400).json({ error: `Archivo o datos inválidos. Máximo ${LEGACY_EVIDENCE_BYTES} bytes; se permiten PDF, PNG, JPEG y texto plano.` });
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
        await recordUpload(tx,evidence.insertId,activityId,actor,null);
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

  async function checkIntegration(_req,res,next) {
    try{if(!await integrationReady(pool))return res.status(503).json({code:'INTEGRATION_NOT_ACTIVATED'});return next();}
    catch{return res.status(503).json({code:'INTEGRATION_UNAVAILABLE'});}
  }
  async function uploadBytes(req,res) {
    const actor=idValue(req.usuario?.sub),activityId=idValue(req.params?.id);let saved;
    if(!actor)return res.status(401).json({code:'AUTHENTICATION_REQUIRED'});
    let name,note;try{name=decodeURIComponent(req.headers['x-evidence-name']||'');note=decodeURIComponent(req.headers['x-evidence-notes']||'');}catch{return res.status(400).json({code:'INVALID_FILE_METADATA'});}
    const mimeType=req.headers['x-evidence-type'],followupId=req.headers['x-followup-id']||null;
    if(!activityId||!Buffer.isBuffer(req.body)||req.body.length>MAX_EVIDENCE_BYTES||Buffer.byteLength(note)>2048||note.includes('\0')||(followupId&&!/^[1-9]\d{0,19}$/.test(followupId)))return res.status(400).json({code:'INVALID_FILE_METADATA'});
    try{
      const result=await transactions.run(async tx=>{
        if(!await integrationReady(tx))throw new IntegrationError('INTEGRATION_NOT_ACTIVATED',503);
        if(followupId)await assertLinkable(tx,followupId,activityId);
        const[activities]=await tx.execute('SELECT id_actividad FROM actividad WHERE id_actividad=? FOR UPDATE',[activityId]);
        if(!activities.length)throw new IntegrationError('ACTIVITY_NOT_FOUND',404);
        saved=await storage.saveBytes({originalName:name,mimeType,bytes:req.body});
        const[insert]=await tx.execute('INSERT INTO evidencia (archivo,fecha_subida,observaciones,id_actividad) VALUES (?,UTC_DATE(),?,?)',[saved.storageKey,note||null,activityId]);
        await tx.execute('INSERT INTO evidencia_archivo_meta (id_evidencia,storage_key,nombre_original,mime_type,sha256,bytes) VALUES (?,?,?,?,?,?)',[insert.insertId,saved.storageKey,saved.originalName,saved.mimeType,saved.sha256,saved.bytes]);
        await recordUpload(tx,insert.insertId,activityId,actor,followupId,{verifiedInTransaction:true});
        await tx.execute('INSERT INTO historico (accion,fecha,id_usuario) VALUES (?,UTC_DATE(),?)',[`evidence_uploaded:${insert.insertId}:activity:${activityId}`,actor]);
        return {id_evidencia:insert.insertId,estado:'uploaded',id_seguimiento:followupId};
      });return res.status(201).json(result);
    }catch(error){
      if(saved){try{await storage.remove({storageKey:saved.storageKey,mimeType:saved.mimeType});}catch{process.emitWarning('New evidence cleanup failed after transaction rollback.');}}
      if(error instanceof IntegrationError)return res.status(error.status).json({code:error.code});
      if(error instanceof TypeError||error instanceof RangeError)return res.status(400).json({code:'INVALID_FILE_CONTENT'});
      return res.status(503).json({code:'EVIDENCE_UPLOAD_UNAVAILABLE'});
    }
  }
  async function link(req,res){
    const actor=idValue(req.usuario?.sub),evidenceId=idValue(req.params?.id),activityId=idValue(req.body?.id_actividad),followupId=String(req.body?.id_seguimiento||'');
    if(!actor)return res.status(401).json({code:'AUTHENTICATION_REQUIRED'});
    if(!evidenceId||!activityId||!/^[1-9]\d{0,19}$/.test(followupId))return res.status(400).json({code:'INVALID_REFERENCE'});
    try{await transactions.run(async tx=>{
      if(!await integrationReady(tx))throw new IntegrationError('INTEGRATION_NOT_ACTIVATED',503);
      await assertLinkable(tx,followupId,activityId);
      const[files]=await tx.execute('SELECT id_evidencia FROM evidencia WHERE id_evidencia=? AND id_actividad=? FOR UPDATE',[evidenceId,activityId]);
      if(files.length!==1)throw new IntegrationError('EVIDENCE_ACTIVITY_MISMATCH');
      const[existing]=await tx.execute('SELECT id_evidencia FROM seguimiento_evidencia WHERE id_seguimiento=? AND id_evidencia=?',[followupId,evidenceId]);
      if(!existing.length)await tx.execute('INSERT INTO seguimiento_evidencia (id_seguimiento,id_evidencia,id_actividad,vinculado_por,vinculado_en) VALUES (?,?,?,?,UTC_TIMESTAMP(3))',[followupId,evidenceId,activityId,actor]);
    });return res.json({linked:true});}catch(error){return res.status(error instanceof IntegrationError?error.status:503).json({code:error instanceof IntegrationError?error.code:'EVIDENCE_LINK_UNAVAILABLE'});}
  }
  return Object.freeze({ listByActivity, upload, download,checkIntegration,uploadBytes,link });
}

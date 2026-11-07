import { IntegrationError } from '../services/quarterly-integration.rules.js';
import { captureFollowupContext, recordPeriodAction, closedPeriodSnapshot } from '../services/quarterly-integration.context.js';
import { createMysqlTransactionManager } from '../services/mysql-transaction-manager.js';
import { generarResumenSeguimientoTrimestral } from '../services/quarterly.followup.service.js';

const MAX_INT = 2_147_483_647;
const idValue = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_INT ? n : null;
};
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1000) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value;
};
const textOk = (value, max) => typeof value === 'string' && value.trim() !== '' && value.trim().length <= max && !value.includes('\u0000');
const actorId = (req) => idValue(req?.usuario?.sub);
const PERIOD_FIELDS = 'id_periodo, anio, trimestre, DATE_FORMAT(fecha_inicio, "%Y-%m-%d") AS fecha_inicio, DATE_FORMAT(fecha_fin, "%Y-%m-%d") AS fecha_fin, estado, creado_por, creado_en';
const ACTIVITY_FIELDS = 'a.id_actividad, a.descripcion, a.responsable, DATE_FORMAT(a.fecha_inicio, "%Y-%m-%d") AS fecha_inicio, DATE_FORMAT(a.fecha_fin, "%Y-%m-%d") AS fecha_fin, a.estado, a.id_plan';

const CLOSED_PERIOD_AUTHORITY=async()=>null;
export function createFollowupController(pool,{institutionalAuthority=CLOSED_PERIOD_AUTHORITY}={}) {
  if (!pool?.query || !pool?.getConnection) throw new TypeError('A mysql2/promise pool is required.');
  const transactions = createMysqlTransactionManager(pool);

  async function listPeriods(_req, res) {
    try {
      const [rows] = await pool.query(`SELECT ${PERIOD_FIELDS} FROM periodo_seguimiento ORDER BY anio DESC, trimestre DESC`);
      return res.json(rows ?? []);
    } catch { return res.status(503).json({ error: 'No fue posible consultar los períodos.' }); }
  }

  async function createPeriod(req, res) {
    const userId = actorId(req);
    const { anio, trimestre, fecha_inicio, fecha_fin } = req.body ?? {};
    const year = Number(anio), quarter = Number(trimestre);
    if (!userId) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!Number.isInteger(year) || year < 1000 || year > 9999 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4 ||
        !validDate(fecha_inicio) || !validDate(fecha_fin) || fecha_inicio > fecha_fin) {
      return res.status(400).json({ error: 'Revisa el año, trimestre y fechas del período.' });
    }
    if(institutionalAuthority===CLOSED_PERIOD_AUTHORITY)return res.status(403).json({code:'INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED'});
    try {
        const period = await transactions.run(async (tx) => {
        const authority=await institutionalAuthority({action:'open_period',actorId:userId,proposed:{anio:year,trimestre:quarter,fecha_inicio,fecha_fin}},tx);
        if(authority?.allowed!==true||typeof authority.reference!=='string'||!authority.reference.trim()||authority.reference.length>200)throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);
          const [result] = await tx.execute(`INSERT INTO periodo_seguimiento (anio, trimestre, fecha_inicio, fecha_fin, creado_por,creado_en)
            VALUES (?, ?, ?, ?, ?,UTC_TIMESTAMP(3))`, [year, quarter, fecha_inicio, fecha_fin, userId]);
          await tx.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)', [`period_created:${result.insertId}`, userId]);
          await recordPeriodAction(tx,result.insertId,userId,'opened','open','open',authority.reference);
          return { id_periodo: result.insertId, anio: year, trimestre: quarter, fecha_inicio, fecha_fin, estado: 'open' };
        });
      return res.status(201).json(period);
    } catch (error) {
      if(error instanceof IntegrationError)return res.status(error.status).json({code:error.code});
      if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un período para ese año y trimestre.' });
      return res.status(503).json({ error: 'No fue posible crear el período.' });
    }
  }

  async function closePeriod(req, res) {
    const userId = actorId(req);
    const id = idValue(req.params?.id);
    if (!userId) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!id) return res.status(400).json({ error: 'Identificador de período inválido.' });
    if(institutionalAuthority===CLOSED_PERIOD_AUTHORITY)return res.status(403).json({code:'INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED'});
    try {
      const updateResult = await transactions.run(async (tx) => {
        const authority=await institutionalAuthority({action:'close_period',actorId:userId,periodId:id},tx);
        if(authority?.allowed!==true||typeof authority.reference!=='string'||!authority.reference.trim()||authority.reference.length>200)throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);
        const [result] = await tx.execute("UPDATE periodo_seguimiento SET estado = 'closed' WHERE id_periodo = ? AND estado = 'open'", [id]);
        if (result.affectedRows) await tx.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)', [`period_closed:${id}`, userId]);
        if (result.affectedRows) await recordPeriodAction(tx,id,userId,'closed','open','closed',authority.reference);
        return result;
      });
      if (!updateResult.affectedRows) {
        const [rows] = await pool.query('SELECT id_periodo, estado FROM periodo_seguimiento WHERE id_periodo = ? LIMIT 1', [id]);
        if (!rows.length) return res.status(404).json({ error: 'Período no encontrado.' });
        return res.status(409).json({ error: 'El período ya está cerrado.' });
      }
      return res.json({ id_periodo: id, estado: 'closed' });
    } catch(error) { if(error instanceof IntegrationError)return res.status(error.status).json({code:error.code}); return res.status(503).json({ error: 'No fue posible cerrar el período.' }); }
  }

  async function listActivities(req, res) {
    const periodId = idValue(req.params?.id);
    if (!periodId) return res.status(400).json({ error: 'Identificador de período inválido.' });
    try {
      const [periods] = await pool.query(`SELECT ${PERIOD_FIELDS} FROM periodo_seguimiento WHERE id_periodo = ? LIMIT 1`, [periodId]);
      if (!periods.length) return res.status(404).json({ error: 'Período no encontrado.' });
      const frozen=periods[0].estado==='closed'?await closedPeriodSnapshot(pool,periodId):null;
      if(frozen){
        if(!frozen.rows.length)return res.json({period:periods[0],activities:[],closedSnapshotAvailable:true});
        const[items]=await pool.query(`SELECT ${ACTIVITY_FIELDS},(SELECT s.id_seguimiento FROM seguimiento_actividad s WHERE s.id_actividad=a.id_actividad AND s.id_periodo=? AND s.estado='pending' ORDER BY s.id_seguimiento DESC LIMIT 1) AS id_seguimiento_pendiente FROM actividad a WHERE a.id_actividad IN (${frozen.rows.map(()=>'?').join(',')}) ORDER BY a.id_actividad`,[periodId,...frozen.rows.map(r=>r.id_actividad)]);
        if(items.length!==frozen.rows.length)throw new IntegrationError('INVALID_CLOSED_SNAPSHOT',503);
        return res.json({period:periods[0],closedSnapshotAvailable:true,activities:items.map(a=>{const stored=frozen.rows.find(r=>Number(r.id_actividad)===Number(a.id_actividad));return {...a,fecha_inicio:stored.fecha_inicio,fecha_fin:stored.fecha_fin,porcentaje_aprobado:stored.porcentaje_aprobado};})});
      }
      const [rows] = await pool.query(`SELECT ${ACTIVITY_FIELDS},
          (SELECT s.id_seguimiento FROM seguimiento_actividad AS s WHERE s.id_actividad = a.id_actividad AND s.id_periodo = ? AND s.estado = 'pending' ORDER BY s.id_seguimiento DESC LIMIT 1) AS id_seguimiento_pendiente,
          (SELECT s.porcentaje FROM seguimiento_actividad AS s WHERE s.id_actividad = a.id_actividad AND s.id_periodo = ? AND s.estado = 'approved' ORDER BY s.id_seguimiento DESC LIMIT 1) AS porcentaje_aprobado
        FROM actividad AS a
        WHERE a.fecha_fin IS NOT NULL AND a.fecha_fin <= ? AND (a.fecha_inicio IS NULL OR a.fecha_inicio <= ?)
        ORDER BY a.id_actividad`, [periodId, periodId, periods[0].fecha_fin, periods[0].fecha_fin]);
      return res.json({ period: periods[0], activities: rows ?? [] });
    } catch { return res.status(503).json({ error: 'No fue posible consultar actividades del período.' }); }
  }

  async function getActivityHistory(req, res) {
    const activityId = idValue(req.params?.id);
    if (!activityId) return res.status(400).json({ error: 'Identificador de actividad inválido.' });
    try {
      const [rows] = await pool.query(`SELECT s.id_seguimiento, s.id_actividad, s.id_periodo, p.anio, p.trimestre,
          s.porcentaje, s.observaciones, s.estado, s.creado_por, s.creado_en,
          d.resultado AS decision, d.motivo AS motivo_decision, d.decidido_por, d.decidido_en
        FROM seguimiento_actividad AS s JOIN periodo_seguimiento AS p ON p.id_periodo = s.id_periodo
        LEFT JOIN seguimiento_decision AS d ON d.id_seguimiento = s.id_seguimiento
        WHERE s.id_actividad = ? ORDER BY s.creado_en DESC, s.id_seguimiento DESC`, [activityId]);
      return res.json(rows ?? []);
    } catch { return res.status(503).json({ error: 'No fue posible consultar el historial de seguimiento.' }); }
  }

  async function listPeriodHistory(req, res) {
    const periodId = idValue(req.params?.id);
    if (!periodId) return res.status(400).json({ error: 'Identificador de período inválido.' });
    try {
      const [rows] = await pool.query(`SELECT s.id_seguimiento, s.id_actividad, s.id_periodo, p.anio, p.trimestre, s.porcentaje, s.observaciones,
          s.estado, s.creado_por, s.creado_en, d.resultado AS decision, d.motivo AS motivo_decision,
          d.decidido_por, d.decidido_en FROM seguimiento_actividad AS s
        JOIN periodo_seguimiento AS p ON p.id_periodo = s.id_periodo
        LEFT JOIN seguimiento_decision AS d ON d.id_seguimiento = s.id_seguimiento
        WHERE s.id_periodo = ? ORDER BY s.creado_en DESC, s.id_seguimiento DESC`, [periodId]);
      return res.json(rows ?? []);
    } catch { return res.status(503).json({ error: 'No fue posible consultar el historial del período.' }); }
  }

  async function createFollowup(req, res) {
    const userId = actorId(req), activityId = idValue(req.params?.id), periodId = idValue(req.body?.id_periodo);
    const rawProgress = req.body?.porcentaje;
    const progress = typeof rawProgress === 'number' ? rawProgress : typeof rawProgress === 'string' && /^\d{1,3}(?:\.\d{1,2})?$/.test(rawProgress) ? Number(rawProgress) : NaN;
    const observations = req.body?.observaciones == null || req.body.observaciones === '' ? null : req.body.observaciones;
    if (!userId) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!activityId || !periodId || !Number.isFinite(progress) || progress < 0 || progress > 100 ||
        (observations != null && !textOk(observations, 65_535))) return res.status(400).json({ error: 'Revisa el porcentaje, período y observaciones.' });
    try {
      const result = await transactions.run(async (tx) => {
        const [periods] = await tx.execute(`SELECT ${PERIOD_FIELDS} FROM periodo_seguimiento WHERE id_periodo = ? LIMIT 1 FOR UPDATE`, [periodId]);
        if (!periods.length) return { code: 'period_missing' };
        if (periods[0].estado !== 'open') return { code: 'period_closed' };
        const [activities] = await tx.execute(`SELECT ${ACTIVITY_FIELDS} FROM actividad AS a WHERE a.id_actividad = ? LIMIT 1 FOR UPDATE`, [activityId]);
        if (!activities.length) return { code: 'activity_missing' };
        if (activities[0].fecha_inicio && activities[0].fecha_inicio > periods[0].fecha_fin) return { code: 'activity_future' };
        const [pending] = await tx.execute("SELECT id_seguimiento FROM seguimiento_actividad WHERE id_actividad = ? AND id_periodo = ? AND estado = 'pending' LIMIT 1 FOR UPDATE", [activityId, periodId]);
        if (pending.length) return { code: 'already_pending' };
        const [inserted] = await tx.execute(`INSERT INTO seguimiento_actividad (id_actividad, id_periodo, porcentaje, observaciones, estado, creado_por,creado_en)
          VALUES (?, ?, ?, ?, 'pending', ?,UTC_TIMESTAMP(3))`, [activityId, periodId, progress, observations, userId]);
        await captureFollowupContext(tx,inserted.insertId,activityId);
        await tx.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)', [`followup_submitted:${inserted.insertId}`, userId]);
        return { id_seguimiento: inserted.insertId, id_actividad: activityId, id_periodo: periodId, porcentaje: progress, observaciones: observations, estado: 'pending', creado_por: userId };
      });
      if (result.code === 'period_missing') return res.status(404).json({ error: 'Período no encontrado.' });
      if (result.code === 'activity_missing') return res.status(404).json({ error: 'Actividad no encontrada.' });
      if (result.code === 'period_closed') return res.status(409).json({ error: 'El período está cerrado.' });
      if (result.code === 'activity_future') return res.status(400).json({ error: 'La actividad inicia después del período seleccionado.' });
      if (result.code === 'already_pending') return res.status(409).json({ error: 'Ya hay un seguimiento pendiente de decisión para esta actividad y período.' });
      return res.status(201).json(result);
    } catch { return res.status(503).json({ error: 'No fue posible registrar el seguimiento.' }); }
  }

  async function decideFollowup(req, res) {
    const actor = actorId(req), id = idValue(req.params?.id);
    const resultado = req.body?.resultado;
    const motivo = req.body?.motivo;
    if (!actor) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!id || !['approved', 'rejected'].includes(resultado) || !textOk(motivo, 65_535)) return res.status(400).json({ error: 'La decisión y el motivo son obligatorios.' });
    if(institutionalAuthority===CLOSED_PERIOD_AUTHORITY)return res.status(403).json({code:'INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED'});
    try {
      const result = await transactions.run(async (tx) => {
        const authority=await institutionalAuthority({action:'decide_followup',actorId:actor,followupId:id},tx);
        if(authority?.allowed!==true||typeof authority.reference!=='string'||!authority.reference.trim()||authority.reference.length>200)throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);
        const [rows] = await tx.execute(`SELECT s.id_seguimiento, s.estado, s.creado_por, s.id_actividad, s.id_periodo
          FROM seguimiento_actividad AS s WHERE s.id_seguimiento = ? LIMIT 1 FOR UPDATE`, [id]);
        if (!rows.length) return { code: 'missing' };
        if (rows[0].estado !== 'pending') return { code: 'decided' };
        if (rows[0].creado_por === actor) return { code: 'self_decision' };
        const [decisionPeriods]=await tx.execute('SELECT estado FROM periodo_seguimiento WHERE id_periodo=? FOR UPDATE',[rows[0].id_periodo]);
        if(decisionPeriods[0]?.estado!=='open')return {code:'period_closed'};
        const [updated] = await tx.execute('UPDATE seguimiento_actividad SET estado = ? WHERE id_seguimiento = ? AND estado = \'pending\'', [resultado, id]);
        if (updated.affectedRows !== 1) return { code: 'decided' };
        const [decision] = await tx.execute('INSERT INTO seguimiento_decision (id_seguimiento, resultado, motivo, decidido_por,decidido_en) VALUES (?, ?, ?, ?,UTC_TIMESTAMP(3))', [id, resultado, motivo.trim(), actor]);
        await tx.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)', [`followup_${resultado}:${id}:${decision.insertId}`, actor]);
        return { id_seguimiento: id, resultado, motivo: motivo.trim(), decidido_por: actor, decidido_en: new Date().toISOString() };
      });
      if(result.code==='period_closed')return res.status(409).json({error:'El período está cerrado.'});
      if (result.code === 'missing') return res.status(404).json({ error: 'Seguimiento no encontrado.' });
      if (result.code === 'decided') return res.status(409).json({ error: 'El seguimiento ya tiene una decisión.' });
      if (result.code === 'self_decision') return res.status(403).json({ error: 'Quien registró el seguimiento no puede aprobarlo ni rechazarlo.' });
      return res.json(result);
    } catch(error) { if(error instanceof IntegrationError)return res.status(error.status).json({code:error.code}); return res.status(503).json({ error: 'No fue posible registrar la decisión.' }); }
  }

  async function summary(req, res) {
    const periodId = idValue(req.params?.id ?? req.query?.periodId);
    if (!periodId) return res.status(400).json({ error: 'Identificador de período inválido.' });
    try {
      const [periods] = await pool.query(`SELECT ${PERIOD_FIELDS} FROM periodo_seguimiento WHERE id_periodo = ? LIMIT 1`, [periodId]);
      if (!periods.length) return res.status(404).json({ error: 'Período no encontrado.' });
      const frozen=periods[0].estado==='closed'?await closedPeriodSnapshot(pool,periodId):null;
      if(frozen){
        const approved=frozen.rows.filter(r=>r.porcentaje_aprobado!=null);
        const[items]=frozen.rows.length?await pool.query(`SELECT COUNT(DISTINCT id_actividad) AS n FROM seguimiento_actividad WHERE id_periodo=? AND estado='pending' AND id_actividad IN (${frozen.rows.map(()=>'?').join(',')})`,[periodId,...frozen.rows.map(r=>r.id_actividad)]):[[{n:0}]];
        return res.json({period:periods[0],activitiesDue:frozen.rows.length,activitiesApproved:approved.length,activitiesPending:items[0]?.n??0,closedSnapshotAvailable:true,summary:generarResumenSeguimientoTrimestral(approved.map(r=>Number(r.porcentaje_aprobado)),approved.length,frozen.rows.length)});
      }
      const [rows] = await pool.query(`SELECT a.id_actividad,
          (SELECT s.porcentaje FROM seguimiento_actividad AS s WHERE s.id_actividad = a.id_actividad AND s.id_periodo = ? AND s.estado = 'approved' ORDER BY s.id_seguimiento DESC LIMIT 1) AS porcentaje_aprobado,
          EXISTS(SELECT 1 FROM seguimiento_actividad AS s WHERE s.id_actividad = a.id_actividad AND s.id_periodo = ? AND s.estado = 'pending') AS pendiente
        FROM actividad AS a WHERE a.fecha_fin IS NOT NULL AND a.fecha_fin <= ? AND (a.fecha_inicio IS NULL OR a.fecha_inicio <= ?)`,
        [periodId, periodId, periods[0].fecha_fin, periods[0].fecha_fin]);
      const approved = rows.filter((row) => row.porcentaje_aprobado != null);
      const pending = rows.filter((row) => row.pendiente === 1 || row.pendiente === true);
      const summary = generarResumenSeguimientoTrimestral(approved.map((row) => Number(row.porcentaje_aprobado)), approved.length, rows.length);
      return res.json({ period: periods[0], activitiesDue: rows.length, activitiesApproved: approved.length,
        activitiesPending: pending.length, summary });
    } catch { return res.status(503).json({ error: 'No fue posible generar el resumen del período.' }); }
  }

  return Object.freeze({ listPeriods, createPeriod, closePeriod, listActivities, getActivityHistory, listPeriodHistory, createFollowup, decideFollowup, summary });
}

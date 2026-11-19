import { activityScopeFilter } from '../services/activity-access.js';
import { assertWorkflowEditable, attachWorkflowStates } from '../services/plan-workflow.guard.js';
import { WorkflowError } from '../services/plan-workflow.rules.js';
import { normalizeDraft, attachDrafts, saveDraft, DraftError } from '../services/institutional-draft.service.js';
import { createMysqlTransactionManager } from '../services/mysql-transaction-manager.js';

const MAX_INT = 2_147_483_647;
const BASE_COLUMNS = "id_actividad, descripcion, responsable, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin, estado, id_plan";

function parseId(value) {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_INT ? id : null;
}

function validDate(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1000) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateActivity(body, { withPlanId = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const descripcion = body.descripcion == null || body.descripcion === '' ? null : body.descripcion;
  const responsable = body.responsable == null || body.responsable === '' ? null : body.responsable;
  const estado = body.estado == null || body.estado === '' ? null : body.estado;
  if ((descripcion != null && (typeof descripcion !== 'string' || descripcion.includes('\u0000') || Buffer.byteLength(descripcion, 'utf8') > 65_535)) ||
      (responsable != null && (typeof responsable !== 'string' || responsable.trim() === '' || responsable.trim().length > 100)) ||
      (estado != null && (typeof estado !== 'string' || estado.trim() === '' || estado.trim().length > 50)) ||
      !validDate(body.fecha_inicio) || !validDate(body.fecha_fin)) return null;
  const fecha_inicio = body.fecha_inicio || null;
  const fecha_fin = body.fecha_fin || null;
  if (fecha_inicio && fecha_fin && fecha_inicio > fecha_fin) return null;
  const result = { descripcion, responsable: responsable?.trim() ?? null, fecha_inicio, fecha_fin, estado: estado?.trim() ?? null };
  if (withPlanId) {
    result.id_plan = parseId(body.id_plan);
    if (!result.id_plan) return null;
  }
  return result;
}

function actorId(req) { return parseId(req?.usuario?.sub); }

export function createActivityController(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') {
    throw new TypeError('A mysql2/promise pool is required for activity operations.');
  }
  const transactions = createMysqlTransactionManager(pool);

  async function list(req, res) {
    const planId = req.query?.planId == null || req.query.planId === '' ? null : parseId(req.query.planId);
    const estado = req.query?.estado;
    const responsable = req.query?.responsable;
    if ((req.query?.planId != null && req.query.planId !== '' && !planId) ||
        (estado != null && (typeof estado !== 'string' || estado.length > 50)) ||
        (responsable != null && (typeof responsable !== 'string' || responsable.length > 100))) {
      return res.status(400).json({ error: 'Filtros de actividad inválidos.' });
    }
    const clauses = [];
    const params = [];
    if (planId) { clauses.push('id_plan = ?'); params.push(planId); }
    if (estado) { clauses.push('estado = ?'); params.push(estado); }
    if (responsable) { clauses.push('responsable LIKE ?'); params.push(`%${responsable}%`); }
    const scope = activityScopeFilter(req.activityAccess, params, '');
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}${scope}` : scope ? ` WHERE 1 = 1${scope}` : '';
    try {
      const [rows] = await pool.query(`SELECT ${BASE_COLUMNS} FROM actividad${where} ORDER BY id_actividad`, params);
      return res.json(await attachWorkflowStates(pool,await attachDrafts(pool, Array.isArray(rows) ? rows : [], 'actividad'),'actividad'));
    } catch { return res.status(503).json({ error: 'No fue posible consultar las actividades temporalmente.' }); }
  }

  async function getById(req, res) {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: 'Identificador de actividad inválido.' });
    try {
      const [rows] = await pool.query(`SELECT ${BASE_COLUMNS} FROM actividad WHERE id_actividad = ? LIMIT 1`, [id]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Actividad no encontrada.' });
      return res.json((await attachWorkflowStates(pool,await attachDrafts(pool, rows, 'actividad'),'actividad'))[0]);
    } catch { return res.status(503).json({ error: 'No fue posible consultar la actividad temporalmente.' }); }
  }

  async function create(req, res) {
    const userId = actorId(req);
    const input = validateActivity(req.body, { withPlanId: true });
    if (!userId) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!input) return res.status(400).json({ error: 'Revisa los datos y las fechas de la actividad.' });
    try {
      const draft = normalizeDraft(req.body, 'actividad');
      const result = await transactions.run(async (tx) => {
        const [plans] = await tx.execute('SELECT id_plan FROM plan_accion WHERE id_plan = ? LIMIT 1 FOR UPDATE', [input.id_plan]);
        if (!Array.isArray(plans) || !plans.length) return { missingPlan: true };
        await assertWorkflowEditable(tx,input.id_plan);
        const [insert] = await tx.execute(`INSERT INTO actividad (descripcion, responsable, fecha_inicio, fecha_fin, estado, id_plan)
          VALUES (?, ?, ?, ?, ?, ?)`, [input.descripcion, input.responsable, input.fecha_inicio, input.fecha_fin, input.estado, input.id_plan]);
        if (!Number.isSafeInteger(insert?.insertId) || insert.insertId < 1) throw new Error('ACTIVITY_INSERT_FAILED');
        await tx.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)', [`actividad_created:${insert.insertId}`, userId]);
        await saveDraft(tx, 'actividad', insert.insertId, input.id_plan, draft, userId);
        return { activity: { id_actividad: insert.insertId, ...input } };
      });
      if (result.missingPlan) return res.status(404).json({ error: 'Plan no encontrado.' });
      return res.status(201).json(result.activity);
    } catch (error) { if (error instanceof DraftError || error instanceof WorkflowError) return res.status(error.status).json({ error: error.message }); return res.status(503).json({ error: 'No fue posible crear la actividad temporalmente.' }); }
  }

  async function update(req, res) {
    const userId = actorId(req);
    const id = parseId(req.params?.id);
    const input = validateActivity(req.body);
    if (!userId) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!id || !input) return res.status(400).json({ error: 'Revisa los datos y las fechas de la actividad.' });
    try {
      const draft = normalizeDraft(req.body, 'actividad');
      const result = await transactions.run(async (tx) => {
        const [rows] = await tx.execute(`SELECT ${BASE_COLUMNS} FROM actividad WHERE id_actividad = ? LIMIT 1 FOR UPDATE`, [id]);
        if (!Array.isArray(rows) || !rows.length) return { missing: true };
        await assertWorkflowEditable(tx,rows[0].id_plan);
        await tx.execute(`UPDATE actividad SET descripcion = ?, responsable = ?, fecha_inicio = ?, fecha_fin = ?, estado = ? WHERE id_actividad = ?`,
          [input.descripcion, input.responsable, input.fecha_inicio, input.fecha_fin, input.estado, id]);
        await tx.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)', [`actividad_updated:${id}`, userId]);
        await saveDraft(tx, 'actividad', id, rows[0].id_plan, draft, userId);
        return { activity: { ...rows[0], ...input } };
      });
      if (result.missing) return res.status(404).json({ error: 'Actividad no encontrada.' });
      return res.json(result.activity);
    } catch (error) { if (error instanceof DraftError || error instanceof WorkflowError) return res.status(error.status).json({ error: error.message }); return res.status(503).json({ error: 'No fue posible actualizar la actividad temporalmente.' }); }
  }

  return Object.freeze({ list, getById, create, update });
}

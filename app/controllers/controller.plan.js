import { assertWorkflowEditable, attachWorkflowStates, workflowSchemaReady } from '../services/plan-workflow.guard.js';
import { WorkflowError } from '../services/plan-workflow.rules.js';
import { normalizeDraft, attachDrafts, saveDraft, DraftError } from '../services/institutional-draft.service.js';
import { createMysqlTransactionManager } from '../services/mysql-transaction-manager.js';

const SQL_LISTAR_PLANES =
  'SELECT id_plan, nombre, descripcion, fecha_creacion, estado FROM plan_accion';
const SQL_OBTENER_PLAN =
  'SELECT id_plan, nombre, descripcion, fecha_creacion, estado FROM plan_accion WHERE id_plan = ? LIMIT 1';
const MAX_INT = 2_147_483_647;

function idValido(value) {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_INT ? id : null;
}

function validarPlan(body) {
  const nombre = body?.nombre;
  const descripcion = body?.descripcion;
  if (typeof nombre !== 'string' || nombre.trim() === '' || nombre.trim().length > 150 ||
      (descripcion != null && (typeof descripcion !== 'string' || descripcion.includes('\u0000') || Buffer.byteLength(descripcion, 'utf8') > 65535))) return null;
  return { nombre: nombre.trim(), descripcion: descripcion == null || descripcion === '' ? null : descripcion };
}

function actorId(req) { return idValido(req?.usuario?.sub); }

async function enTransaccion(pool, work) {
  return createMysqlTransactionManager(pool).run(work);
}

/**
 * Crea controladores de consulta con acceso a datos inyectado para mantener
 * las pruebas aisladas y evitar una conexión real durante su ejecución.
 */
export function crearControladorConsultaPlanes(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('Se requiere un pool de consultas para consultar planes.');
  }

  async function listarPlanes(req, res) {
    try {
      const [rows] = await pool.query(SQL_LISTAR_PLANES);
      return res.json(await attachWorkflowStates(pool, await attachDrafts(pool, rows, 'plan')));
    } catch {
      return res.status(503).json({
        error: 'No fue posible consultar los planes temporalmente.'
      });
    }
  }

  async function obtenerPlan(req, res) {
    const id = idValido(req.params?.id);

    if (!id) {
      return res.status(400).json({ error: 'Identificador de plan inválido.' });
    }

    try {
      const [rows] = await pool.query(SQL_OBTENER_PLAN, [id]);
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(404).json({ error: 'Plan no encontrado.' });
      }

      return res.json((await attachWorkflowStates(pool, await attachDrafts(pool, rows, 'plan')))[0]);
    } catch {
      return res.status(503).json({
        error: 'No fue posible consultar el plan temporalmente.'
      });
    }
  }

  async function crearPlan(req, res) {
    const usuarioId = actorId(req);
    const input = validarPlan(req.body);
    if (!usuarioId) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!input) return res.status(400).json({ error: 'Revisa el nombre y la descripción del plan.' });
    try {
      const draft = normalizeDraft(req.body, 'plan');
      const plan = await enTransaccion(pool, async (connection) => {
        const [created] = await connection.execute(
          'INSERT INTO plan_accion (nombre, descripcion, fecha_creacion, id_usuario) VALUES (?, ?, UTC_DATE(), ?)',
          [input.nombre, input.descripcion, usuarioId]
        );
        if (!Number.isSafeInteger(created?.insertId) || created.insertId < 1) throw new Error('PLAN_INSERT_FAILED');
        await connection.execute(
          'INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)',
          [`plan_accion_created:${created.insertId}`, usuarioId]
        );
        await saveDraft(connection, 'plan', created.insertId, created.insertId, draft, usuarioId);
        return { id_plan: created.insertId, nombre: input.nombre, descripcion: input.descripcion, estado: null };
      });
      return res.status(201).json(plan);
    } catch (error) {
      if (error instanceof DraftError || error instanceof WorkflowError) return res.status(error.status).json({ error: error.message });
      return res.status(503).json({ error: 'No fue posible crear el plan temporalmente.' });
    }
  }

  async function actualizarPlan(req, res) {
    const usuarioId = actorId(req);
    const id = idValido(req.params?.id);
    const input = validarPlan(req.body);
    if (!usuarioId) return res.status(401).json({ error: 'Autenticación requerida.' });
    if (!id || !input) return res.status(400).json({ error: 'Revisa el identificador, nombre y descripción del plan.' });
    try {
      const draft = normalizeDraft(req.body, 'plan');
      const result = await enTransaccion(pool, async (connection) => {
        const [found] = await connection.execute(
          'SELECT id_plan, nombre, descripcion, fecha_creacion, estado FROM plan_accion WHERE id_plan = ? LIMIT 1 FOR UPDATE', [id]
        );
        if (!Array.isArray(found) || found.length === 0) return { missing: true };
        await assertWorkflowEditable(connection,id);
        await connection.execute('UPDATE plan_accion SET nombre = ?, descripcion = ? WHERE id_plan = ?',
          [input.nombre, input.descripcion, id]);
        await connection.execute('INSERT INTO historico (accion, fecha, id_usuario) VALUES (?, UTC_DATE(), ?)',
          [`plan_accion_updated:${id}`, usuarioId]);
        await saveDraft(connection, 'plan', id, id, draft, usuarioId);
        return { plan: { ...found[0], nombre: input.nombre, descripcion: input.descripcion } };
      });
      if (result.missing) return res.status(404).json({ error: 'Plan no encontrado.' });
      return res.json(result.plan);
    } catch (error) {
      if (error instanceof DraftError || error instanceof WorkflowError) return res.status(error.status).json({ error: error.message });
      return res.status(503).json({ error: 'No fue posible actualizar el plan temporalmente.' });
    }
  }

  async function catalogoInstitucional(req, res) {
    try {
      const [procesos] = await pool.query('SELECT id_proceso,nombre FROM proceso_institucional WHERE activo=1 ORDER BY nombre');
      const workflowAvailable = await workflowSchemaReady(pool);
      return res.json({ procesos, workflowAvailable });
    } catch { return res.status(503).json({ error: 'El catálogo institucional no está disponible.' }); }
  }
  return { listarPlanes, obtenerPlan, crearPlan, actualizarPlan, catalogoInstitucional };
}

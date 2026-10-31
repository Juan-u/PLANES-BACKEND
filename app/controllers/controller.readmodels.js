const MAX_INT = 2_147_483_647;
const EVIDENCE_COLUMNS = 'e.id_evidencia, e.fecha_subida, e.observaciones, e.id_actividad';
const REPORT_COLUMNS = 'c.id_calificacion, c.trimestre, c.puntaje, c.observaciones_planeacion, c.id_plan, p.nombre AS nombre_plan';

function idValue(value) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_INT ? parsed : null;
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createReadModelsController(pool) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A query pool is required.');

  async function listEvidenceByActivity(req, res) {
    const activityId = idValue(req.params?.id);
    if (!activityId) return res.status(400).json({ error: 'Identificador de actividad inválido.' });
    try {
      const [rows] = await pool.query(`SELECT ${EVIDENCE_COLUMNS} FROM evidencia AS e
        JOIN actividad AS a ON a.id_actividad = e.id_actividad
        WHERE a.id_actividad = ? ORDER BY e.fecha_subida DESC, e.id_evidencia DESC`, [activityId]);
      return res.json(Array.isArray(rows) ? rows : []);
    } catch { return res.status(503).json({ error: 'No fue posible consultar las evidencias temporalmente.' }); }
  }

  async function listAssessments(req, res) {
    const planId = req.query?.planId == null || req.query.planId === '' ? null : idValue(req.query.planId);
    const quarterRaw = req.query?.trimestre;
    const quarter = quarterRaw == null || quarterRaw === '' ? null : idValue(quarterRaw);
    if ((req.query?.planId != null && req.query.planId !== '' && !planId) ||
        (quarterRaw != null && quarterRaw !== '' && !quarter)) return res.status(400).json({ error: 'Filtros de informe inválidos.' });
    const clauses = [];
    const params = [];
    if (planId) { clauses.push('c.id_plan = ?'); params.push(planId); }
    if (quarter) { clauses.push('c.trimestre = ?'); params.push(quarter); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
      const [rows] = await pool.query(`SELECT ${REPORT_COLUMNS} FROM calificacion AS c
        LEFT JOIN plan_accion AS p ON p.id_plan = c.id_plan ${where}
        ORDER BY c.trimestre, c.id_plan, c.id_calificacion`, params);
      return res.json(Array.isArray(rows) ? rows : []);
    } catch { return res.status(503).json({ error: 'No fue posible consultar el informe temporalmente.' }); }
  }

  async function exportAssessments(req, res) {
    const proxy = {
      status(code) { res.status(code); return this; },
      json(body) { this.body = body; return this; }
    };
    await listAssessments(req, proxy);
    if (proxy.body && proxy.body.error) return res.status(res.statusCode || 503).json(proxy.body);
    const rows = proxy.body ?? [];
    const headers = ['id_calificacion', 'trimestre', 'puntaje', 'observaciones_planeacion', 'id_plan', 'nombre_plan'];
    const csv = [headers, ...rows.map((row) => headers.map((field) => row[field]))]
      .map((line) => line.map(csvCell).join(',')).join('\r\n');
    return res.status(200).type('text/csv; charset=utf-8').attachment('calificaciones.csv').send(`\uFEFF${csv}`);
  }

  return Object.freeze({ listEvidenceByActivity, listAssessments, exportAssessments });
}

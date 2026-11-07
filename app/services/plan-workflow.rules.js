import { validarCamposObligatoriosIndicador } from './plan.validation.service.js';

export const WORKFLOW_LABELS = Object.freeze({ borrador: 'Borrador', presentado: 'Presentado a Planeación', en_revision: 'En revisión', devuelto: 'Devuelto para correcciones', aprobado: 'Aprobado' });
export const ACTIONS = Object.freeze(['presentar','recibir','observar','devolver','aprobar']);
const transitions = Object.freeze({
  presentar: { borrador: 'presentado', devuelto: 'presentado' },
  recibir: { presentado: 'en_revision' },
  observar: { en_revision: 'en_revision' },
  devolver: { en_revision: 'devuelto' },
  aprobar: { en_revision: 'aprobado' }
});
export class WorkflowError extends Error {
  constructor(code, status = 400, details) { super(code); this.code = code; this.status = status; this.details = details; }
}
export function positiveId(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value))) throw new WorkflowError('INVALID_ID');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new WorkflowError('INVALID_ID');
  return id;
}
export function revisionNumber(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) throw new WorkflowError('INVALID_REVISION');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647) throw new WorkflowError('INVALID_REVISION');
  return n;
}
export function eventCursor(value) {
  const cursor=String(value??'');
  if(!/^[1-9]\d{0,19}$/.test(cursor)||BigInt(cursor)>18446744073709551615n)throw new WorkflowError('INVALID_CURSOR');
  return cursor;
}
export function calendarDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1000) throw new WorkflowError('INVALID_DATE');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10) !== value) throw new WorkflowError('INVALID_DATE');
  return value;
}
export function nextState(state, action) {
  if (!ACTIONS.includes(action)) throw new WorkflowError('INVALID_ACTION');
  const next = transitions[action][state];
  if (!next) throw new WorkflowError('INVALID_TRANSITION', 409);
  return next;
}
export function observation(value, required = false) {
  if (value == null || value === '') { if (required) throw new WorkflowError('REASON_REQUIRED'); return null; }
  if (typeof value !== 'string' || value.includes('\0') || value.trim().length > 10000 || Buffer.byteLength(value) > 60000) throw new WorkflowError('INVALID_OBSERVATION');
  const text = value.trim();
  if (required && !text) throw new WorkflowError('REASON_REQUIRED');
  return text || null;
}
const present = value => typeof value === 'string' && value.trim() !== '';

/** Master rules only. Conditional institutional requirements stay explicitly unresolved. */
export function validatePresentation(plan, profile, activities, context = {}) {
  const missing = [], unresolved = [];
  const add = (field, message, activityId) => missing.push({ field, message, ...(activityId ? { activityId } : {}) });
  const d = plan.institucional || {};
  if (!d.id_proceso || !context.processActive) add('id_proceso','Selecciona un proceso activo del catálogo autorizado.');
  for (const [key,label] of [['problema','Problema o situación'],['causas','Causas'],['consecuencias','Consecuencias'],['objetivo_general','Objetivo general'],['meta_descripcion','Meta / resultado esperado']]) if (!present(d[key])) add(key,`Completa: ${label}.`);
  if (!d.objetivos?.some(o => present(o.descripcion))) add('objetivos','Registra al menos un objetivo específico.');
  for (const message of validarCamposObligatoriosIndicador(d.indicador?.nombre,d.indicador?.descripcion).errores) add('indicador',message);
  if (!profile.responsable_propuesto_id) add('responsable','Identifica al responsable principal propuesto.');
  else if (!context.responsibleActive) add('responsable','El responsable propuesto debe corresponder a una cuenta activa.');
  if (!context.responsibleAuthorized) unresolved.push({ field:'responsable_autorizado', message:'Falta confirmar la designación institucional del responsable principal.' });
  for (const key of ['fecha_inicio','fecha_fin']) if (!profile[key]) add(key,`Completa ${key === 'fecha_inicio' ? 'la fecha de inicio' : 'la fecha de finalización'} del plan.`);
  if (profile.fecha_inicio && profile.fecha_fin && profile.fecha_inicio > profile.fecha_fin) add('fechas','El inicio del plan debe ser anterior o igual a su finalización.');
  if (!activities.length) add('actividades','Asocia al menos una actividad al plan.');
  if (activities.length && !context.activityResponsibilitiesAuthorized) unresolved.push({field:'responsables_actividades',message:'Falta confirmar las designaciones autorizadas de responsables de las actividades; el texto de un nombre no acredita autorización.'});
  const ids = new Set((d.objetivos || []).map(o => Number(o.id)));
  for (const a of activities) {
    const i = a.institucional || {};
    for (const [field,value,label] of [['descripcion',a.descripcion,'descripción'],['resultado_esperado',i.resultado_esperado,'resultado esperado'],['responsable',a.responsable,'responsable principal'],['metodo_verificacion',i.metodo_verificacion,'método de verificación']]) if (!present(value)) add(field,`Actividad #${a.id_actividad}: completa ${label}.`,a.id_actividad);
    if (!ids.has(Number(i.id_objetivo))) add('id_objetivo',`Actividad #${a.id_actividad}: asocia un objetivo específico del plan.`,a.id_actividad);
    if (!['alta','media','baja'].includes(i.prioridad)) add('prioridad',`Actividad #${a.id_actividad}: indica la prioridad.`,a.id_actividad);
    for (const key of ['fecha_inicio','fecha_fin']) {
      try { if (!calendarDate(a[key])) add(key,`Actividad #${a.id_actividad}: completa ${key}.`,a.id_actividad); }
      catch { add(key,`Actividad #${a.id_actividad}: revisa ${key}.`,a.id_actividad); }
    }
    if (a.fecha_inicio && a.fecha_fin && a.fecha_inicio > a.fecha_fin) add('fechas',`Actividad #${a.id_actividad}: el inicio es posterior al fin.`,a.id_actividad);
  }
  if (!context.conditionalRulesConfirmed) unresolved.push({field:'reglas_condicionales',message:'Falta confirmar cuándo son exigibles valor/unidad de meta y fórmula/unidad/fuente del indicador. Las evidencias esperadas son opcionales según el Documento Maestro.'});
  if (context.conditionalRulesConfirmed) {
    const conditional = {meta_valor:d.meta_valor,meta_unidad:d.meta_unidad,'indicador.formula':d.indicador?.formula,'indicador.unidad':d.indicador?.unidad,'indicador.fuente':d.indicador?.fuente};
    for (const field of context.requiredFields || []) {
      if(field==='actividades.evidencias_esperadas') {
        for(const a of activities)if(!present(a.institucional?.evidencias_esperadas))add(field,`Actividad #${a.id_actividad}: completa las evidencias esperadas exigidas por la regla institucional confirmada.`,a.id_actividad);
      } else if(Object.hasOwn(conditional,field)) {
        if(conditional[field]==null||conditional[field]==='')add(field,`Completa el campo condicional confirmado: ${field}.`);
      } else unresolved.push({field:'regla_condicional_desconocida',message:'La regla institucional requiere un campo que este bloque no interpreta; no se certifica su cumplimiento.'});
    }
  }
  return { complete: missing.length === 0 && unresolved.length === 0, missing, unresolved };
}

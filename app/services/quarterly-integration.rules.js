import { generarResumenSeguimientoTrimestral } from './quarterly.followup.service.js';
import { conservarAvanceAprobadoActividadSuspendida, obtenerAvanceActividadVencida } from './activity.progress.service.js';
export const EVIDENCE_LIMIT = 10 * 1024 * 1024;
export class IntegrationError extends Error { constructor(code,status=400){super(code);this.code=code;this.status=status;} }
export function approvedValue(value) {
  if(value==null)return null;
  if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^\d{1,3}(?:\.\d+)?$/.test(value))throw new IntegrationError('INVALID_APPROVED_DATA',503);
  const n=Number(value);if(!Number.isFinite(n)||n<0||n>100)throw new IntegrationError('INVALID_APPROVED_DATA',503);return n;
}
export function progress(row) {
  const quarter=approvedValue(row.porcentaje_trimestral),last=approvedValue(row.ultimo_aprobado);
  const state=String(row.estado||'').toLowerCase();
  const general=['suspendida','suspended'].includes(state)?conservarAvanceAprobadoActividadSuspendida(last):['vencida','overdue'].includes(state)?obtenerAvanceActividadVencida(last).avance:last;
  return {quarterApproved:quarter,lastApproved:general,completedStateInconsistent:['completada','completed'].includes(state)&&last!==100};
}
export function officialSummary(rows) {
  const approved=rows.filter(r=>r.due&&r.progress.quarterApproved!=null);
  const due=rows.filter(r=>r.due);
  return {activitiesDue:due.length,activitiesApproved:approved.length,activitiesPending:due.filter(r=>r.pendingId).length,summary:generarResumenSeguimientoTrimestral(approved.map(r=>r.progress.quarterApproved),approved.length,due.length)};
}
export function completion(rows,requirements) {
  if(!rows.length)return {state:'no_aplica',complete:false,reason:'No hay actividades aplicables.'};
  if(rows.some(r=>r.progress.lastApproved==null||r.progress.lastApproved!==100))return {state:'pendiente',complete:false,reason:'Se requiere 100 % aprobado en todas las actividades aplicables.'};
  if(!requirements?.confirmed||!requirements.reference)return {state:'pendiente_verificacion',complete:false,reason:'Falta confirmar los requisitos institucionales de evidencia; cargar archivos no equivale a aprobarlos.'};
  if(rows.some(r=>!requirements.verifiedActivityIds?.includes(r.id_actividad)))return {state:'pendiente_verificacion',complete:false,reason:'Hay requisitos de evidencia sin verificación institucional.'};
  return {state:'requisitos_cumplidos',complete:true,reason:'Todas las actividades tienen 100 % aprobado y requisitos de evidencia verificados. No cambia el estado del plan.'};
}

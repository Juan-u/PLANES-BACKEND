import {positiveId} from './plan-workflow.rules.js';
import {IntegrationError} from './quarterly-integration.rules.js';
export function reportFilters(input={}) {
 const out={};
 for(const key of ['planId','activityId','processId','objectiveId','periodId'])if(input[key]!=null&&input[key]!=='')out[key]=positiveId(input[key]);
 for(const [key,min,max]of [['anio',1000,9999],['trimestre',1,4]])if(input[key]!=null&&input[key]!==''){if(!['number','string'].includes(typeof input[key]))throw new IntegrationError('INVALID_FILTER');const v=String(input[key]);if(!/^\d+$/.test(v)||Number(v)<min||Number(v)>max)throw new IntegrationError('INVALID_FILTER');out[key]=Number(v);}
 for(const key of ['responsable','planState'])if(input[key]!=null&&input[key]!==''){if(typeof input[key]!=='string'||input[key].length>150||/[\x00-\x1f]/.test(input[key]))throw new IntegrationError('INVALID_FILTER');out[key]=input[key].trim();}
 if(input.followupState){if(!['pending','approved','rejected','missing'].includes(input.followupState))throw new IntegrationError('INVALID_FILTER');out.followupState=input.followupState;}
 if(out.planState&&!['sin_expediente','borrador','presentado','en_revision','devuelto','aprobado'].includes(out.planState))throw new IntegrationError('INVALID_FILTER');
 return out;
}
export function csvCell(value){let s=value==null?'':String(value);if(/^[\s\uFEFF]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function reportCsv(report){
 const header=['seccion','id','plan','actividad','periodo','estado','caracter','descripcion','porcentaje_aprobado','porcentaje_presentado','cobertura','observaciones','datos_adicionales'];
 const rows=[header,['identificacion',report.meta.id,'','','','','analitico','','','','','',JSON.stringify(report.meta)],['filtros','','','','','','analitico','','','','','',JSON.stringify(report.filters)]];
 for(const s of report.summary)rows.push(['indicadores','',report.filters.planId??'','',s.period.id_periodo,'','analitico',s.period.anio+' / T'+s.period.trimestre,typeof s.summary.promedioAvance==='number'?s.summary.promedioAvance:'Información no disponible','',typeof s.summary.coberturaTrimestral==='number'?s.summary.coberturaTrimestral:'No aplica','',JSON.stringify({exigibles:s.activitiesDue,aprobadas:s.activitiesApproved,sinAprobacion:s.activitiesWithoutApproval,pendientes:s.activitiesPending})]);
 for(const a of report.activities)rows.push(['actividad',a.id_actividad,a.id_plan,a.id_actividad,a.id_periodo,a.plan_estado,'analitico',a.descripcion,a.progress.quarterApproved??'Información no disponible','','','',JSON.stringify({plan:a.plan_nombre,proceso:a.proceso,objetivo:a.objetivo,responsable:a.responsable,indicador:a.indicador,formula:a.formula,unidad:a.unidad,fuente:a.fuente})]);
 for(const s of report.followups)rows.push(['seguimiento',s.id_seguimiento,'',s.id_actividad,s.id_periodo,s.estado,s.estado==='approved'?'dato_aprobado':'provisional','',s.estado==='approved'?s.porcentaje:'',s.porcentaje,'',s.observaciones,JSON.stringify({observacionPlaneacion:s.observacion_planeacion,autor:s.creado_por,fecha:s.creado_en})]);
 for(const e of report.evidence)rows.push(['evidencia',e.id_evidencia,'',e.id_actividad,'',e.decision_institucional||'sin_aprobacion','analitico',e.nombre_original||'Referencia histórica','','','',e.observaciones,JSON.stringify({seguimiento:e.id_seguimiento,tipo:e.mime_type,bytes:e.bytes})]);
 for(const h of report.history)rows.push(['actuacion',h.id_evento,h.id_plan,'','',h.estado_nuevo,'analitico',h.accion,'','','',h.observacion,JSON.stringify({autor:h.actor_id,fecha:h.creado_en})]);
 return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function controlText(value,{required=false,max=10000}={}){if(value==null&&!required)return null;if(typeof value!=='string'||value.length>max||value.includes('\0')||required&&!value.trim())throw new IntegrationError('INVALID_CONTROL_TEXT');return value.trim()||null;}

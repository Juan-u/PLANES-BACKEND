import {createHash,randomUUID} from 'node:crypto';
import {createMysqlTransactionManager} from './mysql-transaction-manager.js';
import {createAuthorizationMutexRepository} from '../repositories/roles/authorization-mutex.repository.js';
import {createAuthorizationRepository} from '../repositories/roles/authorization.repository.js';
import {IntegrationError,officialSummary,progress} from './quarterly-integration.rules.js';
import {closedPeriodSnapshot} from './quarterly-integration.context.js';
import {reportFilters} from './institutional-report.rules.js';
import {positiveId} from './plan-workflow.rules.js';
const unavailable=()=>{throw new IntegrationError('REPORT_TOO_LARGE_REFINE_FILTERS',422);};
export function createReportAccess(pool){
 const transactions=createMysqlTransactionManager(pool),mutex=createAuthorizationMutexRepository(),auth=createAuthorizationRepository({mutex});
 const can=(tx,actorId,permissionCode)=>auth.canAccess({actorId,permissionCode,scopeRef:null},tx);
 return {can,run(context,codes,work){const actorId=positiveId(context?.actorId);return transactions.run(raw=>mutex.withLock(raw,async tx=>{
  const[actors]=await tx.execute("SELECT id_usuario FROM usuario WHERE id_usuario=? AND LOWER(estado)='activo'",[actorId]);if(actors.length!==1)throw new IntegrationError('AUTHENTICATION_REQUIRED',401);
  for(const code of codes)if(!await can(tx,actorId,code))throw new IntegrationError('FORBIDDEN',403);
  return work(tx,actorId);
 }));}};
}
export async function reportsSchemaReady(tx){const[[r]]=await tx.query(`SELECT
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('control_hallazgo','control_recomendacion','control_evento','informe_generacion')) AS tables_ready,
 (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('ce_no_update','ce_no_delete','ig_no_update','ig_no_delete')) AS triggers_ready,
 (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('control_hallazgo','control_recomendacion','control_evento','informe_generacion')) AS relations_ready`);return Number(r.tables_ready)===4&&Number(r.triggers_ready)===4&&Number(r.relations_ready)===8;}
export function createInstitutionalReportService({pool,clock=()=>new Date(),ids={next:randomUUID},institution=null}={}){
 const access=createReportAccess(pool);
 async function build(tx,actorId,filters){
  const p=[],where=[];
  for(const [key,col]of [['planId','a.id_plan'],['activityId','a.id_actividad'],['processId','pi.id_proceso'],['objectiveId','ai.id_objetivo'],['planState','COALESCE(pf.estado,\'sin_expediente\')']])if(filters[key]!=null){where.push(col+'=?');p.push(filters[key]);}
  if(filters.responsable){where.push('(a.responsable=? OR pi.responsable_principal=?)');p.push(filters.responsable,filters.responsable);}
  const[base]=await tx.execute(`SELECT a.id_actividad,a.id_plan,a.descripcion,a.responsable,a.estado,DATE_FORMAT(a.fecha_inicio,'%Y-%m-%d') AS fecha_inicio,DATE_FORMAT(a.fecha_fin,'%Y-%m-%d') AS fecha_fin,
   p.nombre AS plan_nombre,pi.id_proceso,pr.nombre AS proceso,pi.responsable_principal,ai.id_objetivo,o.descripcion AS objetivo,
   COALESCE(pf.estado,'sin_expediente') AS plan_estado,ind.nombre AS indicador,ind.descripcion AS indicador_descripcion,ind.formula,ind.unidad,ind.fuente,
   g.porcentaje AS ultimo_aprobado FROM actividad a JOIN plan_accion p ON p.id_plan=a.id_plan
   LEFT JOIN plan_institucional pi ON pi.id_plan=p.id_plan LEFT JOIN proceso_institucional pr ON pr.id_proceso=pi.id_proceso
   LEFT JOIN actividad_institucional ai ON ai.id_actividad=a.id_actividad LEFT JOIN plan_objetivo o ON o.id_objetivo=ai.id_objetivo
   LEFT JOIN plan_flujo pf ON pf.id_plan=p.id_plan LEFT JOIN plan_indicador ind ON ind.id_plan=p.id_plan
   LEFT JOIN seguimiento_actividad g ON g.id_seguimiento=(SELECT MAX(s.id_seguimiento) FROM seguimiento_actividad s WHERE s.id_actividad=a.id_actividad AND s.estado='approved')
   ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY a.id_actividad LIMIT 501`,p);
  if(base.length>500)unavailable();
  const clauses=[],params=[];for(const[key,col]of [['periodId','id_periodo'],['anio','anio'],['trimestre','trimestre']])if(filters[key]){clauses.push(col+'=?');params.push(filters[key]);}
  const[periods]=await tx.execute(`SELECT id_periodo,anio,trimestre,estado,DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fecha_fin FROM periodo_seguimiento ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY anio,trimestre LIMIT 21`,params);
  if(periods.length>20)unavailable();if(filters.periodId&&!periods.length)throw new IntegrationError('PERIOD_NOT_FOUND',404);
  let followups=[],evidence=[],history=[];const activityIds=base.map(r=>r.id_actividad),planIds=[...new Set(base.map(r=>r.id_plan))];
  if(activityIds.length){
   const marks=activityIds.map(()=>'?').join(',');const periodWhere=periods.length?' AND s.id_periodo IN ('+periods.map(()=>'?').join(',')+')':' AND 1=0';
   [followups]=await tx.query(`SELECT CAST(s.id_seguimiento AS CHAR) AS id_seguimiento,s.id_actividad,s.id_periodo,s.porcentaje,s.estado,s.observaciones,s.creado_por,DATE_FORMAT(s.creado_en,'%Y-%m-%d %H:%i:%s') AS creado_en,d.motivo AS observacion_planeacion,d.decidido_por,DATE_FORMAT(d.decidido_en,'%Y-%m-%d %H:%i:%s') AS decidido_en FROM seguimiento_actividad s LEFT JOIN seguimiento_decision d ON d.id_seguimiento=s.id_seguimiento WHERE s.id_actividad IN (${marks})${periodWhere} ORDER BY s.id_seguimiento LIMIT 2001`,[...activityIds,...periods.map(r=>r.id_periodo)]);if(followups.length>2000)unavailable();
   if(await access.can(tx,actorId,'M13.evidence.read')){
    [evidence]=await tx.query(`SELECT e.id_evidencia,e.id_actividad,e.fecha_subida,e.observaciones,m.nombre_original,m.mime_type,m.bytes,CAST(l.id_seguimiento AS CHAR) AS id_seguimiento,d.resultado AS decision_institucional FROM evidencia e LEFT JOIN evidencia_archivo_meta m ON m.id_evidencia=e.id_evidencia LEFT JOIN seguimiento_evidencia l ON l.id_evidencia=e.id_evidencia LEFT JOIN evidencia_decision_institucional d ON d.id_evidencia=e.id_evidencia WHERE e.id_actividad IN (${marks}) ORDER BY e.id_evidencia LIMIT 2001`,activityIds);if(evidence.length>2000)unavailable();
   }
   [history]=await tx.query(`SELECT CAST(id_evento AS CHAR) AS id_evento,id_plan,accion,actor_id,DATE_FORMAT(creado_en,'%Y-%m-%d %H:%i:%s') AS creado_en,estado_anterior,estado_nuevo,observacion FROM plan_flujo_evento WHERE id_plan IN (${planIds.map(()=>'?').join(',')}) ORDER BY id_evento LIMIT 2001`,planIds);if(history.length>2000)unavailable();
  }
  let activities=[],summary=[];
  for(const period of periods){
   const frozen=period.estado==='closed'?await closedPeriodSnapshot(tx,period.id_periodo):null;
   const rows=base.map(r=>{const submissions=followups.filter(s=>s.id_actividad===r.id_actividad&&s.id_periodo===period.id_periodo),approved=submissions.filter(s=>s.estado==='approved').at(-1),old=frozen?.rows.find(s=>Number(s.id_actividad)===Number(r.id_actividad));return {...r,...(old?{fecha_inicio:old.fecha_inicio,fecha_fin:old.fecha_fin}:{}),id_periodo:period.id_periodo,anio:period.anio,trimestre:period.trimestre,due:frozen?!!old:!!r.fecha_fin&&r.fecha_fin<=period.fecha_fin&&(!r.fecha_inicio||r.fecha_inicio<=period.fecha_fin),progress:progress({...r,porcentaje_trimestral:frozen?old?.porcentaje_aprobado??null:approved?.porcentaje??null}),pendingId:submissions.find(s=>s.estado==='pending')?.id_seguimiento,followupStates:submissions.map(s=>s.estado),historicalSnapshot:!!frozen};});
   summary.push({period,...officialSummary(rows),activitiesWithoutApproval:rows.filter(r=>r.due&&r.progress.quarterApproved==null).length});
   activities.push(...rows.filter(r=>r.due&&(!filters.followupState||filters.followupState==='missing'&&r.progress.quarterApproved==null||r.followupStates.includes(filters.followupState))));
  }
  if(!periods.length)activities=base.map(r=>({...r,progress:progress({...r,porcentaje_trimestral:null}),id_periodo:null}));
  const visibleIds=new Set(activities.map(r=>r.id_actividad));followups=followups.filter(s=>visibleIds.has(s.id_actividad)&&(!filters.followupState||filters.followupState==='missing'||s.estado===filters.followupState));
  const followupIds=new Set(followups.map(s=>s.id_seguimiento));evidence=evidence.filter(e=>visibleIds.has(e.id_actividad)&&(!e.id_seguimiento||followupIds.has(e.id_seguimiento)));
  const visiblePlans=new Set(activities.map(r=>r.id_plan));history=history.filter(h=>visiblePlans.has(h.id_plan));
  const payload={filters,summary,activities,followups,evidence,history};
  const sha=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {...payload,meta:{id:ids.next(),generatedAt:clock().toISOString(),actorId,institution:institution||'Institución no configurada',title:'Informe de planes y seguimiento',character:'analitico',exportReady:await reportsSchemaReady(tx),officialPublication:false,contentSha256:sha,summaryScope:'Filtros de plan/proceso/responsable/objetivo/actividad; estado de seguimiento solo filtra el detalle.',limit:500,temporalBasis:'Fechas históricas sin zona presumida; referencias de formulación actuales salvo porcentajes de cierre versionados.'}};
 }
 const codes=['M12.reports.read','M03.plans.read','M04.activities.read','M05.followup.read'];
 return {
  query(context,input={}){const filters=reportFilters(input);return access.run(context,codes,(tx,actorId)=>build(tx,actorId,filters));},
  controlQuery(context,input={}){const filters=reportFilters(input);return access.run(context,['M15.audit.read',...codes.slice(1)],(tx,actorId)=>build(tx,actorId,filters));},
  export(context,input={},format='csv'){
   if(!['csv','print'].includes(format))throw new IntegrationError('INVALID_FORMAT');const filters=reportFilters(input);
   return access.run(context,[...codes,'M12.reports.export'],async(tx,actorId)=>{
    if(!await reportsSchemaReady(tx))throw new IntegrationError('REPORTS_NOT_ACTIVATED',503);
    const report=await build(tx,actorId,filters);
    await tx.execute("INSERT INTO informe_generacion (id_informe,actor_id,formato,caracter,filtros,contenido_sha256,creado_en) VALUES (?,?,?,'analitico',?,?,UTC_TIMESTAMP(3))",[report.meta.id,actorId,format,JSON.stringify(filters),report.meta.contentSha256]);return report;
   });
  },
  async publish(){throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);}
 };
}

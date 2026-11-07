import {createMysqlTransactionManager} from './mysql-transaction-manager.js';
import {createAuthorizationMutexRepository} from '../repositories/roles/authorization-mutex.repository.js';
import {createAuthorizationRepository} from '../repositories/roles/authorization.repository.js';
import {positiveId,eventCursor,observation} from './plan-workflow.rules.js';
import {integrationReady,closedPeriodSnapshot} from './quarterly-integration.context.js';
import {IntegrationError,EVIDENCE_LIMIT,progress,officialSummary,completion} from './quarterly-integration.rules.js';
import {calcularPromedioAvanceAprobado} from './activity.progress.service.js';
const closed=async()=>null;
const dateFields="id_periodo,anio,trimestre,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS fecha_inicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fecha_fin,estado,creado_por,DATE_FORMAT(creado_en,'%Y-%m-%d %H:%i:%s') AS creado_en";
export function createQuarterlyIntegrationService({pool,authority=closed,requirements=closed,clock=()=>new Date()}={}) {
  const transactions=createMysqlTransactionManager(pool),mutex=createAuthorizationMutexRepository(),auth=createAuthorizationRepository({mutex});
  const allowed=(tx,actorId,permissionCode)=>auth.canAccess({actorId,permissionCode,scopeRef:null},tx);
  async function run(context,permission,work,{requireSchema=true}={}) {
    const actorId=positiveId(context?.actorId);
    return transactions.run(raw=>mutex.withLock(raw,async tx=>{
      const[users]=await tx.execute('SELECT id_usuario FROM usuario WHERE id_usuario=? AND LOWER(estado)=?',[actorId,'activo']);
      if(users.length!==1)throw new IntegrationError('AUTHENTICATION_REQUIRED',401);
      if(!await allowed(tx,actorId,permission))throw new IntegrationError('FORBIDDEN',403);
      if(requireSchema&&!await integrationReady(tx))throw new IntegrationError('INTEGRATION_NOT_ACTIVATED',503);
      return work(tx,actorId);
    }));
  }
  const service={
    options(context){return run(context,'M13.evidence.upload',async tx=>({ready:await integrationReady(tx),maxBytes:EVIDENCE_LIMIT,types:['application/pdf','image/png','image/jpeg','text/plain']}),{requireSchema:false});},
    overview(context,query={}) {
      const planId=query.planId?positiveId(query.planId):null,activityId=query.activityId?positiveId(query.activityId):null;
      const year=query.anio?Number(query.anio):null,quarter=query.trimestre?Number(query.trimestre):null,state=query.estado||null;
      if(query.anio&&!Number.isInteger(year)||query.trimestre&&!Number.isInteger(quarter))throw new IntegrationError('INVALID_FILTER');
      if(year!==null&&(!Number.isInteger(year)||year<1000||year>9999)||quarter!==null&&(!Number.isInteger(quarter)||quarter<1||quarter>4)||state&&!['pending','approved','rejected'].includes(state))throw new IntegrationError('INVALID_FILTER');
      const after=query.after?positiveId(query.after):0,before=query.before?eventCursor(query.before):null;
      return run(context,'M05.followup.read',async(tx,actorId)=>{
        const canPlans=await allowed(tx,actorId,'M03.plans.read'),canActivities=await allowed(tx,actorId,'M04.activities.read'),canEvidence=await allowed(tx,actorId,'M13.evidence.read');
        const[allPeriods]=await tx.query(`SELECT ${dateFields} FROM periodo_seguimiento ORDER BY anio DESC,trimestre DESC`);
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
        const active=allPeriods.filter(p=>p.estado==='open'&&p.fecha_inicio<=today&&p.fecha_fin>=today);
        const periods=allPeriods.filter(p=>(!year||Number(p.anio)===year)&&(!quarter||Number(p.trimestre)===quarter));
        const selected=query.periodId?allPeriods.find(p=>Number(p.id_periodo)===positiveId(query.periodId)):periods.find(p=>active.length===1&&p.id_periodo===active[0].id_periodo)||periods[0]||null;
        if(query.periodId&&!selected)throw new IntegrationError('PERIOD_NOT_FOUND',404);
        if(!selected)return {ready:true,periods,period:null,activities:[],history:[],files:[],summary:null,activePeriodId:active.length===1?active[0].id_periodo:null,activeAmbiguous:active.length>1};
        const[raw]=await tx.execute(`SELECT a.id_actividad,a.id_plan,a.descripcion,a.responsable,a.estado,DATE_FORMAT(a.fecha_inicio,'%Y-%m-%d') AS fecha_inicio,DATE_FORMAT(a.fecha_fin,'%Y-%m-%d') AS fecha_fin,
          p.nombre AS plan_nombre,i.nombre AS actividad_nombre,i.id_objetivo,o.descripcion AS objetivo,i.evidencias_esperadas,ind.id_indicador,ind.nombre AS indicador,ind.descripcion AS indicador_descripcion,ind.formula,ind.unidad,ind.fuente,
          q.porcentaje AS porcentaje_trimestral,g.porcentaje AS ultimo_aprobado,CAST(g.id_seguimiento AS CHAR) AS ultimo_aprobado_id,CAST(n.id_seguimiento AS CHAR) AS pendiente_id,EXISTS(SELECT 1 FROM seguimiento_actividad r WHERE r.id_actividad=a.id_actividad AND r.id_periodo=? AND r.estado='rejected') AS has_rejected
          FROM actividad a JOIN plan_accion p ON p.id_plan=a.id_plan
          LEFT JOIN actividad_institucional i ON i.id_actividad=a.id_actividad LEFT JOIN plan_objetivo o ON o.id_objetivo=i.id_objetivo
          LEFT JOIN plan_indicador ind ON ind.id_plan=a.id_plan AND (i.id_indicador IS NULL OR ind.id_indicador=i.id_indicador)
          LEFT JOIN seguimiento_actividad q ON q.id_seguimiento=(SELECT MAX(s.id_seguimiento) FROM seguimiento_actividad s WHERE s.id_actividad=a.id_actividad AND s.id_periodo=? AND s.estado='approved')
          LEFT JOIN seguimiento_actividad g ON g.id_seguimiento=(SELECT MAX(s.id_seguimiento) FROM seguimiento_actividad s WHERE s.id_actividad=a.id_actividad AND s.estado='approved')
          LEFT JOIN seguimiento_actividad n ON n.id_seguimiento=(SELECT MAX(s.id_seguimiento) FROM seguimiento_actividad s WHERE s.id_actividad=a.id_actividad AND s.id_periodo=? AND s.estado='pending')
          ${planId?'WHERE a.id_plan=?':''} ORDER BY a.id_actividad`,planId?[selected.id_periodo,selected.id_periodo,selected.id_periodo,planId]:[selected.id_periodo,selected.id_periodo,selected.id_periodo]);
        let rows=raw.map(r=>({id_actividad:r.id_actividad,id_plan:r.id_plan,descripcion:r.descripcion,responsable:r.responsable,estado:r.estado,fecha_inicio:r.fecha_inicio,fecha_fin:r.fecha_fin,
          due:!!r.fecha_fin&&r.fecha_fin<=selected.fecha_fin&&(!r.fecha_inicio||r.fecha_inicio<=selected.fecha_fin),progress:progress(r),hasRejected:!!r.has_rejected,pendingId:r.pendiente_id,lastApprovedId:r.ultimo_aprobado_id,
          plan:canPlans?{nombre:r.plan_nombre,objetivo:canActivities?r.objetivo:null,indicador:{id:r.id_indicador,nombre:r.indicador,descripcion:r.indicador_descripcion,formula:r.formula,unidad:r.unidad,fuente:r.fuente}}:null,
          formulation:canActivities?{nombre:r.actividad_nombre,evidencias_esperadas:r.evidencias_esperadas,id_objetivo:r.id_objetivo}:null}));
        const frozen=selected.estado==='closed'?await closedPeriodSnapshot(tx,selected.id_periodo):null;
        if(frozen){rows=rows.map(r=>{const item=frozen.rows.find(f=>Number(f.id_actividad)===Number(r.id_actividad));return {...r,due:!!item,...(item?{fecha_inicio:item.fecha_inicio,fecha_fin:item.fecha_fin,progress:{...r.progress,quarterApproved:progress({porcentaje_trimestral:item.porcentaje_aprobado,ultimo_aprobado:r.progress.lastApproved}).quarterApproved}}:{})};});}
        const visible=rows.filter(r=>r.due&&r.id_actividad>after&&(!activityId||r.id_actividad===activityId)&&(!state||state==='pending'&&r.pendingId||state==='approved'&&r.progress.quarterApproved!=null||state==='rejected'&&r.hasRejected)).slice(0,51);
        const page=visible.slice(0,50),params=[selected.id_periodo],clauses=['s.id_periodo=?'];
        if(planId){clauses.push('a.id_plan=?');params.push(planId);}if(activityId){clauses.push('s.id_actividad=?');params.push(activityId);}if(state){clauses.push('s.estado=?');params.push(state);}if(before){clauses.push('s.id_seguimiento<?');params.push(before);}
        const[history]=await tx.execute(`SELECT CAST(s.id_seguimiento AS CHAR) AS id_seguimiento,s.id_actividad,s.id_periodo,s.porcentaje,s.observaciones,s.estado,s.creado_por,CASE WHEN f.id_seguimiento IS NULL THEN DATE_FORMAT(s.creado_en,'%Y-%m-%d %H:%i:%s') ELSE DATE_FORMAT(s.creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') END AS creado_en,d.resultado,d.motivo,d.decidido_por,CASE WHEN f.id_seguimiento IS NULL THEN DATE_FORMAT(d.decidido_en,'%Y-%m-%d %H:%i:%s') ELSE DATE_FORMAT(d.decidido_en,'%Y-%m-%dT%H:%i:%s.%fZ') END AS decidido_en,f.instantanea FROM seguimiento_actividad s JOIN actividad a ON a.id_actividad=s.id_actividad LEFT JOIN seguimiento_decision d ON d.id_seguimiento=s.id_seguimiento LEFT JOIN seguimiento_formulacion f ON f.id_seguimiento=s.id_seguimiento WHERE ${clauses.join(' AND ')} ORDER BY s.id_seguimiento DESC LIMIT 51`,params);
        const historyPage=history.slice(0,50).map(({instantanea,...h})=>{
          let snapshot=null;if(instantanea){try{const x=JSON.parse(instantanea);snapshot={...(canPlans?{plan_nombre:x.plan_nombre,objetivo:canActivities?x.objetivo:null,indicador:x.indicador,formula:x.formula,unidad:x.unidad,fuente:x.fuente}:{}),...(canActivities?{evidencias_esperadas:x.evidencias_esperadas}:{})};}catch{throw new IntegrationError('INVALID_HISTORIC_CONTEXT',503);}}
          return {...h,snapshot,timestampBasis:instantanea?'UTC':'legacy_unspecified'};
        });
        let files=[];
        const ids=[...new Set([...page.map(r=>r.id_actividad),...historyPage.map(h=>h.id_actividad)])];
        if(canEvidence&&ids.length){[files]=await tx.query(`SELECT e.id_evidencia,e.id_actividad,e.fecha_subida,e.observaciones,m.nombre_original,m.mime_type,m.bytes,c.creado_por,DATE_FORMAT(c.creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creado_en,d.resultado AS revision,CAST(l.id_seguimiento AS CHAR) AS id_seguimiento FROM evidencia e LEFT JOIN evidencia_archivo_meta m ON m.id_evidencia=e.id_evidencia LEFT JOIN evidencia_carga c ON c.id_evidencia=e.id_evidencia LEFT JOIN evidencia_decision_institucional d ON d.id_evidencia=e.id_evidencia LEFT JOIN seguimiento_evidencia l ON l.id_evidencia=e.id_evidencia WHERE e.id_actividad IN (${ids.map(()=>'?').join(',')}) ORDER BY e.id_evidencia DESC LIMIT 201`,ids);}
        const[requests]=await tx.execute("SELECT CAST(id_solicitud AS CHAR) AS id_solicitud,solicitado_por,motivo,CASE WHEN EXISTS(SELECT 1 FROM periodo_actuacion pa WHERE pa.id_solicitud=periodo_reapertura_solicitud.id_solicitud AND pa.accion='reopened') THEN 'reopened' ELSE estado END AS estado,DATE_FORMAT(solicitado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS solicitado_en FROM periodo_reapertura_solicitud WHERE id_periodo=? ORDER BY id_solicitud DESC LIMIT 50",[selected.id_periodo]);
        const[periodHistory]=await tx.execute("SELECT accion,actor_id,estado_anterior,estado_nuevo,motivo,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creado_en FROM periodo_actuacion WHERE id_periodo=? ORDER BY id_actuacion DESC LIMIT 50",[selected.id_periodo]);
        const requirement=await requirements({period:selected,activities:rows},tx);
        // A trusted requirement definition alone never approves a file. Actual decisions
        // and associations to the approved follow-up are checked before completion.
        const verified=[];
        if(requirement?.confirmed&&requirement.reference){for(const r of rows){const required=requirement.requiredEvidenceIdsByActivity?.[r.id_actividad];if(!Array.isArray(required))continue;let valid=true;for(const eid of required){positiveId(eid);const[found]=await tx.execute("SELECT e.id_evidencia FROM evidencia e JOIN evidencia_decision_institucional d ON d.id_evidencia=e.id_evidencia AND d.resultado='approved' JOIN seguimiento_evidencia l ON l.id_evidencia=e.id_evidencia WHERE e.id_evidencia=? AND e.id_actividad=? AND l.id_seguimiento=?",[eid,r.id_actividad,r.lastApprovedId]);if(!found.length)valid=false;}if(valid)verified.push(r.id_actividad);}}
        return {ready:true,closedSnapshotAvailable:!!frozen,periods,period:selected,activePeriodId:active.length===1?active[0].id_periodo:null,activeAmbiguous:active.length>1,activities:page,history:historyPage,files:files.slice(0,200),filesTruncated:files.length>200,canEvidence,
          summary:officialSummary(rows),generalAverage:calcularPromedioAvanceAprobado(rows.filter(r=>r.progress.lastApproved!=null).map(r=>r.progress.lastApproved)),completion:planId?completion(rows,{confirmed:requirement?.confirmed,reference:requirement?.reference,verifiedActivityIds:verified}):{state:'seleccione_plan',complete:false,reason:'Selecciona un plan para consultar su cumplimiento conjunto. El promedio global no certifica su finalización.'},
          metricScope:{planId,filtersAffectSummary:false,eligibility:'existing_due_by_period_end'},nextActivityCursor:visible.length>50?page.at(-1).id_actividad:null,nextHistoryCursor:history.length>50?historyPage.at(-1).id_seguimiento:null,
          requests,periodHistory,institutionalActionsEnabled:false};
      });
    },
    requestReopen(context,id,input={}) {
      id=positiveId(id);const reason=observation(input.motivo,true),clientId=input.client_id;
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(clientId||''))throw new IntegrationError('INVALID_REQUEST_ID');
      return run(context,'M05.followup.update',async(tx,actorId)=>{
        const[periods]=await tx.execute('SELECT estado FROM periodo_seguimiento WHERE id_periodo=? FOR UPDATE',[id]);if(!periods.length)throw new IntegrationError('PERIOD_NOT_FOUND',404);if(periods[0].estado!=='closed')throw new IntegrationError('PERIOD_NOT_CLOSED',409);
        const[existing]=await tx.execute('SELECT id_solicitud,motivo FROM periodo_reapertura_solicitud WHERE id_periodo=? AND solicitado_por=? AND client_id=?',[id,actorId,clientId]);
        if(existing.length){if(existing[0].motivo!==reason)throw new IntegrationError('REQUEST_CONFLICT',409);return {id_solicitud:existing[0].id_solicitud,estado:'pending',duplicate:true};}
        const[result]=await tx.execute('INSERT INTO periodo_reapertura_solicitud (id_periodo,solicitado_por,motivo,client_id,solicitado_en) VALUES (?,?,?,?,UTC_TIMESTAMP(3))',[id,actorId,reason,clientId]);
        await tx.execute("INSERT INTO periodo_actuacion (id_periodo,id_solicitud,accion,actor_id,estado_anterior,estado_nuevo,motivo,creado_en) VALUES (?,?,'reopen_requested',?,'closed','closed',?,UTC_TIMESTAMP(3))",[id,result.insertId,actorId,reason]);
        return {id_solicitud:result.insertId,estado:'pending'};
      });
    },
    async institutionalAction(context,action,input={}) {
      if(authority===closed)throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);
      if(!['reopen_period','verify_evidence'].includes(action))throw new IntegrationError('INVALID_ACTION');
      const id=positiveId(input.id),reason=observation(input.motivo,true);
      const requestId=action==='reopen_period'?eventCursor(input.id_solicitud):null;
      if(action==='verify_evidence'&&!['approved','rejected'].includes(input.resultado))throw new IntegrationError('INVALID_DECISION');
      return run(context,action==='verify_evidence'?'M13.evidence.verify':'M05.followup.update',async(tx,actorId)=>{
        const grant=await authority({actorId,action,id,requestId,resultado:input.resultado||null},tx);
        if(grant?.allowed!==true||typeof grant.reference!=='string'||!grant.reference.trim()||grant.reference.length>200)throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);
        if(action==='reopen_period'){
          const[periods]=await tx.execute('SELECT estado FROM periodo_seguimiento WHERE id_periodo=? FOR UPDATE',[id]);
          if(periods[0]?.estado!=='closed')throw new IntegrationError('PERIOD_NOT_CLOSED',409);
          const[requests]=await tx.execute('SELECT id_solicitud FROM periodo_reapertura_solicitud WHERE id_solicitud=? AND id_periodo=? FOR UPDATE',[requestId,id]);
          if(requests.length!==1)throw new IntegrationError('REQUEST_NOT_FOUND',404);
          const[resolved]=await tx.execute("SELECT id_actuacion FROM periodo_actuacion WHERE id_solicitud=? AND accion='reopened' FOR UPDATE",[requestId]);
          if(resolved.length)throw new IntegrationError('REQUEST_ALREADY_RESOLVED',409);
          await tx.execute("UPDATE periodo_seguimiento SET estado='open' WHERE id_periodo=? AND estado='closed'",[id]);
          await tx.execute("INSERT INTO periodo_actuacion (id_periodo,id_solicitud,accion,actor_id,estado_anterior,estado_nuevo,motivo,autoridad_referencia,creado_en) VALUES (?,?,'reopened',?,'closed','open',?,?,UTC_TIMESTAMP(3))",[id,requestId,actorId,reason,grant.reference]);
          return {id_periodo:id,estado:'open'};
        }
        if(!['approved','rejected'].includes(input.resultado))throw new IntegrationError('INVALID_DECISION');
        const[files]=await tx.execute('SELECT id_evidencia FROM evidencia WHERE id_evidencia=? FOR UPDATE',[id]);if(!files.length)throw new IntegrationError('EVIDENCE_NOT_FOUND',404);
        const[closedLinks]=await tx.execute("SELECT l.id_seguimiento FROM seguimiento_evidencia l JOIN seguimiento_actividad s ON s.id_seguimiento=l.id_seguimiento JOIN periodo_seguimiento p ON p.id_periodo=s.id_periodo WHERE l.id_evidencia=? AND p.estado='closed' FOR UPDATE",[id]);
        if(closedLinks.length)throw new IntegrationError('PERIOD_CLOSED',409);
        const[decisions]=await tx.execute('SELECT id_evidencia FROM evidencia_decision_institucional WHERE id_evidencia=?',[id]);if(decisions.length)throw new IntegrationError('ALREADY_DECIDED',409);
        await tx.execute('INSERT INTO evidencia_decision_institucional (id_evidencia,resultado,motivo,decidido_por,decidido_en,autoridad_referencia) VALUES (?,?,?,?,UTC_TIMESTAMP(3),?)',[id,input.resultado,reason,actorId,grant.reference]);
        return {id_evidencia:id,resultado:input.resultado};
      });
    }
  };return Object.freeze(service);
}

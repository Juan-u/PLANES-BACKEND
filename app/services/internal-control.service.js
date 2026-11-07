import {createReportAccess,reportsSchemaReady} from './institutional-report.service.js';
import {IntegrationError} from './quarterly-integration.rules.js';
import {positiveId,eventCursor} from './plan-workflow.rules.js';
import {controlText} from './institutional-report.rules.js';
const closed=async()=>null;
export function createInternalControlService({pool,authority=closed}={}){
 const access=createReportAccess(pool),readCodes=['M15.audit.read','M03.plans.read','M04.activities.read','M05.followup.read'];
 async function ready(tx){if(!await reportsSchemaReady(tx))throw new IntegrationError('REPORTS_NOT_ACTIVATED',503);}
 return {
  list(context,query={}){const planId=query.planId?positiveId(query.planId):null,after=query.after?eventCursor(query.after):'0';if(query.estado&&!['registrado','en_atencion','atendido'].includes(query.estado))throw new IntegrationError('INVALID_FILTER');return access.run(context,readCodes,async tx=>{
   await ready(tx);const clauses=['h.id_hallazgo>?'],params=[after];if(planId){clauses.push('h.id_plan=?');params.push(planId);}if(query.estado){clauses.push('h.estado=?');params.push(query.estado);}
   const[items]=await tx.execute(`SELECT CAST(h.id_hallazgo AS CHAR) AS id_hallazgo,h.id_plan,h.id_actividad,h.titulo,h.estado,h.revision,h.creado_por,DATE_FORMAT(h.creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creado_en,p.nombre AS plan_nombre FROM control_hallazgo h JOIN plan_accion p ON p.id_plan=h.id_plan WHERE ${clauses.join(' AND ')} ORDER BY h.id_hallazgo LIMIT 51`,params);
   return {items:items.slice(0,50),next:items.length>50?items[49].id_hallazgo:null,writeEnabled:false,reason:'INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED'};
  });},
  detail(context,id){id=eventCursor(id);return access.run(context,readCodes,async tx=>{await ready(tx);const[rows]=await tx.execute(`SELECT CAST(id_hallazgo AS CHAR) AS id_hallazgo,id_plan,id_actividad,titulo,descripcion,observaciones,estado,revision,creado_por,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creado_en FROM control_hallazgo WHERE id_hallazgo=?`,[id]);if(!rows.length)throw new IntegrationError('NOT_FOUND',404);
   const[recommendations]=await tx.execute(`SELECT CAST(id_recomendacion AS CHAR) AS id_recomendacion,descripcion,respuesta,estado,revision,creado_por,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creado_en FROM control_recomendacion WHERE id_hallazgo=? ORDER BY id_recomendacion LIMIT 201`,[id]);
   const[history]=await tx.execute(`SELECT CAST(id_evento AS CHAR) AS id_evento,accion,actor_id,detalle,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creado_en FROM control_evento WHERE id_hallazgo=? ORDER BY id_evento DESC LIMIT 201`,[id]);
   return {finding:rows[0],recommendations:recommendations.slice(0,200),history:history.slice(0,200),truncated:history.length>200||recommendations.length>200,writeEnabled:false};
  });},
  async act(context,action,input={}){
   // Existing general permissions never establish institutional competence.
   // Production composition cannot inject a grant through request parameters.
   if(authority===closed)throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);
   if(!['create','recommend','update_finding','update_recommendation'].includes(action))throw new IntegrationError('INVALID_ACTION');
   const id=action==='create'?null:eventCursor(input.id_hallazgo);
   return access.run(context,[...readCodes,action==='create'||action==='recommend'?'M09.corrective.create':'M09.corrective.update'],async(tx,actorId)=>{
    await ready(tx);
    let finding=null;if(id){const[rows]=await tx.execute('SELECT id_hallazgo,id_plan,id_actividad,revision,estado FROM control_hallazgo WHERE id_hallazgo=? FOR UPDATE',[id]);finding=rows[0];if(!finding)throw new IntegrationError('NOT_FOUND',404);}
    const planId=finding?.id_plan??positiveId(input.planId),activityId=finding?.id_actividad??(input.activityId?positiveId(input.activityId):null);
    const[plans]=await tx.execute('SELECT id_plan FROM plan_accion WHERE id_plan=?',[planId]);if(plans.length!==1)throw new IntegrationError('NOT_FOUND',404);
    if(activityId){const[activities]=await tx.execute('SELECT id_actividad FROM actividad WHERE id_actividad=? AND id_plan=?',[activityId,planId]);if(activities.length!==1)throw new IntegrationError('ACTIVITY_PLAN_MISMATCH',409);}
    const grant=await authority({actorId,action,planId,activityId,findingId:id},tx);
    if(grant?.allowed!==true||typeof grant.reference!=='string'||!grant.reference.trim()||grant.reference.length>200)throw new IntegrationError('INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED',403);
    let resultId=id,detail;
    if(action==='create'){
     const titulo=controlText(input.titulo,{required:true,max:200}),descripcion=controlText(input.descripcion,{required:true}),observaciones=controlText(input.observaciones);
     const[r]=await tx.execute('INSERT INTO control_hallazgo (id_plan,id_actividad,titulo,descripcion,observaciones,creado_por,creado_en) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[planId,activityId,titulo,descripcion,observaciones,actorId]);resultId=String(r.insertId);detail={titulo,descripcion,observaciones,estado:'registrado'};
    }else if(action==='recommend'){
     const descripcion=controlText(input.descripcion,{required:true});const[r]=await tx.execute('INSERT INTO control_recomendacion (id_hallazgo,descripcion,creado_por,creado_en) VALUES (?,?,?,UTC_TIMESTAMP(3))',[id,descripcion,actorId]);detail={id_recomendacion:String(r.insertId),descripcion,estado:'pendiente'};
    }else{
     const revision=Number(input.revision);if(!Number.isSafeInteger(revision)||revision<1)throw new IntegrationError('INVALID_REVISION');
     if(action==='update_finding'){
      if(!['registrado','en_atencion','atendido'].includes(input.estado))throw new IntegrationError('INVALID_STATE');const observaciones=controlText(input.observaciones,{required:true});
      const[r]=await tx.execute('UPDATE control_hallazgo SET estado=?,observaciones=?,revision=revision+1 WHERE id_hallazgo=? AND revision=?',[input.estado,observaciones,id,revision]);if(r.affectedRows!==1)throw new IntegrationError('REVISION_CONFLICT',409);detail={estado:input.estado,observaciones,previousRevision:revision};
     }else{
      const rid=eventCursor(input.id_recomendacion);if(!['pendiente','en_atencion','atendida'].includes(input.estado))throw new IntegrationError('INVALID_STATE');const respuesta=controlText(input.respuesta,{required:true});
      const[r]=await tx.execute('UPDATE control_recomendacion SET estado=?,respuesta=?,revision=revision+1 WHERE id_recomendacion=? AND id_hallazgo=? AND revision=?',[input.estado,respuesta,rid,id,revision]);if(r.affectedRows!==1)throw new IntegrationError('REVISION_CONFLICT',409);detail={id_recomendacion:rid,estado:input.estado,respuesta,previousRevision:revision};
     }
    }
    await tx.execute('INSERT INTO control_evento (id_hallazgo,actor_id,accion,detalle,autoridad_referencia,creado_en) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))',[resultId,actorId,action,JSON.stringify(detail),grant.reference]);
    return {id_hallazgo:resultId,recorded:true,officialPlanningDecision:false};
   });
  }
 };
}

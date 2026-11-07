import { createHash } from 'node:crypto';
import { createMysqlTransactionManager } from './mysql-transaction-manager.js';
import { createAuthorizationMutexRepository } from '../repositories/roles/authorization-mutex.repository.js';
import { createAuthorizationRepository } from '../repositories/roles/authorization.repository.js';
import { ROLE_PERMISSION_CATALOG } from '../config/role-permission-matrix.js';
import { attachDrafts } from './institutional-draft.service.js';
import { assertWorkflowEditable, workflowSchemaReady } from './plan-workflow.guard.js';
import { WorkflowError, WORKFLOW_LABELS, ACTIONS, positiveId, revisionNumber, calendarDate, nextState, observation, validatePresentation, eventCursor } from './plan-workflow.rules.js';

const registered = new Set(ROLE_PERMISSION_CATALOG.permissions.map(p => p.code));
const CLOSED_AUTHORITY = Object.freeze({ permissionFor: () => null, authorize: async () => null });
const CLOSED_REQUIREMENTS = async () => ({});
const columns = "id_plan,estado,revision,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS fecha_inicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fecha_fin,responsable_propuesto_id";
const fail = (code,status=400,details) => { throw new WorkflowError(code,status,details); };
const contentVersion = aggregate => createHash('sha256').update(JSON.stringify(aggregate)).digest('hex');
const bodyObject = input => {if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_BODY');};
const subject = context => { try { return positiveId(context?.actorId); } catch { fail('AUTHENTICATION_REQUIRED',401); } };

/**
 * Institutional adapters are trusted server dependencies, never request fields/env flags.
 * Default composition deliberately cannot execute any institutional action.
 * No name-based role inference and no edit-permission fallback for approval.
 */
export function createPlanWorkflowService({ pool, authority = CLOSED_AUTHORITY, requirements = CLOSED_REQUIREMENTS } = {}) {
  const transactions = createMysqlTransactionManager(pool), mutex = createAuthorizationMutexRepository();
  const authorization = createAuthorizationRepository({ mutex });
  async function run(context, permission, work) {
    const actorId = subject(context);
    return transactions.run(raw => mutex.withLock(raw,async tx => {
      const [accounts] = await tx.execute('SELECT id_usuario FROM usuario WHERE id_usuario=? AND LOWER(estado)=?',[actorId,'activo']);
      if (accounts.length !== 1) fail('AUTHENTICATION_REQUIRED',401);
      if (!registered.has(permission) || !await authorization.canAccess({actorId,permissionCode:permission,scopeRef:null},tx)) fail('FORBIDDEN',403);
      if(!await workflowSchemaReady(tx))fail('WORKFLOW_SCHEMA_MISSING',503);
      return work(tx,actorId);
    }));
  }
  async function load(tx,id,lock=false) {
    const [plans] = await tx.execute(`SELECT id_plan,nombre,descripcion,estado FROM plan_accion WHERE id_plan=?${lock?' FOR UPDATE':''}`,[id]);
    if (!plans.length) fail('PLAN_NOT_FOUND',404);
    const [profiles] = await tx.execute(`SELECT ${columns} FROM plan_flujo WHERE id_plan=?${lock?' FOR UPDATE':''}`,[id]);
    const legacy = String(plans[0].estado ?? '').trim().toLowerCase();
    const managed = profiles[0] || (!legacy || legacy==='borrador' ? {id_plan:id,estado:'borrador',revision:0,fecha_inicio:null,fecha_fin:null,responsable_propuesto_id:null} : null);
    const [plan] = await attachDrafts(tx,plans,'plan');
    const [rows] = await tx.execute("SELECT id_actividad,id_plan,descripcion,responsable,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS fecha_inicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fecha_fin,estado FROM actividad WHERE id_plan=? ORDER BY id_actividad"+(lock?' FOR UPDATE':''),[id]);
    const activities = await attachDrafts(tx,rows,'actividad');
    return { plan, profile:managed, activities };
  }
  async function check(tx,aggregate,lock=false) {
    const {plan,profile,activities} = aggregate;
    if (!profile) return {complete:false,missing:[],unresolved:[{field:'estado_heredado',message:'El estado heredado necesita incorporación institucional explícita; no se convirtió automáticamente.'}]};
    const [processes] = plan.institucional?.id_proceso ? await tx.execute('SELECT id_proceso FROM proceso_institucional WHERE id_proceso=? AND activo=1'+(lock?' FOR UPDATE':''),[plan.institucional.id_proceso]) : [[]];
    const [users] = profile.responsable_propuesto_id ? await tx.execute('SELECT id_usuario FROM usuario WHERE id_usuario=? AND LOWER(estado)=?'+(lock?' FOR UPDATE':''),[profile.responsable_propuesto_id,'activo']) : [[]];
    const confirmation = await requirements({plan,profile,activities},tx);
    const confirmed = typeof confirmation?.reference==='string' && confirmation.reference.trim().length>0;
    return {...validatePresentation(plan,profile,activities,{processActive:processes.length===1,responsibleActive:users.length===1,responsibleAuthorized:confirmed&&confirmation.responsibleAuthorized===true,conditionalRulesConfirmed:confirmed&&confirmation.conditionalRulesConfirmed===true,activityResponsibilitiesAuthorized:confirmed&&confirmation.activityResponsibilitiesAuthorized===true,requiredFields:confirmed&&Array.isArray(confirmation.requiredFields)?confirmation.requiredFields:[]}),requirementsReference:confirmed?confirmation.reference:null};
  }
  async function available(tx,actorId,aggregate) {
    const output=[];
    for (const action of ACTIONS) {
      let reason='AUTHORITY_NOT_CONFIGURED'; const permission=authority.permissionFor(action);
      if (registered.has(permission) && (action!=='aprobar'||permission==='M03.plans.approve') && (action!=='presentar'||permission==='M03.plans.submit')) {
        if (!await authorization.canAccess({actorId,permissionCode:permission,scopeRef:null},tx)) reason='FORBIDDEN';
        else {
          const grant=await authority.authorize({actorId,action,planId:aggregate.plan.id_plan},tx);
          if (grant?.allowed===true && typeof grant.reference==='string' && grant.reference.trim()) {
            try { nextState(aggregate.profile?.estado,action); reason=null; } catch { reason='INVALID_TRANSITION'; }
          }
        }
      }
      output.push({action,enabled:reason===null,reason});
    }
    return output;
  }
  async function append(tx,actorId,aggregate,action,previous,note,reference) {
    const snapshot = JSON.stringify(aggregate);
    await tx.execute('INSERT INTO plan_flujo_evento (id_plan,revision,accion,actor_id,estado_anterior,estado_nuevo,observacion,autoridad_referencia,instantanea,instantanea_sha256,creado_en) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',
      [aggregate.plan.id_plan,aggregate.profile.revision,action,actorId,previous,aggregate.profile.estado,note,reference,snapshot,createHash('sha256').update(snapshot).digest('hex')]);
  }
  function expected(profile,revision) { if (profile.revision!==revisionNumber(revision)) fail('REVISION_CONFLICT',409); }
  const service = {
    async get(context,id,query={}) {
      id=positiveId(id);
      return run(context,'M03.plans.read',async(tx,actorId)=>{
        const aggregate=await load(tx,id);const before=query.before==null||query.before===''?null:eventCursor(query.before);
        const [history]=await tx.execute(`SELECT CAST(id_evento AS CHAR) AS id_evento,id_plan,revision,accion,actor_id,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS creado_en,estado_anterior,estado_nuevo,observacion,autoridad_referencia FROM plan_flujo_evento WHERE id_plan=?${before?' AND id_evento<?':''} ORDER BY id_evento DESC LIMIT 51`,before?[id,before]:[id]);
        const items=history.slice(0,50);
        const canUpdate=await authorization.canAccess({actorId,permissionCode:'M03.plans.update',scopeRef:null},tx);
        return {...aggregate,contentVersion:contentVersion(aggregate),labels:WORKFLOW_LABELS,validation:await check(tx,aggregate),actions:await available(tx,actorId,aggregate),canEditProfile:canUpdate&&['borrador','devuelto'].includes(aggregate.profile?.estado),history:items,nextHistoryCursor:history.length>50?items.at(-1).id_evento:null};
      });
    },
    async validate(context,id) { const result=await service.get(context,id);return result.validation; },
    async list(context,query={}) {
      const state=query.estado || null;if(state&&(typeof state!=='string'||!Object.hasOwn(WORKFLOW_LABELS,state)))fail('INVALID_FILTER');
      const after=query.after==null||query.after===''?0:positiveId(query.after);
      const q=query.q==null?'':query.q;if(typeof q!=='string'||q.length>150)fail('INVALID_FILTER');
      return run(context,'M03.plans.read',async tx=>{
        const clauses=['p.id_plan>?'],params=[after];
        if(state){clauses.push('f.estado=?');params.push(state);}
        if(q){clauses.push('p.nombre LIKE ?');params.push(`%${q}%`);}
        const [rows]=await tx.execute(`SELECT p.id_plan,p.nombre,f.estado,f.revision,f.responsable_propuesto_id,e.actor_id AS ultimo_actor,DATE_FORMAT(f.actualizado_en,'%Y-%m-%dT%H:%i:%s.%fZ') AS actualizado_en FROM plan_flujo f JOIN plan_accion p ON p.id_plan=f.id_plan LEFT JOIN plan_flujo_evento e ON e.id_plan=f.id_plan AND e.revision=f.revision WHERE ${clauses.join(' AND ')} ORDER BY p.id_plan LIMIT 51`,params);
        return {items:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id_plan:null,labels:WORKFLOW_LABELS,institutionalActionsConfigured:false};
      });
    },
    async saveProfile(context,id,input={}) {
      bodyObject(input);
      id=positiveId(id);const start=calendarDate(input.fecha_inicio),end=calendarDate(input.fecha_fin);
      if(start&&end&&start>end)fail('INVALID_DATE_RANGE');
      const responsible=input.responsable_propuesto_id==null||input.responsable_propuesto_id===''?null:positiveId(input.responsable_propuesto_id);
      return run(context,'M03.plans.update',async(tx,actorId)=>{
        const aggregate=await load(tx,id,true);if(!aggregate.profile)fail('LEGACY_STATE_REQUIRES_REVIEW',409);
        await assertWorkflowEditable(tx,id);expected(aggregate.profile,input.revision);
        if(responsible){const[rows]=await tx.execute('SELECT id_usuario FROM usuario WHERE id_usuario=? AND LOWER(estado)=? FOR UPDATE',[responsible,'activo']);if(rows.length!==1)fail('INVALID_RESPONSIBLE');}
        const previous=aggregate.profile.estado;
        aggregate.profile={...aggregate.profile,fecha_inicio:start,fecha_fin:end,responsable_propuesto_id:responsible,revision:aggregate.profile.revision+1};
        await tx.execute('INSERT INTO plan_flujo (id_plan,estado,revision,fecha_inicio,fecha_fin,responsable_propuesto_id,actualizado_en) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE revision=VALUES(revision),fecha_inicio=VALUES(fecha_inicio),fecha_fin=VALUES(fecha_fin),responsable_propuesto_id=VALUES(responsable_propuesto_id),actualizado_en=UTC_TIMESTAMP(3)',[id,previous,aggregate.profile.revision,start,end,responsible]);
        await append(tx,actorId,aggregate,'ficha_actualizada',previous,null,null);return {profile:aggregate.profile};
      });
    },
    async act(context,id,input={}) {
      bodyObject(input);
      id=positiveId(id);subject(context);const action=input.action;if(!ACTIONS.includes(action))fail('INVALID_ACTION');
      const permission=authority.permissionFor(action);
      // Even a real plans.approve grant cannot replace an institutional authority mapping.
      if(!registered.has(permission))fail('AUTHORITY_NOT_CONFIGURED',403);
      if(action==='aprobar'&&permission!=='M03.plans.approve'||action==='presentar'&&permission!=='M03.plans.submit')fail('AUTHORITY_NOT_CONFIGURED',403);
      const note=observation(input.observacion,['observar','devolver'].includes(action));
      return run(context,permission,async(tx,actorId)=>{
        const grant=await authority.authorize({actorId,action,planId:id},tx);
        if(grant?.allowed!==true||typeof grant.reference!=='string'||!grant.reference.trim()||grant.reference.length>200)fail('AUTHORITY_NOT_CONFIGURED',403);
        const aggregate=await load(tx,id,true);if(!aggregate.profile)fail('LEGACY_STATE_REQUIRES_REVIEW',409);
        expected(aggregate.profile,input.revision);const previous=aggregate.profile.estado,next=nextState(previous,action);
        if(typeof input.contentVersion!=='string'||input.contentVersion!==contentVersion(aggregate))fail('CONTENT_CONFLICT',409);
        if(action==='presentar'||action==='aprobar'){
          const validation=await check(tx,aggregate,true);if(!validation.complete)fail('PRESENTATION_INCOMPLETE',422,validation);
          aggregate.confirmedRequirementsReference=validation.requirementsReference;
        }
        aggregate.profile={...aggregate.profile,estado:next,revision:aggregate.profile.revision+1};
        await tx.execute('INSERT INTO plan_flujo (id_plan,estado,revision,actualizado_en) VALUES (?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE estado=VALUES(estado),revision=VALUES(revision),actualizado_en=UTC_TIMESTAMP(3)',[id,next,aggregate.profile.revision]);
        await append(tx,actorId,aggregate,action,previous,note,grant.reference);return {profile:aggregate.profile};
      });
    }
  };
  return Object.freeze(service);
}

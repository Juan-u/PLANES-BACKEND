import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ACTIONS, nextState, validatePresentation, observation, calendarDate, revisionNumber, eventCursor } from '../../app/services/plan-workflow.rules.js';
import { assertWorkflowEditable, workflowSchemaReady } from '../../app/services/plan-workflow.guard.js';
import { createPlanWorkflowService } from '../../app/services/plan-workflow.service.js';
import { createPlanWorkflowController } from '../../app/controllers/controller.plan-workflow.js';

const complete = () => ({
  plan:{id_plan:1,institucional:{id_proceso:1,problema:'P',causas:'C',consecuencias:'C',objetivo_general:'O',meta_descripcion:'M',meta_valor:'0',objetivos:[{id:1,descripcion:'O'}],indicador:{nombre:'N',descripcion:'D'}}},
  profile:{fecha_inicio:'2026-01-01',fecha_fin:'2026-12-31',responsable_propuesto_id:1},
  activities:[{id_actividad:3,descripcion:'D',responsable:'R',fecha_inicio:'2026-02-01',fecha_fin:'2026-03-01',institucional:{id_objetivo:1,resultado_esperado:'R',prioridad:'media',metodo_verificacion:'Acta'}}],
  context:{processActive:true,responsibleActive:true,responsibleAuthorized:true,activityResponsibilitiesAuthorized:true,conditionalRulesConfirmed:true}
});
for(const [state,action,expected]of [['borrador','presentar','presentado'],['devuelto','presentar','presentado'],['presentado','recibir','en_revision'],['en_revision','observar','en_revision'],['en_revision','devolver','devuelto']]) {
  test(`pure transition ${state}/${action}`,()=>assert.equal(nextState(state,action),expected));
}
for(const state of ['borrador','presentado','devuelto','aprobado','active','closed'])test(`cannot bypass review from ${state}`,()=>assert.throws(()=>nextState(state,'aprobar'),e=>e.code==='INVALID_TRANSITION'));
test('approval is only a declared graph edge; tests do not execute or persist an approval',()=>{
  assert.throws(()=>nextState('en_revision','unknown'),e=>e.code==='INVALID_ACTION');
  assert.equal(ACTIONS.includes('aprobar'),true);
});
test('optional evidence/formula/unit/source and zero do not become invented submission rules',()=>{
  const x=complete(),before=structuredClone(x),r=validatePresentation(x.plan,x.profile,x.activities,x.context);
  assert.equal(r.complete,true);assert.deepEqual(x,before);
});
test('technical completeness cannot certify institutional authority or assignment',()=>{
  const x=complete(),r=validatePresentation(x.plan,x.profile,x.activities,{processActive:true,responsibleActive:true});
  assert.equal(r.complete,false);assert.equal(r.missing.length,0);
  assert.ok(r.unresolved.some(i=>i.field==='responsable_autorizado'));
  assert.ok(r.unresolved.some(i=>i.field==='responsables_actividades'));
  assert.ok(r.unresolved.some(i=>i.field==='reglas_condicionales'));
});
test('conditional fields are required only by an explicitly confirmed requirement set',()=>{
  const x=complete();x.context.requiredFields=['indicador.formula','actividades.evidencias_esperadas'];
  const result=validatePresentation(x.plan,x.profile,x.activities,x.context);
  assert.ok(result.missing.some(i=>i.field==='indicador.formula'));
  assert.ok(result.missing.some(i=>i.field==='actividades.evidencias_esperadas'));
  x.context.requiredFields=['unknown'];assert.ok(validatePresentation(x.plan,x.profile,x.activities,x.context).unresolved.length);
});
test('missing institutional data, cross-plan objective and date inconsistency are reported by field',()=>{
  const x=complete();x.plan.institucional.causas='';x.activities[0].institucional.id_objetivo=55;x.activities[0].fecha_inicio='2026-04-01';
  const r=validatePresentation(x.plan,x.profile,x.activities,x.context);
  for(const field of ['causas','id_objetivo','fechas'])assert.ok(r.missing.some(i=>i.field===field));
});
for(const value of ['2026-02-29','2026-13-01','2026-01-01T00:00:00Z','2026-01-01\0'])test(`rejects invalid workflow date ${value}`,()=>assert.throws(()=>calendarDate(value)));
test('dates preserve calendar day, draft dates are optional and revision zero is valid',()=>{
  assert.equal(calendarDate('2024-02-29'),'2024-02-29');assert.equal(calendarDate(''),null);assert.equal(revisionNumber('0'),0);
  assert.throws(()=>revisionNumber(-1));assert.throws(()=>revisionNumber(true));
});
test('history cursors preserve BIGINT precision and reject SQL fragments',()=>{
  assert.equal(eventCursor('9007199254740993'),'9007199254740993');
  assert.throws(()=>eventCursor('18446744073709551616'));assert.throws(()=>eventCursor('1 OR 1=1'));
});
test('return and observation require reasons; HTML remains text',()=>{
  assert.throws(()=>observation(' ',true),e=>e.code==='REASON_REQUIRED');
  assert.equal(observation('<script>',true),'<script>');assert.throws(()=>observation('x'.repeat(10001),true));
});
for(const action of ACTIONS)test(`default composition denies ${action} even when edit/approval claims are in the body`,async()=>{
  let connections=0;const pool={getConnection(){connections++;throw new Error('must not connect');}};
  const service=createPlanWorkflowService({pool});
  await assert.rejects(service.act({actorId:78},1,{action,revision:0,canApprove:true,permission:'M03.plans.approve',authority:{allowed:true}}),e=>e.code==='AUTHORITY_NOT_CONFIGURED'&&e.status===403);
  assert.equal(connections,0);
});
for(const state of ['presentado','en_revision','aprobado'])test(`direct legacy CRUD guard locks ${state}`,async()=>{
  const tx={async query(){return [[{estado:state}]];},async execute(){return [[{id_plan:1}]];}};
  await assert.rejects(assertWorkflowEditable(tx,1),e=>e.code==='PLAN_LOCKED_BY_WORKFLOW');
});
test('guard preserves C before migration and fails closed on communication failure',async()=>{
  await assertWorkflowEditable({async query(){throw Object.assign(new Error(),{code:'ER_NO_SUCH_TABLE'});}},1);
  await assert.rejects(assertWorkflowEditable({async query(){throw new Error('network');}},1),/network/);
});
test('workflow readiness requires both append-only triggers, not merely existing tables',async()=>{
  const db={async query(){return [[],[]];}};assert.equal(await workflowSchemaReady(db),false);
  db.query=async sql=>[sql.includes('information_schema')?[{TRIGGER_NAME:'plan_flujo_evento_no_update',EVENT_MANIPULATION:'UPDATE'},{TRIGGER_NAME:'plan_flujo_evento_no_delete',EVENT_MANIPULATION:'DELETE'}]:[],[]];
  assert.equal(await workflowSchemaReady(db),true);
});
test('controller maps schema/validation errors without exposing SQL, credentials or stacks',async()=>{
  const service={async get(){throw Object.assign(new Error('sensitive diagnostics'),{code:'ER_NO_SUCH_TABLE'});}};
  const res={statusCode:200,status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};
  await createPlanWorkflowController(service).get({usuario:{sub:'1'},params:{id:'1'}},res);
  assert.equal(res.statusCode,503);assert.deepEqual(res.body,{code:'WORKFLOW_SCHEMA_MISSING'});
});
test('history is append-only and migrations never enroll or transition existing plans',async()=>{
  const sql=await readFile(new URL('../../migrations/20261103_plan_workflow.up.sql',import.meta.url),'utf8');
  assert.match(sql,/BEFORE UPDATE ON plan_flujo_evento/);assert.match(sql,/BEFORE DELETE ON plan_flujo_evento/);
  assert.doesNotMatch(sql,/INSERT INTO|UPDATE plan_accion|ALTER TABLE usuario|INSERT.+permiso/i);
});

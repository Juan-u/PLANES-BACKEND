// Block D verification: disposable schemas only. Never migrates planes_accion_test.
// Authorization/authority fixtures below are test dependencies, never production mappings.
import mysql from 'mysql2/promise';import dotenv from 'dotenv';import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {randomBytes,createHash} from 'node:crypto';
import {createPlanWorkflowService} from '../app/services/plan-workflow.service.js';
import {crearControladorConsultaPlanes} from '../app/controllers/controller.plan.js';
import {createActivityController} from '../app/controllers/controller.activity.js';

assert.equal(process.argv.slice(2).join(' '),'--disposable-3307','Explicit --disposable-3307 required.');
const env=dotenv.parse(await readFile(new URL('.env.test',import.meta.url)));
const options={host:'127.0.0.1',port:3307,user:'root',password:env.TEST_DB_ROOT_PASSWORD,database:'planes_accion_test',dateStrings:true};
assert.ok(options.password);const db=await mysql.createConnection(options);
const suffix=randomBytes(4).toString('hex'),target='planes_blockd_'+suffix,restore='planes_blockd_restore_'+suffix;
const tables=['rol','usuario','plan_accion','actividad','historico','proceso_institucional','plan_institucional','plan_objetivo','plan_indicador','actividad_institucional','actividad_recurso','registro_cambio_institucional','rol_autorizacion_mutex'];
const hash=value=>createHash('sha256').update(value).digest('hex');let realPool,passed=0;
const check=(value,message)=>{assert.ok(value,message);passed++;};
async function select(schema){assert.ok([target,restore,'planes_accion_test'].includes(schema));assert.equal(db.connection.stream.remotePort,3307);await db.query('USE '+mysql.escapeId(schema));assert.equal((await db.query('SELECT DATABASE() AS db'))[0][0].db,schema);}
async function footprint(){await select('planes_accion_test');const[rows]=await db.query('SHOW FULL TABLES');const result={};for(const r of rows){const name=Object.values(r)[0];const[[count]]=await db.query('SELECT COUNT(*) AS n FROM '+mysql.escapeId(name));result[name]=count.n;}return result;}
const res=()=>({code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
const call=async(fn,body={},id)=>{const r=res();await fn({body,params:{id:String(id)},query:{},usuario:{sub:'9001'}},r);return r;};
try{
 await select('planes_accion_test');const before=await footprint();check(!Object.hasOwn(before,'plan_flujo'),'D remains unactivated in the existing local database.');
 const ddl=[];for(const table of tables){const[[r]]=await db.query('SHOW CREATE TABLE '+mysql.escapeId(table));ddl.push(r['Create Table'].replace(/ AUTO_INCREMENT=\d+/g,''));}
 await db.query('CREATE DATABASE '+mysql.escapeId(target)+' CHARACTER SET utf8mb4');await select(target);for(const sql of ddl)await db.query(sql);
 // Compatibility fixtures exist BEFORE D migration; none are transitioned afterwards.
 for(const id of [9001,9002,9003])await db.execute('INSERT INTO usuario (id_usuario,nombre,correo,`contrase\u00f1a`,estado) VALUES (?,?,?,?,?)',[id,'Workflow fixture','fixture-'+id+'@example.invalid','NOT_A_LOGIN_HASH','activo']);
 await db.execute('INSERT INTO rol_autorizacion_mutex (mutex_id) VALUES (1)');await db.execute('INSERT INTO proceso_institucional (nombre) VALUES (?)',['Proceso sintetico']);
 await db.execute('INSERT INTO plan_accion (id_plan,nombre,descripcion,id_usuario) VALUES (9000,?,?,9001)',['Registro C conservado','Informacion anterior']);
 await db.execute('INSERT INTO plan_institucional (id_plan,problema,meta_valor) VALUES (9000,?,0)',['Diagnostico previo']);
 await db.execute('INSERT INTO actividad (id_actividad,id_plan,descripcion) VALUES (9000,9000,?)',['Actividad C conservada']);
 await db.execute('INSERT INTO actividad_institucional (id_actividad,id_plan,nombre) VALUES (9000,9000,?)',['Ficha C']);
 await db.execute('INSERT INTO actividad_recurso (id_recurso,id_actividad,descripcion,cantidad,costo_estimado) VALUES (9000,9000,?,0,0)',['Recurso previo']);
 async function records(){const data=[];for(const table of tables){const[cols]=await db.query('SHOW COLUMNS FROM '+mysql.escapeId(table));const columns=cols.map(c=>c.Field);const[rows]=await db.query('SELECT '+columns.map(mysql.escapeId).join(',')+' FROM '+mysql.escapeId(table));data.push({table,columns,rows:rows.map(r=>columns.map(k=>r[k]))});}return data;}
 const oldRecords=await records();
 const directory=new URL('workflow-backups.tmp/',import.meta.url);await mkdir(directory,{recursive:true});const path=new URL(suffix+'.json',directory),backup=JSON.stringify({host:options.host,port:3307,database:target,ddl,records:oldRecords});await writeFile(path,backup,{flag:'wx'});const saved=await readFile(path,'utf8');check(hash(saved)===hash(backup),'Schema backup checksum verified.');
 await db.query('CREATE DATABASE '+mysql.escapeId(restore)+' CHARACTER SET utf8mb4');await select(restore);for(const sql of JSON.parse(saved).ddl)await db.query(sql);
 for(const entry of JSON.parse(saved).records)for(const values of entry.rows)await db.execute('INSERT INTO '+mysql.escapeId(entry.table)+' ('+entry.columns.map(mysql.escapeId).join(',')+') VALUES ('+values.map(()=>'?').join(',')+')',values);
 check(JSON.stringify(await records())===JSON.stringify(oldRecords),'Complete synthetic C data restored before D migration.');
 check((await db.query('SHOW TABLES'))[0].length===tables.length,'Backup restored before D migration.');
 await select(target);const migration=await readFile(new URL('../migrations/20261103_plan_workflow.up.sql',import.meta.url),'utf8');
 for(const sql of migration.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean)){assert.ok(/^CREATE (TABLE|TRIGGER) plan_flujo/.test(sql));await db.query(sql);}
 check((await db.query('SHOW TABLES'))[0].length===tables.length+2,'Additive D schema created in disposable target only.');
 check(JSON.stringify(await records())===JSON.stringify(oldRecords),'All pre-migration C fixture values preserved by UP.');
 realPool=mysql.createPool({...options,database:target,connectionLimit:5});
 const grants=new Map([[9001,new Set(['M03.plans.read','M03.plans.update','M03.plans.submit'])],[9002,new Set(['M03.plans.read','M03.plans.approve'])],[9003,new Set(['M03.plans.read','M03.plans.update'])]]);
 // Only the authorization repository's EXISTS result is simulated. All persistence,
 // FK checks, transaction boundaries, mutex/plan locks and immutable triggers are real.
 const pool={query:(...a)=>realPool.query(...a),async getConnection(){const connection=await realPool.getConnection();return {query:(...a)=>connection.query(...a),async execute(sql,params){if(sql.startsWith('SELECT EXISTS')&&sql.includes('FROM rol_asignacion'))return [[{authorized:grants.get(Number(params[1]))?.has(params[0])?1:0}],[]];return connection.execute(sql,params);},beginTransaction:()=>connection.beginTransaction(),commit:()=>connection.commit(),rollback:()=>connection.rollback(),release:()=>connection.release()};}};
 const authority={permissionFor:action=>action==='presentar'?'M03.plans.submit':'M03.plans.approve',async authorize({actorId,action}){if(action==='aprobar')return null;const allowed=action==='presentar'?actorId===9001:actorId===9002;return allowed?{allowed:true,reference:'TEST-FIXTURE-ONLY-NOT-AN-INSTITUTIONAL-GRANT'}:null;}};
 const service=createPlanWorkflowService({pool,authority,requirements:async()=>({reference:'TEST-REQUIREMENTS-ONLY',responsibleAuthorized:true,activityResponsibilitiesAuthorized:true,conditionalRulesConfirmed:true})});
 const closed=createPlanWorkflowService({pool}),plans=crearControladorConsultaPlanes(realPool),activities=createActivityController(realPool);
 const created=await call(plans.crearPlan,{nombre:'Plan sintético D',institucional:{id_proceso:1,problema:'P',causas:'C',consecuencias:'C',objetivo_general:'O',meta_descripcion:'M',meta_valor:'0',responsable_principal:'Propuesto',objetivos:[{descripcion:'Objetivo'}],indicador:{nombre:'Indicador',descripcion:'Descripción'}}});check(created.code===201,'C creation remains compatible with D schema.');const id=created.body.id_plan;
 let p=await call(plans.obtenerPlan,{},id);const oid=p.body.institucional.objetivos[0].id;
 const a=await call(activities.create,{id_plan:id,descripcion:'Descripción',responsable:'Propuesto',fecha_inicio:'2026-02-01',fecha_fin:'2026-03-01',institucional:{nombre:'Actividad',resultado_esperado:'Resultado',id_objetivo:oid,prioridad:'media',metodo_verificacion:'Acta'}});check(a.code===201,'C activity creation remains compatible.');const aid=a.body.id_actividad;
 let read=await service.get({actorId:9001},id);check(read.profile.estado==='borrador'&&read.profile.revision===0,'Existing draft is virtual until explicitly prepared.');
 await assert.rejects(service.act({actorId:9001},id,{action:'presentar',revision:0,contentVersion:read.contentVersion}),e=>e.code==='PRESENTATION_INCOMPLETE'&&e.details.missing.some(i=>i.field==='fecha_inicio'));passed++;
 const initial=await service.saveProfile({actorId:9001},id,{revision:0,fecha_inicio:'2026-01-01',fecha_fin:'2026-12-31',responsable_propuesto_id:9001});check(initial.profile.revision===1,'Draft preparation stored with immutable event.');
 await assert.rejects(service.saveProfile({actorId:9001},id,{revision:0}),e=>e.code==='REVISION_CONFLICT');passed++;
 const pending=await closed.validate({actorId:9001},id);check(pending.missing.length===0&&!pending.complete&&pending.unresolved.length>0,'Technical data cannot supply missing institutional decisions.');
 const act=async(action,actorId,note)=>{const view=await service.get({actorId},id);return service.act({actorId},id,{action,revision:view.profile.revision,contentVersion:view.contentVersion,observacion:note});};
 await assert.rejects(closed.act({actorId:9001},id,{action:'presentar',revision:1}),e=>e.code==='AUTHORITY_NOT_CONFIGURED');passed++;
 const staleView=await service.get({actorId:9001},id);
 await call(plans.actualizarPlan,{nombre:'Plan corregido antes de presentar'},id);
 await assert.rejects(service.act({actorId:9001},id,{action:'presentar',revision:1,contentVersion:staleView.contentVersion}),e=>e.code==='CONTENT_CONFLICT');passed++;
 check((await act('presentar',9001)).profile.estado==='presentado','Synthetic submission persists only with test authority adapter.');
 for(const operation of [()=>call(plans.actualizarPlan,{nombre:'NO GUARDAR'},id),()=>call(activities.create,{id_plan:id}),()=>call(activities.update,{descripcion:'NO GUARDAR'},aid)]){check((await operation()).code===409,'Direct C mutation blocked while submitted.');}
 await assert.rejects(act('recibir',9003),e=>e.code==='FORBIDDEN');passed++;
 check((await act('recibir',9002)).profile.estado==='en_revision','Synthetic reception persists.');
 await act('observar',9002,'<observación conservada>');
 const parallelView=await service.get({actorId:9002},id),parallelInput={action:'observar',revision:parallelView.profile.revision,contentVersion:parallelView.contentVersion,observacion:'Observación concurrente'};
 const parallel=await Promise.allSettled([service.act({actorId:9002},id,parallelInput),service.act({actorId:9002},id,parallelInput)]);
 check(parallel.filter(r=>r.status==='fulfilled').length===1&&parallel.some(r=>r.status==='rejected'&&r.reason.code==='REVISION_CONFLICT'),'Concurrent duplicate action commits once and rejects stale revision.');
 await assert.rejects(act('devolver',9002,' '),e=>e.code==='REASON_REQUIRED');passed++;
 check((await act('devolver',9002,'Completar justificación')).profile.estado==='devuelto','Synthetic return persists with reason.');
 check((await call(plans.actualizarPlan,{nombre:'Plan corregido tras devolución'},id)).code===200,'Returned plan permits corrections.');
 const beforeResubmission=await service.get({actorId:9001},id);
 check((await act('presentar',9001)).profile.estado==='presentado','Resubmission preserves the same institutional file.');
 await act('recibir',9002);
 const current=await service.get({actorId:9001},id);check(current.history.some(e=>e.observacion==='<observación conservada>')&&current.history.some(e=>e.accion==='devolver'),'Observations and return retained after resubmission.');
 await assert.rejects(act('aprobar',9002),e=>e.code==='AUTHORITY_NOT_CONFIGURED');passed++;
 await assert.rejects(act('aprobar',9003),e=>e.code==='FORBIDDEN');passed++;
 check((await service.get({actorId:9001},id)).profile.estado==='en_revision','No real or synthetic plan was approved.');
 const events=(await db.execute('SELECT id_evento,instantanea,instantanea_sha256 FROM plan_flujo_evento WHERE id_plan=?',[id]))[0];check(events.every(e=>hash(e.instantanea)===e.instantanea_sha256),'All immutable snapshots have valid hashes.');
 await assert.rejects(db.execute('UPDATE plan_flujo_evento SET observacion=? WHERE id_evento=?',['NO',events[0].id_evento]),e=>e.code==='ER_SIGNAL_EXCEPTION');passed++;
 await assert.rejects(db.execute('DELETE FROM plan_flujo_evento WHERE id_evento=?',[events[0].id_evento]),e=>e.code==='ER_SIGNAL_EXCEPTION');passed++;
 await assert.rejects(service.saveProfile({actorId:9001},id,{revision:1}),e=>e.code==='PLAN_LOCKED_BY_WORKFLOW');passed++;
 check((await service.list({actorId:9001},{estado:'aprobado'})).items.length===0,'Approved inbox contains no automatically approved fixture.');
 check((await service.list({actorId:9001},{estado:'en_revision',q:'corregido'})).items.length===1,'Planning filters use persisted workflow state.');
 check(beforeResubmission.profile.estado==='devuelto','Previous results are not mutated in memory.');
 check((await db.execute('SELECT COUNT(*) AS n FROM plan_flujo WHERE id_plan=9000'))[0][0].n===0,'Existing C compatibility fixture was never enrolled or transitioned.');
 const [[compat]]=await db.execute('SELECT nombre FROM plan_accion WHERE id_plan=9000');check(compat.nombre==='Registro C conservado','Existing C compatibility fixture remains unchanged after workflow tests.');
 const after=await footprint();check(JSON.stringify(before)===JSON.stringify(after),'Existing planes_accion_test table counts preserved and D not migrated.');
 console.log(JSON.stringify({passed,target,backupVerified:true,upTested:true,downExecuted:false,approvalsExecuted:0,existingPlansTransitioned:0,rolesOrPermissionsAssigned:0,existingDatabaseMigrated:false,authorization:'simulated decisions, actual repository SQL and transactional persistence'}));
}catch(error){console.error(JSON.stringify({failed:true,reason:error instanceof assert.AssertionError?error.message:'Disposable workflow verification failed; persistence diagnostics suppressed.'}));process.exitCode=1;}
finally{await realPool?.end();for(const schema of [restore,target]){assert.match(schema,/^planes_blockd_(restore_)?[a-f0-9]{8}$/);await db.query('DROP DATABASE IF EXISTS '+mysql.escapeId(schema));}await db.end();}

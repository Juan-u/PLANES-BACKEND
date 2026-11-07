// Block F persistence verification. Never migrates or writes the source database.
import mysql from 'mysql2/promise';import dotenv from 'dotenv';import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import{createHash,randomBytes}from'node:crypto';
import{createInstitutionalReportService,reportsSchemaReady}from'../app/services/institutional-report.service.js';
import{createInternalControlService}from'../app/services/internal-control.service.js';
import{reportCsv}from'../app/services/institutional-report.rules.js';
assert.equal(process.argv.slice(2).join(' '),'--disposable-3307');
const env=dotenv.parse(await readFile(new URL('.env.test',import.meta.url))),options={host:'127.0.0.1',port:3307,user:'root',password:env.TEST_DB_ROOT_PASSWORD,database:'planes_accion_test',dateStrings:true};
const db=await mysql.createConnection(options),suffix=randomBytes(4).toString('hex'),target='planes_blockf_'+suffix,restore='planes_blockf_restore_'+suffix;
const hash=x=>createHash('sha256').update(x).digest('hex');let pool,passed=0;const check=(v,m)=>{assert.ok(v,m);passed++;};
async function select(name){assert.ok(['planes_accion_test',target,restore].includes(name));assert.equal(db.connection.stream.remotePort,3307);await db.query('USE '+mysql.escapeId(name));assert.equal((await db.query('SELECT DATABASE() AS db'))[0][0].db,name);}
async function state(){const[tables]=await db.query('SHOW TABLES');const result={};for(const row of tables){const t=Object.values(row)[0],[[ddl]]=await db.query('SHOW CREATE TABLE '+mysql.escapeId(t)),[cols]=await db.query('SHOW COLUMNS FROM '+mysql.escapeId(t)),[rows]=await db.query('SELECT '+cols.map(c=>mysql.escapeId(c.Field)).join(',')+' FROM '+mysql.escapeId(t));result[t]={ddl:ddl['Create Table'],count:rows.length,hash:hash(rows.map(r=>JSON.stringify(r)).sort().join('\n'))};}return result;}
async function triggerState(){return(await db.query('SELECT TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_TIMING,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME'))[0];}
let ddl,sourceTriggers;
async function createClone(name){await db.query('CREATE DATABASE '+mysql.escapeId(name)+' CHARACTER SET utf8mb4');await select(name);await db.query('SET FOREIGN_KEY_CHECKS=0');try{for(const sql of ddl)await db.query(sql);}finally{await db.query('SET FOREIGN_KEY_CHECKS=1');}for(const t of sourceTriggers)await db.query(`CREATE TRIGGER ${mysql.escapeId(t.TRIGGER_NAME)} ${t.ACTION_TIMING} ${t.EVENT_MANIPULATION} ON ${mysql.escapeId(t.EVENT_OBJECT_TABLE)} FOR EACH ROW ${t.ACTION_STATEMENT}`);}
try{
 const original=await state();sourceTriggers=await triggerState();check(Object.keys(original).length===39&&!original.control_hallazgo,'Source contains C/D/E only.');
 ddl=Object.values(original).map(r=>r.ddl.replace(/ AUTO_INCREMENT=\d+/g,''));await createClone(target);
 for(const id of [9001,9002])await db.execute('INSERT INTO usuario (id_usuario,nombre,correo,`contraseña`,estado) VALUES (?,?,?,?,?)',[id,'Synthetic fixture','fixture-'+id+'@example.invalid','NOT_A_LOGIN_HASH','activo']);
 await db.query('INSERT INTO rol_autorizacion_mutex (mutex_id) VALUES (1)');
 await db.query("INSERT INTO plan_accion (id_plan,nombre,id_usuario) VALUES (1,'Plan F',9001),(2,'Otro plan',9001)");
 await db.query("INSERT INTO proceso_institucional (id_proceso,nombre) VALUES (1,'Proceso sintético')");
 await db.query("INSERT INTO plan_institucional (id_plan,id_proceso,responsable_principal) VALUES (1,1,'Responsable principal')");
 await db.query("INSERT INTO plan_objetivo (id_objetivo,id_plan,descripcion) VALUES (1,1,'Objetivo sintético')");
 await db.query("INSERT INTO plan_indicador (id_indicador,id_plan,nombre,descripcion,formula,unidad,fuente) VALUES (1,1,'Indicador','Descripción','No ejecutar: real/meta*100','Porcentaje','Fuente')");
 for(let id=1;id<=4;id++){await db.execute('INSERT INTO actividad (id_actividad,id_plan,descripcion,responsable,fecha_inicio,fecha_fin,estado) VALUES (?,?,?,?,?,?,?)',[id,id===4?2:1,'Actividad '+id,'Responsable','2026-01-01','2026-03-31',id===1?'Suspendida':'Pendiente']);if(id!==4)await db.execute('INSERT INTO actividad_institucional (id_actividad,id_plan,id_objetivo) VALUES (?,1,1)',[id]);}
 await db.query("INSERT INTO periodo_seguimiento (id_periodo,anio,trimestre,fecha_inicio,fecha_fin,estado,creado_por) VALUES (1,2026,1,'2026-01-01','2026-03-31','open',9001),(2,2026,2,'2026-04-01','2026-06-30','closed',9001)");
 // Seed historical values only; no approval route is enabled or called.
 await db.query("INSERT INTO seguimiento_actividad (id_seguimiento,id_actividad,id_periodo,porcentaje,estado,creado_por) VALUES (1,1,1,0,'approved',9001),(2,2,1,100,'approved',9001),(3,3,1,80,'pending',9001),(4,1,2,25,'approved',9001)");
 await db.query("INSERT INTO evidencia (id_evidencia,id_actividad,fecha_subida,observaciones) VALUES (1,1,'2026-02-01','Referencia sin aprobación')");
 await db.query("INSERT INTO seguimiento_evidencia (id_seguimiento,id_evidencia,id_actividad,vinculado_por,vinculado_en) VALUES (1,1,1,9001,UTC_TIMESTAMP(3))");
 const snapshot={rows:[{id_actividad:1,id_plan:1,fecha_inicio:'2026-01-01',fecha_fin:'2026-03-31',porcentaje_aprobado:25}]};
 await db.execute('INSERT INTO periodo_resultado_version (id_periodo,registrado_por,registrado_en,instantanea) VALUES (2,9001,UTC_TIMESTAMP(3),?)',[JSON.stringify(snapshot)]);
 const before=await state();const records=[];for(const t of Object.keys(before)){const[cols]=await db.query('SHOW COLUMNS FROM '+mysql.escapeId(t)),[rows]=await db.query('SELECT '+cols.map(c=>mysql.escapeId(c.Field)).join(',')+' FROM '+mysql.escapeId(t));records.push({t,cols:cols.map(c=>c.Field),rows});}
 const directory=new URL('reports-backups.tmp/',import.meta.url);await mkdir(directory,{recursive:true});const file=new URL(suffix+'.json',directory),backup=JSON.stringify({ddl,triggers:sourceTriggers,records});await writeFile(file,backup,{flag:'wx'});check(hash(await readFile(file))===hash(backup),'Synthetic full backup integrity verified.');
 await createClone(restore);await db.query('SET FOREIGN_KEY_CHECKS=0');try{for(const{t,cols,rows}of records)for(const r of rows)await db.execute('INSERT INTO '+mysql.escapeId(t)+' ('+cols.map(c=>mysql.escapeId(c)).join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')',cols.map(c=>r[c]));}finally{await db.query('SET FOREIGN_KEY_CHECKS=1');}
 const restored=await state();for(const t of Object.keys(before)){check(restored[t].count===before[t].count&&restored[t].hash===before[t].hash,'Synthetic table restored: '+t);}await select(target);
 check(await reportsSchemaReady(db)===false,'Before F, exports are reported unavailable without modifying schema.');
 const migration=await readFile(new URL('../migrations/20261104_reports_control.up.sql',import.meta.url),'utf8');for(const sql of migration.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.query(sql);
 const after=await state();for(const t of Object.keys(before))assert.equal(after[t].hash,before[t].hash);check(Object.keys(after).length===43,'UP creates four tables without changing prior records.');
 pool=mysql.createPool({...options,database:target,connectionLimit:4});
 const codes=new Set(['M12.reports.read','M12.reports.export','M03.plans.read','M04.activities.read','M05.followup.read','M13.evidence.read','M15.audit.read','M09.corrective.create','M09.corrective.update']);
 const proxy={query:(...a)=>pool.query(...a),async getConnection(){const c=await pool.getConnection();return{query:(...a)=>c.query(...a),async execute(sql,p){if(sql.startsWith('SELECT EXISTS')&&sql.includes('FROM rol_asignacion'))return[[{authorized:Number(p[1])===9001?+codes.has(p[0]):0}],[]];return c.execute(sql,p);},beginTransaction:()=>c.beginTransaction(),commit:()=>c.commit(),rollback:()=>c.rollback(),release:()=>c.release()};}};
 const service=createInstitutionalReportService({pool:proxy,institution:'Institución sintética'}),context={actorId:9001};
 const report=await service.query(context,{periodId:1,planId:1});check(report.activities.length===3&&report.summary[0].activitiesDue===3,'Plan and period filtering.');
 check(report.meta.exportReady===true,'Complete disposable F schema exposes available exports.');
 check(report.summary[0].summary.promedioAvance===50&&Math.abs(report.summary[0].summary.coberturaTrimestral-200/3)<1e-10,'Official helpers preserve zero, exclude pending and retain coverage.');
 check(report.activities[0].progress.quarterApproved===0&&report.activities[2].progress.quarterApproved===null,'Zero differs from missing approval.');
 check(report.meta.character==='analitico'&&report.meta.officialPublication===false&&report.meta.contentSha256.length===64,'Analytical provenance, never official publication.');
 check(report.evidence.length===1&&!report.evidence[0].decision_institucional,'Upload is not an approval.');
 const narrowed=await service.query(context,{processId:1,objectiveId:1,responsable:'Responsable',periodId:1,followupState:'pending'});check(narrowed.activities.length===1&&narrowed.summary[0].activitiesDue===3,'Combinable filters; followup state does not shrink coverage denominator.');
 const noData=await service.query(context,{anio:2025});check(noData.summary.length===0&&noData.activities.every(a=>a.progress.quarterApproved===null),'Unavailable periods never fabricate values.');
 const frozen=await service.query(context,{periodId:2,planId:1});check(frozen.summary[0].activitiesDue===1&&frozen.summary[0].summary.promedioAvance===25,'Closed snapshot remains authoritative.');
 await db.query("UPDATE actividad SET fecha_fin='2027-01-01' WHERE id_actividad=1");check((await service.query(context,{periodId:2,planId:1})).summary[0].summary.promedioAvance===25,'Later date change cannot recalculate closed result.');
 codes.delete('M13.evidence.read');check((await service.query(context,{periodId:1})).evidence.length===0,'Evidence redacted without permission.');codes.add('M13.evidence.read');
 await assert.rejects(service.query({actorId:9002},{planId:1}),e=>e.status===403);passed++;
 codes.delete('M12.reports.export');await assert.rejects(service.export(context,{periodId:1}),e=>e.status===403);passed++;codes.add('M12.reports.export');
 const exported=await service.export(context,{periodId:1},'csv');check(reportCsv(exported).includes('analitico'),'CSV includes filters, metadata and analytical classification.');
 check((await db.query('SELECT COUNT(*) AS n FROM informe_generacion'))[0][0].n===1,'Export audited transactionally.');
 await assert.rejects(service.publish(context),e=>e.status===403);passed++;
 const control=createInternalControlService({pool:proxy});check((await control.list(context)).writeEnabled===false,'Consultation grants no institutional write authority.');await assert.rejects(control.act(context,'create',{planId:1}),e=>e.status===403);passed++;
 // Server-only fixture authority: never injected in the production router.
 const authorized=createInternalControlService({pool:proxy,authority:async()=>({allowed:true,reference:'SYNTHETIC-CI-ONLY'})});
 const finding=await authorized.act(context,'create',{planId:1,activityId:1,titulo:'Hallazgo <script>',descripcion:'Descripción',observaciones:'Independiente de Planeación'});check(finding.recorded&&!finding.officialPlanningDecision,'Authorized synthetic finding persists separately.');
 await authorized.act(context,'recommend',{id_hallazgo:finding.id_hallazgo,descripcion:'Recomendación'});const detail=await control.detail(context,finding.id_hallazgo);check(detail.recommendations.length===1&&detail.history.length===2,'Recommendation and immutable trace persist.');
 await authorized.act(context,'update_finding',{id_hallazgo:finding.id_hallazgo,revision:1,estado:'en_atencion',observaciones:'Atención iniciada'});await assert.rejects(authorized.act(context,'update_finding',{id_hallazgo:finding.id_hallazgo,revision:1,estado:'atendido',observaciones:'Conflicto'}),e=>e.status===409);passed++;
 const recommendation=detail.recommendations[0];await authorized.act(context,'update_recommendation',{id_hallazgo:finding.id_hallazgo,id_recomendacion:recommendation.id_recomendacion,revision:1,estado:'en_atencion',respuesta:'Respuesta independiente'});check((await control.detail(context,finding.id_hallazgo)).recommendations[0].respuesta==='Respuesta independiente','Recommendation response and attention state persisted.');
 await assert.rejects(authorized.act(context,'create',{planId:1,activityId:4,titulo:'No',descripcion:'No'}),e=>e.code==='ACTIVITY_PLAN_MISMATCH');passed++;
 await assert.rejects(control.detail({actorId:9002},finding.id_hallazgo),e=>e.status===403);passed++;
 await assert.rejects(db.query('DELETE FROM control_evento'),e=>e.code==='ER_SIGNAL_EXCEPTION');passed++;await assert.rejects(db.query("UPDATE informe_generacion SET caracter='analitico'"),e=>e.code==='ER_SIGNAL_EXCEPTION');passed++;
 check((await db.query('SELECT COUNT(*) AS n FROM seguimiento_decision'))[0][0].n===0,'No Planning approval created by Control Interno.');
 // Also exercise the real RBAC SQL with new synthetic assignments in this
 // disposable schema only. No existing account or source permission is touched.
 await db.query("INSERT INTO rol (id_rol,nombre_rol) VALUES (9001,'Disposable F reader')");
 await db.query("INSERT INTO rol_configuracion (id_rol,clasificacion_privilegio,permite_vigencia_indefinida,requiere_ambito) VALUES (9001,'ordinary',1,0)");
 let permissionId=9001;for(const code of codes){await db.execute('INSERT INTO permiso (id_permiso,codigo,activo) VALUES (?,?,1)',[permissionId,code]);await db.execute('INSERT INTO rol_permiso (id_rol,id_permiso,creado_en,creado_por) VALUES (9001,?,UTC_TIMESTAMP(3),9001)',[permissionId++]);}
 await db.query("INSERT INTO rol_asignacion (id_asignacion,id_usuario,id_rol,vigente_desde,estado,creado_por,creado_en,motivo) VALUES ('00000000-0000-4000-8000-000000000001',9001,9001,'2020-01-01','active',9001,UTC_TIMESTAMP(3),'Disposable verification only')");
 const realRBAC=createInstitutionalReportService({pool});check((await realRBAC.query(context,{periodId:1})).meta.actorId===9001,'Real RBAC SQL accepts current synthetic global assignment.');
 await assert.rejects(realRBAC.query({actorId:9002},{periodId:1}),e=>e.status===403);passed++;
 await db.query("UPDATE rol_asignacion SET vigente_hasta='2021-01-01' WHERE id_usuario=9001");await assert.rejects(realRBAC.query(context,{periodId:1}),e=>e.status===403);passed++;
 await writeFile(new URL(suffix+'-report.json',directory),JSON.stringify(report));await writeFile(new URL(suffix+'-control.json',directory),JSON.stringify(await control.detail(context,finding.id_hallazgo)));
 await select('planes_accion_test');check(JSON.stringify(await state())===JSON.stringify(original)&&JSON.stringify(await triggerState())===JSON.stringify(sourceTriggers),'Source schema, triggers and all data unchanged.');
 console.log(JSON.stringify({passed,backupRestored:true,sourceTables:Object.keys(original).length,sourceRecords:Object.values(original).reduce((n,t)=>n+t.count,0),sourceChanged:false,sourceMigrated:false,downExecuted:false,authorizationDecisions:'simulated scenarios plus real RBAC SQL with disposable synthetic assignments',institutionalApprovalsExecuted:0}));
}catch(e){console.error(JSON.stringify({failed:true,message:e instanceof assert.AssertionError?e.message:'Disposable F test failed; persistence diagnostics suppressed.',code:e.code||null}));process.exitCode=1;}
finally{await pool?.end();for(const name of [restore,target]){assert.match(name,/^planes_blockf_(restore_)?[a-f0-9]{8}$/);await db.query('DROP DATABASE IF EXISTS '+mysql.escapeId(name));}await db.end();}

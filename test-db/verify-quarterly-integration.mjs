// Disposable persistence only; source schema/data are never migrated or changed.
import mysql from 'mysql2/promise';import dotenv from 'dotenv';import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import {createHash,randomBytes,randomUUID}from'node:crypto';import os from'node:os';import path from'node:path';
import {createQuarterlyIntegrationService}from'../app/services/quarterly-integration.service.js';
import {createFollowupController}from'../app/controllers/controller.followup.js';
import {createEvidenceController}from'../app/controllers/controller.evidence.js';
import {createEvidenceStorage,MAX_EVIDENCE_BYTES}from'../app/services/evidence-storage.service.js';
import {generarResumenSeguimientoTrimestral}from'../app/services/quarterly.followup.service.js';
assert.equal(process.argv.slice(2).join(' '),'--disposable-3307');
const env=dotenv.parse(await readFile(new URL('.env.test',import.meta.url)));
const options={host:'127.0.0.1',port:3307,user:'root',password:env.TEST_DB_ROOT_PASSWORD,database:'planes_accion_test',dateStrings:true};assert.ok(options.password);
const db=await mysql.createConnection(options),suffix=randomBytes(4).toString('hex'),target='planes_blocke_'+suffix,restore='planes_blocke_restore_'+suffix;
const tables=['rol','usuario','plan_accion','actividad','historico','proceso_institucional','plan_institucional','plan_objetivo','plan_indicador','actividad_institucional','actividad_recurso','registro_cambio_institucional','periodo_seguimiento','seguimiento_actividad','seguimiento_decision','evidencia','evidencia_archivo_meta','rol_autorizacion_mutex','plan_flujo','plan_flujo_evento'];
let pool,storageDirectory,passed=0;const check=(v,m)=>{assert.ok(v,m);passed++;},hash=s=>createHash('sha256').update(s).digest('hex');
async function select(schema){assert.ok([target,restore,'planes_accion_test'].includes(schema));assert.equal(db.connection.stream.remotePort,3307);await db.query('USE '+mysql.escapeId(schema));assert.equal((await db.query('SELECT DATABASE() AS db'))[0][0].db,schema);}
async function sourceState(){await select('planes_accion_test');const[t]=await db.query('SHOW TABLES');const result={};for(const row of t){const name=Object.values(row)[0],[[ddl]]=await db.query('SHOW CREATE TABLE '+mysql.escapeId(name)),[cols]=await db.query('SHOW COLUMNS FROM '+mysql.escapeId(name)),[rows]=await db.query('SELECT '+cols.map(c=>mysql.escapeId(c.Field)).join(',')+' FROM '+mysql.escapeId(name));result[name]={ddl:ddl['Create Table'],hash:hash(rows.map(r=>JSON.stringify(r)).sort().join('\n')),count:rows.length};}return result;}
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
const call=async(fn,req)=>{const r=response();await fn(req,r);return r;};
try{
 const original=await sourceState();check(!original.seguimiento_formulacion,'E not applied to the active local database.');
 const ddl=[];for(const table of tables){const[[r]]=await db.query('SHOW CREATE TABLE '+mysql.escapeId(table));ddl.push(r['Create Table'].replace(/ AUTO_INCREMENT=\d+/g,''));}
 await db.query('CREATE DATABASE '+mysql.escapeId(target)+' CHARACTER SET utf8mb4');await select(target);for(const sql of ddl)await db.query(sql);
 for(const id of [9001,9002])await db.execute('INSERT INTO usuario (id_usuario,nombre,correo,`contrase\u00f1a`,estado) VALUES (?,?,?,?,?)',[id,'Synthetic fixture','fixture-'+id+'@example.invalid','NOT_A_LOGIN_HASH','activo']);
 await db.execute('INSERT INTO rol_autorizacion_mutex (mutex_id) VALUES (1)');
 await db.execute('INSERT INTO plan_accion (id_plan,nombre,id_usuario) VALUES (1,?,9001),(2,?,9001)',['Plan sintético','Plan 100 sin verificación']);
 await db.execute('INSERT INTO plan_objetivo (id_objetivo,id_plan,descripcion) VALUES (1,1,?),(2,2,?)',['Objetivo uno','Objetivo dos']);
 await db.execute('INSERT INTO plan_indicador (id_indicador,id_plan,nombre,descripcion,formula) VALUES (1,1,?,?,?)',['Indicador principal','Descripción de medición','No ejecutar: real/meta*100']);
 for(const p of [[1,2026,1,'2026-01-01','2026-03-31','open'],[2,2026,2,'2026-04-01','2026-06-30','closed'],[3,2025,4,'2025-10-01','2025-12-31','open']])await db.execute('INSERT INTO periodo_seguimiento (id_periodo,anio,trimestre,fecha_inicio,fecha_fin,estado,creado_por) VALUES (?,?,?,?,?,?,9001)',p);
 for(const a of [[1,'Suspendida'],[2,'Vencida'],[3,'Completada'],[4,'Completada'],[5,'Pendiente'],[6,'Pendiente'],[7,'Completada']]){
  await db.execute('INSERT INTO actividad (id_actividad,id_plan,descripcion,responsable,fecha_inicio,fecha_fin,estado) VALUES (?,?,?,?,?,?,?)',[a[0],a[0]===7?2:1,'Actividad '+a[0],'Responsable propuesto',a[0]===5?'2026-05-01':'2026-01-01',a[0]===5?'2026-06-30':'2026-03-31',a[1]]);
  await db.execute('INSERT INTO actividad_institucional (id_actividad,id_plan,id_objetivo,evidencias_esperadas) VALUES (?,?,?,?)',[a[0],a[0]===7?2:1,a[0]===7?2:1,'Informe esperado']);
 }
 // Historical approved values are synthetic seed data, not approval operations.
 for(const s of [[1,1,3,40,'approved'],[2,1,1,60,'pending'],[3,2,1,0,'approved'],[4,3,1,100,'approved'],[5,4,1,70,'approved'],[6,5,2,100,'approved'],[7,7,1,100,'approved']])await db.execute('INSERT INTO seguimiento_actividad (id_seguimiento,id_actividad,id_periodo,porcentaje,estado,creado_por) VALUES (?,?,?,?,?,9001)',s);
 async function records(){const list=[];for(const table of tables){const[cols]=await db.query('SHOW COLUMNS FROM '+mysql.escapeId(table));const columns=cols.map(c=>c.Field),[rows]=await db.query('SELECT '+columns.map(c=>mysql.escapeId(c)).join(',')+' FROM '+mysql.escapeId(table));list.push({table,columns,rows:rows.map(r=>columns.map(c=>r[c]))});}return list;}
 const before=await records(),directory=new URL('quarterly-backups.tmp/',import.meta.url);await mkdir(directory,{recursive:true});const file=new URL(suffix+'.json',directory),backup=JSON.stringify({host:'127.0.0.1',port:3307,ddl,records:before});await writeFile(file,backup,{flag:'wx'});const saved=await readFile(file,'utf8');check(hash(saved)===hash(backup),'Backup integrity verified.');
 await db.query('CREATE DATABASE '+mysql.escapeId(restore)+' CHARACTER SET utf8mb4');await select(restore);for(const sql of JSON.parse(saved).ddl)await db.query(sql);for(const t of JSON.parse(saved).records)for(const values of t.rows)await db.execute('INSERT INTO '+mysql.escapeId(t.table)+' ('+t.columns.map(c=>mysql.escapeId(c)).join(',')+') VALUES ('+values.map(()=>'?').join(',')+')',values);
 check(JSON.stringify(await records())===JSON.stringify(before),'Full synthetic pre-E data restored before migration.');await select(target);
 const sql=await readFile(new URL('../migrations/20261103_quarterly_integration.up.sql',import.meta.url),'utf8');for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
 check(JSON.stringify(await records())===JSON.stringify(before),'UP preserved all pre-E records including zero/approved percentages.');
 pool=mysql.createPool({...options,database:target,connectionLimit:5});
 const codes=new Set(['M05.followup.read','M05.followup.update','M04.activities.read','M03.plans.read','M13.evidence.read','M13.evidence.upload','M13.evidence.verify']);
 const proxy={query:(...a)=>pool.query(...a),async getConnection(){const c=await pool.getConnection();return {query:(...a)=>c.query(...a),async execute(s,p){if(s.startsWith('SELECT EXISTS')&&s.includes('FROM rol_asignacion'))return [[{authorized:Number(p[1])===9001?+codes.has(p[0]):+(p[0]==='M05.followup.read')}],[]];return c.execute(s,p);},beginTransaction:()=>c.beginTransaction(),commit:()=>c.commit(),rollback:()=>c.rollback(),release:()=>c.release()};}};
 const service=createQuarterlyIntegrationService({pool:proxy,clock:()=>new Date('2026-02-15T18:00:00Z')});
 let view=await service.overview({actorId:9001},{periodId:1,planId:1});
 check(view.summary.activitiesDue===5&&view.summary.activitiesApproved===3,'Denominator and approved count reuse existing eligibility.');
 check(view.summary.summary.promedioAvance===(0+100+70)/3&&view.summary.summary.coberturaTrimestral===60,'Official mean/coverage reuse existing functions without rounding.');
 check(view.activities.find(a=>a.id_actividad===1).progress.lastApproved===40&&view.activities.find(a=>a.id_actividad===1).progress.quarterApproved==null,'Suspended activity keeps prior approval and pending does not substitute it.');
 check(view.activities.find(a=>a.id_actividad===2).progress.quarterApproved===0,'Zero remains an approved zero, not missing information.');
 check(view.activities.find(a=>a.id_actividad===4).progress.completedStateInconsistent&&view.activities.find(a=>a.id_actividad===4).progress.lastApproved===70,'Completed contradiction is exposed without inventing 100.');
 check(!view.activities.some(a=>a.id_actividad===5),'Future activity does not affect selected-quarter rows.');
 check(view.activities[0].plan.indicador.nombre==='Indicador principal','C principal indicator is connected descriptively.');
 check(view.activePeriodId===1&&!view.activeAmbiguous,'Active quarter identified from stored dates and Colombia calendar.');
 check((await service.overview({actorId:9001},{periodId:1,planId:2})).completion.complete===false,'100 percent alone cannot certify evidence compliance.');
 const restricted=await service.overview({actorId:9002},{periodId:1,planId:1});check(restricted.activities.every(a=>a.plan===null&&a.formulation===null)&&restricted.canEvidence===false&&restricted.files.length===0,'Permission restrictions redact C details and evidence.');
 const filtered=await service.overview({actorId:9001},{periodId:1,planId:1,activityId:2});check(filtered.activities.length===1&&filtered.summary.activitiesDue===5,'Activity filtering does not silently change global denominator.');
 const followup=createFollowupController(pool);
 for(const[fn,req]of [[followup.createPeriod,{body:{anio:2027,trimestre:1,fecha_inicio:'2027-01-01',fecha_fin:'2027-03-31'}}],[followup.closePeriod,{params:{id:1}}],[followup.decideFollowup,{params:{id:2},body:{resultado:'approved',motivo:'Denied test'}}]]){const result=await call(fn,{usuario:{sub:'9001'},...req});check(result.statusCode===403,'Legacy institutional operation remains closed.');}
 const submitted=await call(followup.createFollowup,{usuario:{sub:'9001'},params:{id:6},body:{id_periodo:1,porcentaje:'25.25',observaciones:'Contexto conservado'}});check(submitted.statusCode===201&&submitted.body.estado==='pending','New provisional follow-up persists without approval.');
 const[[snapshot]]=await db.execute('SELECT instantanea FROM seguimiento_formulacion WHERE id_seguimiento=?',[submitted.body.id_seguimiento]);check(JSON.parse(snapshot.instantanea).indicador==='Indicador principal','New follow-up stores C formulation snapshot.');
 storageDirectory=await mkdtemp(path.join(os.tmpdir(),'planes-evidence-e-'));const storage=createEvidenceStorage({directory:storageDirectory}),controller=createEvidenceController({pool,storage});
 const payload=Buffer.alloc(MAX_EVIDENCE_BYTES,120),uploadReq={usuario:{sub:'9001'},params:{id:1},headers:{'x-evidence-name':encodeURIComponent('máximo.txt'),'x-evidence-type':'text/plain','x-followup-id':'2'},body:payload};
 const uploaded=await call(controller.uploadBytes,uploadReq);check(uploaded.statusCode===201&&uploaded.body.estado==='uploaded','10 MiB binary upload persists as supplied, not approved.');
 await writeFile(new URL(suffix+'-open.json',directory),JSON.stringify(await service.overview({actorId:9001},{periodId:1,planId:1})));
 const eid=uploaded.body.id_evidencia,[[meta]]=await db.execute('SELECT bytes,sha256,storage_key,mime_type FROM evidencia_archivo_meta WHERE id_evidencia=?',[eid]);check(meta.bytes===MAX_EVIDENCE_BYTES&&(await storage.read({storageKey:meta.storage_key,mimeType:meta.mime_type,expectedBytes:meta.bytes,expectedSha256:meta.sha256})).equals(payload),'Stored maximum-size file passes hash/length verification.');
 check((await call(controller.uploadBytes,{...uploadReq,body:Buffer.alloc(MAX_EVIDENCE_BYTES+1)})).statusCode===400,'Oversized input rejected before file persistence.');
 check((await call(controller.uploadBytes,{...uploadReq,headers:{...uploadReq.headers,'x-evidence-name':'fake.pdf','x-evidence-type':'application/pdf'},body:Buffer.from('not pdf')})).statusCode===400,'MIME spoof is rejected and rolled back.');
 check((await call(controller.uploadBytes,{...uploadReq,params:{id:2}})).statusCode===400,'Cross-activity follow-up association rejected.');
 check((await call(controller.uploadBytes,{...uploadReq,params:{id:5},headers:{...uploadReq.headers,'x-followup-id':'6'},body:Buffer.from('closed')})).statusCode===409,'Closed-period evidence association rejected.');
 await assert.rejects(service.institutionalAction({actorId:9001},'verify_evidence',{id:eid,motivo:'Denied',resultado:'approved'}),e=>e.code==='INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED');passed++;
 const nonce=randomUUID(),request=await service.requestReopen({actorId:9001},2,{motivo:'Justificación de solicitud',client_id:nonce});check(request.estado==='pending','Reopen request is persisted without reopening.');
 check((await service.requestReopen({actorId:9001},2,{motivo:'Justificación de solicitud',client_id:nonce})).duplicate===true,'Repeated request is idempotent.');
 await assert.rejects(service.institutionalAction({actorId:9001},'reopen_period',{id:2,id_solicitud:request.id_solicitud,motivo:'Denied'}),e=>e.code==='INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED');passed++;
 check((await db.execute('SELECT estado FROM periodo_seguimiento WHERE id_periodo=2'))[0][0].estado==='closed','Reopen request and denied action preserve closed state.');
 const fixtureReopen=createQuarterlyIntegrationService({pool:proxy,authority:async()=>({allowed:true,reference:'TEST-REOPEN-ONLY'})});
 check((await fixtureReopen.institutionalAction({actorId:9001},'reopen_period',{id:2,id_solicitud:request.id_solicitud,motivo:'Synthetic authorized reopen'})).estado==='open','Synthetic server-authorized reopen persists with request trace.');
 check((await service.overview({actorId:9001},{periodId:2})).requests[0].estado==='reopened','Request resolution is derived from its immutable acting record.');
 const fixtureClose=createFollowupController(pool,{institutionalAuthority:async()=>({allowed:true,reference:'TEST-CLOSE-ONLY'})});
 check((await call(fixtureClose.closePeriod,{usuario:{sub:'9001'},params:{id:1}})).statusCode===200,'Synthetic authorized close stores an immutable result version.');
 const frozen=await service.overview({actorId:9001},{periodId:1,planId:1});check(frozen.closedSnapshotAvailable,'Closed result version is read.');
 await db.execute('UPDATE actividad SET fecha_fin=? WHERE id_actividad=6',['2027-01-01']);
 const preserved=await service.overview({actorId:9001},{periodId:1,planId:1});const legacySummary=await call(followup.summary,{params:{id:1}}),globalFrozen=await service.overview({actorId:9001},{periodId:1});check(legacySummary.body.summary.promedioAvance===globalFrozen.summary.summary.promedioAvance&&legacySummary.body.activitiesDue===globalFrozen.summary.activitiesDue,'Legacy summary endpoint also preserves the closed version.');check(JSON.stringify(preserved.summary)===JSON.stringify(frozen.summary),'Later activity-date changes do not change versioned closed-quarter result.');
 await writeFile(new URL(suffix+'-closed.json',directory),JSON.stringify(preserved));
 await assert.rejects(db.execute('UPDATE seguimiento_evidencia SET vinculado_por=9002 WHERE id_evidencia=?',[eid]),e=>e.code==='ER_SIGNAL_EXCEPTION');passed++;
 await assert.rejects(db.execute('DELETE FROM periodo_resultado_version WHERE id_periodo=1'),e=>e.code==='ER_SIGNAL_EXCEPTION');passed++;
 const official=generarResumenSeguimientoTrimestral([0,100,70],3,5);check(official.promedioAvance===frozen.summary.summary.promedioAvance,'Existing official calculation service remains the source.');
 check(JSON.stringify(await sourceState())===JSON.stringify(original),'All active C/D data and schema unchanged; E not migrated there.');
 console.log(JSON.stringify({passed,backupRestored:true,maxUploadBytes:MAX_EVIDENCE_BYTES,officialCalculationsPreserved:true,sourceChanged:false,sourceMigrated:false,downExecuted:false,approvalOperationsExecuted:0,authorizationDecisions:'simulated for disposable tests only'}));
}catch(error){console.error(JSON.stringify({failed:true,reason:error instanceof assert.AssertionError?error.message:'Disposable E verification failed; persistence diagnostics suppressed.'}));process.exitCode=1;}
finally{await pool?.end();for(const name of [restore,target]){assert.match(name,/^planes_blocke_(restore_)?[a-f0-9]{8}$/);await db.query('DROP DATABASE IF EXISTS '+mysql.escapeId(name));}await db.end();if(storageDirectory){const resolved=path.resolve(storageDirectory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('planes-evidence-e-'));await rm(resolved,{recursive:true,force:true});}}

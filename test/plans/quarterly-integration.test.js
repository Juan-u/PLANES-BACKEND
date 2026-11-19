import assert from 'node:assert/strict';import {test}from'node:test';import {mkdtemp,rm,readFile}from'node:fs/promises';import path from'node:path';import os from'node:os';
import {progress,officialSummary,completion,approvedValue}from'../../app/services/quarterly-integration.rules.js';
import {createFollowupController}from'../../app/controllers/controller.followup.js';
import {createEvidenceStorage}from'../../app/services/evidence-storage.service.js';
import {createQuarterlyIntegrationService}from'../../app/services/quarterly-integration.service.js';
test('approved zero differs from absence and unapproved values do not enter the mean',()=>{
  const rows=[{due:true,progress:progress({porcentaje_trimestral:'0.00',ultimo_aprobado:0})},{due:true,pendingId:'2',progress:progress({porcentaje_trimestral:null,ultimo_aprobado:null})}];
  assert.deepEqual(officialSummary(rows),{activitiesDue:2,activitiesApproved:1,activitiesPending:1,summary:{promedioAvance:0,coberturaTrimestral:50}});
});
test('empty denominator is No aplica, never an invented zero',()=>{
  const value=officialSummary([]);assert.equal(value.summary.promedioAvance.estado,'no_aplica');assert.equal(value.summary.coberturaTrimestral.estado,'no_aplica');
});
for(const estado of ['Suspendida','Vencida'])test(`${estado} keeps the last approved progress unchanged`,()=>assert.deepEqual(progress({estado,porcentaje_trimestral:null,ultimo_aprobado:'45.25'}),{quarterApproved:null,lastApproved:45.25,completedStateInconsistent:false}));
test('completed activity without approved 100 is flagged, not rewritten',()=>{
  assert.equal(progress({estado:'Completada',ultimo_aprobado:70}).lastApproved,70);assert.equal(progress({estado:'Completada',ultimo_aprobado:70}).completedStateInconsistent,true);assert.equal(progress({estado:'Completada',ultimo_aprobado:100}).completedStateInconsistent,false);
});
for(const input of ['', ' ', 'NaN', '-1',101,Infinity,{},true])test(`invalid approved data does not become zero: ${String(input)}`,()=>assert.throws(()=>approvedValue(input),e=>e.code==='INVALID_APPROVED_DATA'));
test('100 average alone never certifies a plan, required evidence needs independent verification',()=>{
  const rows=[{id_actividad:1,progress:{lastApproved:100}}];assert.equal(completion(rows,null).complete,false);assert.equal(completion([{id_actividad:1,progress:{lastApproved:99.99}}],{confirmed:true,reference:'Fixture',verifiedActivityIds:[1]}).complete,false);
  assert.equal(completion(rows,{confirmed:true,reference:'Fixture',verifiedActivityIds:[]}).complete,false);
  assert.equal(completion(rows,{confirmed:true,reference:'Fixture',verifiedActivityIds:[1]}).complete,true);
});
for(const[name,request]of [['createPeriod',{body:{anio:2026,trimestre:1,fecha_inicio:'2026-01-01',fecha_fin:'2026-03-31'}}],['closePeriod',{params:{id:'1'}}],['decideFollowup',{params:{id:'1'},body:{resultado:'approved',motivo:'No authority'}}]])test(`${name} is closed even with a valid actor`,async()=>{
  let connected=false;const pool={query(){},getConnection(){connected=true;throw new Error('must not connect');}},res={statusCode:200,status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};
  await createFollowupController(pool)[name]({usuario:{sub:'78'},...request},res);assert.equal(res.statusCode,403);assert.equal(res.body.code,'INSTITUTIONAL_AUTHORITY_NOT_CONFIGURED');assert.equal(connected,false);
});
test('binary storage supports files above legacy 64KB and rejects content/extension spoofing',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'planes-unit-e-'));try{
    const storage=createEvidenceStorage({directory}),bytes=Buffer.alloc(70000,120),file=await storage.saveBytes({originalName:'../nota.txt',mimeType:'text/plain',bytes});
    assert.equal(file.originalName,'nota.txt');assert.equal((await readFile(file.destination)).length,70000);
    await assert.rejects(storage.saveBytes({originalName:'evil.exe',mimeType:'text/plain',bytes}),TypeError);
    await assert.rejects(storage.saveBytes({originalName:'fake.png',mimeType:'image/png',bytes}),TypeError);
  }finally{const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('planes-unit-e-'));await rm(resolved,{recursive:true,force:true});}
});
test('bad filters fail before database access',async()=>{
  const service=createQuarterlyIntegrationService({pool:{getConnection(){throw new Error('unexpected');}}});
  for(const query of [{anio:'foo'},{anio:'0'},{trimestre:'0'},{trimestre:'5'},{estado:'all OR 1=1'}])assert.throws(()=>service.overview({actorId:1},query),e=>e.code==='INVALID_FILTER');
});

test('scoped quarterly overview bounds activities, history, evidence and metric inputs by authorized plans', async () => {
  const activity = { id_actividad: 10, id_plan: 1, fecha_fin: '2026-03-10', porcentaje_trimestral: 25, ultimo_aprobado: 25 };
  const period = { id_periodo: 4, estado: 'open', anio: 2026, trimestre: 1, fecha_inicio: '2026-01-01', fecha_fin: '2026-03-31' };
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('rol_autorizacion_mutex')) return [[{ mutex_id: 1 }]];
      if (sql.includes('FROM usuario')) return [[{ id_usuario: 3 }]];
      if (sql.includes('AS authorized')) return [[{ authorized: 0 }]];
      if (sql.includes('SELECT DISTINCT resource_scope')) return [[{ id_plan: 1, id_actividad: null }]];
      if (sql.includes('p.nombre AS plan_nombre')) {
        assert.match(sql, /a.id_plan IN \(\?\)/);
        assert.equal(params.at(-1), 1);
        return [params.includes(2) ? [] : [activity]];
      }
      if (sql.includes('FROM seguimiento_actividad s JOIN actividad a')) {
        assert.match(sql, /a.id_plan IN \(\?\)/);
        assert.equal(params.at(-1), 1);
        return [params.includes(2) ? [] : [{ id_seguimiento: '100', id_actividad: 10 }]];
      }
      assert.fail(sql);
    },
    async query(sql, params) {
      if (sql.includes('information_schema')) return [[{ table_count: 7, trigger_count: 14, limit_count: 1 }]];
      if (sql.includes('FROM periodo_seguimiento')) return [[period]];
      assert.match(sql, /JOIN actividad a.*a.id_plan IN \(\?\)/s);
      assert.deepEqual(params, [10, 1]);
      return [[{ id_evidencia: 5, id_actividad: 10 }]];
    }
  };
  const service = createQuarterlyIntegrationService({ pool: { async getConnection() { return connection; } } });
  const own = await service.overview({ actorId: 3 });
  assert.deepEqual(own.activities.map(row => row.id_actividad), [10]);
  assert.equal(own.history.length, 1);
  assert.equal(own.files.length, 1);
  assert.equal(own.summary.activitiesDue, 1);
  assert.equal(own.generalAverage, 25);
  assert.deepEqual([own.requests, own.periodHistory], [[], []]);
  const other = await service.overview({ actorId: 3 }, { planId: '2' });
  assert.deepEqual([other.activities, other.history, other.files], [[], [], []]);
  assert.equal(other.summary.activitiesDue, 0);
  await assert.rejects(service.requestReopen({ actorId: 3 }, 4, {
    motivo: 'Revisar', client_id: '0ed45be4-9877-43ab-be4a-f616ddd03cc0'
  }), error => error.code === 'FORBIDDEN');
  assert.ok(calls.every(({ sql }) => !sql.includes('INSERT')));
});
test('E migration never inserts/updates existing approval/percentage rows',async()=>{
  const sql=await readFile(new URL('../../migrations/20261103_quarterly_integration.up.sql',import.meta.url),'utf8');
  assert.doesNotMatch(sql,/UPDATE seguimiento_actividad|INSERT INTO seguimiento_decision|UPDATE calificacion|INSERT INTO rol_asignacion/i);
  assert.match(sql,/10485760/);assert.match(sql,/BEFORE DELETE ON periodo_resultado_version/);
});

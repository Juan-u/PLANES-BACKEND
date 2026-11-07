import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadModelsController } from '../../app/controllers/controller.readmodels.js';

function response() {
  return { code: 200, statusCode:200, body: null, status(code) { this.code = code; this.statusCode=code; return this; }, json(value) { this.body = value; return this; }, type(value) { this.contentType = value; return this; }, attachment(value) { this.filename = value; return this; }, send(value) { this.body = value; return this; } };
}

test('evidence query only returns existing metadata for the requested activity', async () => {
  let call;
  const pool = { async query(sql, params) { call = { sql, params }; return [[{ id_evidencia: 3, id_actividad: 7, observaciones: 'Adjunto' }], []]; } };
  const res = response();
  await createReadModelsController(pool).listEvidenceByActivity({ params: { id: '7' } }, res);
  assert.equal(call.params[0], 7);
  assert.match(call.sql, /JOIN actividad/);
  assert.equal(res.body[0].id_evidencia, 3);
  assert.doesNotMatch(call.sql, /e\.archivo/);
});

test('assessment report filters by existing plan and quarter columns', async () => {
  let call;
  const pool = { async query(sql, params) { call = { sql, params }; return [[{ id_calificacion: 1, trimestre: 2, puntaje: 78, id_plan: 9 }], []]; } };
  const res = response();
  await createReadModelsController(pool).listAssessments({ query: { planId: '9', trimestre: '2' } }, res);
  assert.deepEqual(call.params, [9, 2]);
  assert.match(call.sql, /LEFT JOIN plan_accion/);
  assert.equal(res.body[0].puntaje, 78);
});

test('report export quotes cells and neutralizes spreadsheet formulas', async () => {
  const pool = { async query() { return [[{ id_calificacion: 2, trimestre: 1, puntaje: 95, observaciones_planeacion: '=WEBSERVICE("x")', id_plan: 4, nombre_plan: 'Plan, uno' }], []]; } };
  const res = response();
  await createReadModelsController(pool).exportAssessments({ query: {} }, res);
  assert.equal(res.filename, 'calificaciones.csv');
  assert.match(res.body, /'=WEBSERVICE/);
  assert.match(res.body, /"Plan, uno"/);
});

test('rejects invalid report filters without querying', async () => {
  let queries = 0;
  const pool = { async query() { queries++; return [[], []]; } };
  const res = response();
  await createReadModelsController(pool).listAssessments({ query: { trimestre: '2 OR 1=1' } }, res);
  assert.equal(res.code, 400);
  assert.equal(queries, 0);
});
test('assessment query and export reject quarters outside the existing 1-4 range',async()=>{
 let queries=0;const controller=createReadModelsController({async query(){queries++;return[[],[]];}});
 for(const trimestre of ['0','5',['1','2']]){const res=response();await controller.listAssessments({query:{trimestre}},res);assert.equal(res.code,400);const csv=response();await controller.exportAssessments({query:{trimestre}},csv);assert.equal(csv.code,400);}
 assert.equal(queries,0);
});

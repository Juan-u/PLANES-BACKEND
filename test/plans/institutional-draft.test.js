import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDraft, attachDrafts, saveDraft, DraftError } from '../../app/services/institutional-draft.service.js';
import { crearControladorConsultaPlanes } from '../../app/controllers/controller.plan.js';
import { createActivityController } from '../../app/controllers/controller.activity.js';

test('legacy requests do not opt in; incomplete institutional drafts are valid', () => {
  assert.equal(normalizeDraft({ nombre: 'Existing' }, 'plan'), undefined);
  const value = normalizeDraft({ institucional: {} }, 'plan');
  assert.equal(value.problema, null);
  assert.equal(value.responsable_principal, null);
  assert.equal(value.objetivos, undefined);
});
test('exact decimal values and zero are preserved without indicator calculations', () => {
  const source = { institucional: { meta_valor: '0.0000', indicador: { formula: 'real/meta * 100' }, objetivos: [{ descripcion: ' Objetivo ' }] } };
  const snapshot = structuredClone(source);
  const result = normalizeDraft(source, 'plan');
  assert.equal(result.meta_valor, '0.0000');
  assert.equal(result.indicador.formula, 'real/meta * 100');
  assert.deepEqual(result.objetivos, [{ id: null, descripcion: 'Objetivo' }]);
  assert.deepEqual(source, snapshot);
});
for (const institucional of [null, [], { meta_valor: 'NaN' }, { meta_valor: '1e8' }, { meta_valor: '1.23456' }, { problema: '\0' }, { id_proceso: '1 OR 1=1' }, { objetivos: [{ id: 1, descripcion: 'A' }, { id: 1, descripcion: 'B' }] }, { objetivos: [{ descripcion: '' }] }, { indicador: { nombre: 'x'.repeat(151) } }]) {
  test(`invalid plan draft is rejected: ${JSON.stringify(institucional).slice(0, 70)}`, () => {
    assert.throws(() => normalizeDraft({ institucional }, 'plan'), DraftError);
  });
}
for (const institucional of [{ prioridad: 'urgente' }, { recursos: [{ descripcion: 'Recurso', costo_estimado: '-1' }] }, { recursos: [{ descripcion: 'Recurso', cantidad: '1.00001' }] }, { recursos: Array.from({ length: 101 }, () => ({ descripcion: 'R' })) }]) {
  test(`invalid activity draft is rejected: ${JSON.stringify(institucional).slice(0, 70)}`, () => assert.throws(() => normalizeDraft({ institucional }, 'actividad'), DraftError));
}
test('migration absence preserves legacy reads; other query errors remain visible', async () => {
  const rows = [{ id_plan: 3 }];
  const db = { async query() { throw Object.assign(new Error('not exposed'), { code: 'ER_NO_SUCH_TABLE' }); } };
  assert.deepEqual(await attachDrafts(db, rows, 'plan'), [{ id_plan: 3, institucional: null }]);
  db.query = async () => { throw new Error('unavailable'); };
  await assert.rejects(attachDrafts(db, rows, 'plan'), /unavailable/);
});
test('stale revision fails before updates and an objective from another plan is refused', async () => {
  const calls = [];
  const tx = {
    async execute(sql) { calls.push(sql); return [[{ id_plan: 3 }]]; },
    async query(sql) { return [sql.includes('FROM plan_institucional') ? [{ id_plan: 3, revision: 2 }] : []]; }
  };
  await assert.rejects(saveDraft(tx, 'plan', 3, 3, normalizeDraft({ institucional: { revision: 1 } }, 'plan'), 1), e => e.status === 409);
  assert.ok(calls.every(sql => sql.startsWith('SELECT')));
  tx.query = async () => [[]];
  tx.execute = async sql => [sql.includes('FROM plan_accion') ? [{ id_plan: 3 }] : []];
  await assert.rejects(saveDraft(tx, 'actividad', 5, 3, normalizeDraft({ institucional: { id_objetivo: 42 } }, 'actividad'), 1), DraftError);
});
test('invalid drafts return 400 before a transaction or base-row write', async () => {
  const pool = { async query() { throw new Error('unexpected'); }, getConnection() { throw new Error('unexpected'); } };
  for (const [controller, body] of [[crearControladorConsultaPlanes(pool).crearPlan, { nombre: 'Draft', institucional: { meta_valor: 'bad' } }], [createActivityController(pool).create, { id_plan: 1, institucional: { prioridad: 'bad' } }]]) {
    const res = { code: 200, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
    await controller({ usuario: { sub: '1' }, body }, res);
    assert.equal(res.code, 400);
    assert.equal(typeof res.body.error, 'string');
  }
});

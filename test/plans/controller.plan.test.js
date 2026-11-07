import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { crearControladorConsultaPlanes } from '../../app/controllers/controller.plan.js';

function crearResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function crearPool({ result = [[], []], error = null } = {}) {
  return {
    query: mock.fn(async (...args) => {
      if (error) throw error;
      if (!args[0].includes('FROM plan_accion')) return [[], []];
      return result;
    })
  };
}

function crearPoolTransaccional({ execute } = {}) {
  const events = [];
  const connection = {
    async query() { throw Object.assign(new Error('D not migrated'), {code:'ER_NO_SUCH_TABLE'}); },
    async beginTransaction() { events.push('begin'); },
    async execute(sql, params) {
      events.push({ sql, params });
      if (execute) return execute(sql, params);
      return [{ insertId: 31, affectedRows: 1 }, []];
    },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); }
  };
  return { events, pool: { query: async () => [[], []], async getConnection() { events.push('getConnection'); return connection; } } };
}

const planesSinteticos = [
  {
    id_plan: 17,
    nombre: 'Plan sintético',
    descripcion: 'Dato de prueba',
    fecha_creacion: '2026-01-15',
    estado: 'Borrador'
  }
];

test('lista planes usando solo campos observados y no expone id_usuario', async () => {
  const pool = crearPool({ result: [planesSinteticos, []] });
  const { listarPlanes } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();

  await listarPlanes({}, res);

  assert.deepEqual(res.body, planesSinteticos.map(p => ({ ...p, institucional: null })));
  assert.equal(pool.query.mock.callCount(), 5);
  const [sql, params] = pool.query.mock.calls[0].arguments;
  assert.equal(
    sql,
    'SELECT id_plan, nombre, descripcion, fecha_creacion, estado FROM plan_accion'
  );
  assert.deepEqual(params, undefined);
  assert.doesNotMatch(sql, /SELECT\s+\*/i);
  assert.doesNotMatch(sql, /id_usuario/i);
});

test('consulta un plan existente con ID parametrizado', async () => {
  const pool = crearPool({ result: [planesSinteticos, []] });
  const { obtenerPlan } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();

  await obtenerPlan({ params: { id: '17' } }, res);

  assert.deepEqual(res.body, { ...planesSinteticos[0], institucional: null });
  assert.deepEqual(pool.query.mock.calls[0].arguments, [
    'SELECT id_plan, nombre, descripcion, fecha_creacion, estado FROM plan_accion WHERE id_plan = ? LIMIT 1',
    [17]
  ]);
});

test('rechaza IDs inválidos sin ejecutar una consulta', async (t) => {
  for (const id of ['', '0', '-1', '1.5', 'abc', '2147483648', '9007199254740992']) {
    await t.test(`ID ${JSON.stringify(id)}`, async () => {
      const pool = crearPool();
      const { obtenerPlan } = crearControladorConsultaPlanes(pool);
      const res = crearResponse();

      await obtenerPlan({ params: { id } }, res);

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { error: 'Identificador de plan inválido.' });
      assert.equal(pool.query.mock.callCount(), 0);
    });
  }
});

test('responde 404 cuando el ID válido no corresponde a un plan', async () => {
  const pool = crearPool({ result: [[], []] });
  const { obtenerPlan } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();

  await obtenerPlan({ params: { id: '404' } }, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Plan no encontrado.' });
  assert.equal(pool.query.mock.callCount(), 1);
});

test('devuelve error genérico si falla el listado y no revela el error de almacenamiento', async () => {
  const pool = crearPool({ error: new Error('detalle SQL confidencial') });
  const { listarPlanes } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();

  await listarPlanes({}, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    error: 'No fue posible consultar los planes temporalmente.'
  });
  assert.equal(JSON.stringify(res.body).includes('detalle SQL confidencial'), false);
});

test('crea plan y evento histórico en una única transacción parametrizada', async () => {
  const { pool, events } = crearPoolTransaccional();
  const { crearPlan } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();
  await crearPlan({ usuario: { sub: '21' }, body: { nombre: 'Plan nuevo', descripcion: 'Descripción' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.id_plan, 31);
  assert.equal(events[0], 'getConnection');
  assert.equal(events[1], 'begin');
  assert.match(events[2].sql, /^INSERT INTO plan_accion/);
  assert.deepEqual(events[2].params, ['Plan nuevo', 'Descripción', 21]);
  assert.match(events[3].sql, /^INSERT INTO historico/);
  assert.deepEqual(events[3].params, ['plan_accion_created:31', 21]);
  assert.deepEqual(events.slice(-2), ['commit', 'release']);
});

test('rechaza crear planes sin identidad autenticada o con datos inválidos antes de persistir', async () => {
  const { pool, events } = crearPoolTransaccional();
  const { crearPlan } = crearControladorConsultaPlanes(pool);
  const unauthenticated = crearResponse();
  await crearPlan({ body: { nombre: 'Nombre' } }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);
  const invalid = crearResponse();
  await crearPlan({ usuario: { sub: '21' }, body: { nombre: '  ' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(events, []);
});

test('rechaza descripciones superiores al límite del tipo TEXT antes de abrir transacción', async () => {
  const { pool, events } = crearPoolTransaccional();
  const { crearPlan } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();
  await crearPlan({ usuario: { sub: '21' }, body: { nombre: 'Plan', descripcion: 'x'.repeat(65536) } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(events, []);
});

test('actualiza un plan existente y registra el evento histórico dentro de la transacción', async () => {
  const { pool, events } = crearPoolTransaccional({ execute: async (sql) =>
    sql.startsWith('SELECT') ? [[{ id_plan: 17, nombre: 'Anterior', descripcion: null, fecha_creacion: '2026-01-01', estado: null }], []] : [{ affectedRows: 1 }, []] });
  const { actualizarPlan } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();
  await actualizarPlan({ usuario: { sub: '21' }, params: { id: '17' }, body: { nombre: 'Actualizado', descripcion: null } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.nombre, 'Actualizado');
  assert.match(events[2].sql, /FOR UPDATE/);
  assert.match(events[3].sql, /^UPDATE plan_accion/);
  assert.match(events[4].sql, /^INSERT INTO historico/);
  assert.deepEqual(events.slice(-2), ['commit', 'release']);
});

test('un fallo de historial revierte la creación y devuelve un error genérico', async () => {
  const { pool, events } = crearPoolTransaccional({ execute: async (sql) => {
    if (sql.startsWith('INSERT INTO historico')) throw new Error('detalle persistencia');
    return [{ insertId: 31 }, []];
  } });
  const { crearPlan } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();
  await crearPlan({ usuario: { sub: '21' }, body: { nombre: 'Plan', descripcion: null } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(events.slice(-2), ['rollback', 'release']);
  assert.equal(JSON.stringify(res.body).includes('detalle persistencia'), false);
});

test('devuelve error genérico si falla la consulta de detalle', async () => {
  const pool = crearPool({ error: new Error('detalle SQL confidencial') });
  const { obtenerPlan } = crearControladorConsultaPlanes(pool);
  const res = crearResponse();

  await obtenerPlan({ params: { id: '17' } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    error: 'No fue posible consultar el plan temporalmente.'
  });
  assert.equal(JSON.stringify(res.body).includes('detalle SQL confidencial'), false);
});

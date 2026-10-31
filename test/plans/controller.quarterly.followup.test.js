import assert from 'node:assert/strict';
import test from 'node:test';
import { crearControladorSeguimientoTrimestral } from '../../app/controllers/controller.quarterly.followup.js';

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

test('usa los datos preparados por el servidor para generar el resumen', async () => {
  const req = {
    body: {
      porcentajesAprobados: [100],
      actividadesConSeguimientoAprobado: 99,
      actividadesCuyoSeguimientoVencia: 99
    }
  };
  const datosPreparados = {
    porcentajesAprobados: [40, 80],
    actividadesConSeguimientoAprobado: 3,
    actividadesCuyoSeguimientoVencia: 4
  };
  const llamadasResumen = [];
  const res = crearResponse();
  const controlador = crearControladorSeguimientoTrimestral(
    async (solicitud) => {
      assert.strictEqual(solicitud, req);
      return datosPreparados;
    },
    (...argumentos) => {
      llamadasResumen.push(argumentos);
      return { promedioAvance: 60, coberturaTrimestral: 75 };
    }
  );

  await controlador(req, res);

  assert.deepEqual(llamadasResumen, [[
    datosPreparados.porcentajesAprobados,
    datosPreparados.actividadesConSeguimientoAprobado,
    datosPreparados.actividadesCuyoSeguimientoVencia
  ]]);
  assert.deepEqual(res.body, {
    promedioAvance: 60,
    coberturaTrimestral: 75
  });
});

test('devuelve promedio y cobertura en propiedades separadas', async () => {
  const resultado = {
    promedioAvance: 60,
    coberturaTrimestral: 75
  };
  const controlador = crearControladorSeguimientoTrimestral(
    async () => ({
      porcentajesAprobados: [40, 80],
      actividadesConSeguimientoAprobado: 3,
      actividadesCuyoSeguimientoVencia: 4
    }),
    () => resultado
  );
  const res = crearResponse();

  await controlador({}, res);

  assert.deepEqual(res.body, resultado);
  assert.equal(res.body.promedioAvance, 60);
  assert.equal(res.body.coberturaTrimestral, 75);
});

test('conserva los resultados no_aplica del promedio y la cobertura', async () => {
  const resultado = {
    promedioAvance: {
      estado: 'no_aplica',
      explicacion: 'No hab\u00eda actividades evaluables.'
    },
    coberturaTrimestral: {
      estado: 'no_aplica',
      explicacion: 'No hab\u00eda actividades evaluables.'
    }
  };
  const controlador = crearControladorSeguimientoTrimestral(
    async () => ({
      porcentajesAprobados: [],
      actividadesConSeguimientoAprobado: 0,
      actividadesCuyoSeguimientoVencia: 0
    }),
    () => resultado
  );
  const res = crearResponse();

  await controlador({}, res);

  assert.deepEqual(res.body, resultado);
  assert.equal(res.body.promedioAvance.estado, 'no_aplica');
  assert.equal(res.body.coberturaTrimestral.estado, 'no_aplica');
});

test('devuelve un error generico sin exponer mensajes internos', async () => {
  const mensajeInterno = 'detalle interno que no debe exponerse';
  const controlador = crearControladorSeguimientoTrimestral(
    async () => {
      throw new Error(mensajeInterno);
    },
    () => ({ promedioAvance: 60, coberturaTrimestral: 75 })
  );
  const res = crearResponse();

  await controlador({}, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: 'No fue posible generar el resumen trimestral.'
  });
  assert.equal(JSON.stringify(res.body).includes(mensajeInterno), false);
});

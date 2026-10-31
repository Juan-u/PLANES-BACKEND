import assert from 'node:assert/strict';
import test from 'node:test';
import { generarResumenSeguimientoTrimestral } from '../../app/services/quarterly.followup.service.js';

test('devuelve por separado el promedio y la cobertura calculados', () => {
  assert.deepEqual(generarResumenSeguimientoTrimestral([40, 80], 3, 4), {
    promedioAvance: 60,
    coberturaTrimestral: 75
  });
});

test('conserva promedio No aplica junto con cobertura numerica', () => {
  assert.deepEqual(generarResumenSeguimientoTrimestral([], 3, 4), {
    promedioAvance: {
      estado: 'no_aplica',
      explicacion: 'No hab\u00eda actividades evaluables.'
    },
    coberturaTrimestral: 75
  });
});

test('conserva cobertura No aplica junto con promedio numerico', () => {
  assert.deepEqual(generarResumenSeguimientoTrimestral([40, 80], 3, 0), {
    promedioAvance: 60,
    coberturaTrimestral: {
      estado: 'no_aplica',
      explicacion: 'No hab\u00eda actividades evaluables.'
    }
  });
});

test('mantiene los resultados No aplica en sus propiedades independientes', () => {
  const noAplica = {
    estado: 'no_aplica',
    explicacion: 'No hab\u00eda actividades evaluables.'
  };

  assert.deepEqual(generarResumenSeguimientoTrimestral([], 0, 0), {
    promedioAvance: noAplica,
    coberturaTrimestral: noAplica
  });
});

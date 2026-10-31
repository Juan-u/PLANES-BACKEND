import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decidirInclusionActividadSuspendida,
  obtenerAvanceActividadVencida,
  debeExcluirActividadFuturaDelTrimestre,
  conservarAvanceAprobadoActividadSuspendida,
  calcularPromedioAvanceAprobado,
  calcularCoberturaTrimestral,
  calcularResumenSeguimientoTrimestral
} from '../../app/services/activity.progress.service.js';

test('incluye una actividad suspendida cuando tiene seguimiento aprobado', () => {
  assert.equal(decidirInclusionActividadSuspendida(true), 'incluida');
});

test('excluye como pendiente una actividad suspendida sin seguimiento aprobado', () => {
  assert.equal(decidirInclusionActividadSuspendida(false), 'excluida_pendiente');
});

test('conserva e incluye el último avance aprobado de una actividad vencida', () => {
  for (const avance of [45, 100, 0]) {
    assert.deepEqual(obtenerAvanceActividadVencida(avance), {
      incluida: true,
      avance
    });
  }
});

test('excluye del trimestre cuando la actividad es futura respecto a este', () => {
  assert.equal(debeExcluirActividadFuturaDelTrimestre(true), true);
});

test('no excluye del trimestre por esta regla cuando la actividad no es futura', () => {
  assert.equal(debeExcluirActividadFuturaDelTrimestre(false), false);
});

test('conserva sin cambios el avance aprobado de una actividad suspendida', () => {
  assert.strictEqual(conservarAvanceAprobadoActividadSuspendida(37.5), 37.5);
});

test('calcula el promedio simple sin redondear', () => {
  assert.strictEqual(calcularPromedioAvanceAprobado([40, 80]), 60);
});

test('conserva la precision completa del promedio simple', () => {
  assert.strictEqual(calcularPromedioAvanceAprobado([1, 2, 2]), 5 / 3);
});

test('devuelve No aplica cuando no hay actividades evaluables', () => {
  assert.deepEqual(calcularPromedioAvanceAprobado([]), {
    estado: 'no_aplica',
    explicacion: 'No había actividades evaluables.'
  });
});

test('calcula cobertura de tres aprobados entre cuatro seguimientos vencidos', () => {
  assert.strictEqual(calcularCoberturaTrimestral(3, 4), 75);
});

test('conserva la precision interna de la cobertura sin redondear', () => {
  assert.strictEqual(calcularCoberturaTrimestral(1, 3), (1 / 3) * 100);
});

test('devuelve cero cuando no hay seguimientos aprobados entre cuatro vencidos', () => {
  assert.strictEqual(calcularCoberturaTrimestral(0, 4), 0);
});

test('devuelve No aplica cuando no hay seguimientos que vencieran', () => {
  assert.deepEqual(calcularCoberturaTrimestral(0, 0), {
    estado: 'no_aplica',
    explicacion: 'No hab\u00eda actividades evaluables.'
  });
});

test('combines average and coverage as separate results', () => {
  assert.deepEqual(calcularResumenSeguimientoTrimestral([40, 80], 3, 4), {
    promedioAvance: 60,
    coberturaTrimestral: 75
  });
});

test('preserves No aplica for average while returning calculated coverage', () => {
  assert.deepEqual(calcularResumenSeguimientoTrimestral([], 3, 4), {
    promedioAvance: {
      estado: 'no_aplica',
      explicacion: 'No hab\u00eda actividades evaluables.'
    },
    coberturaTrimestral: 75
  });
});

test('preserves No aplica for coverage while returning calculated average', () => {
  assert.deepEqual(calcularResumenSeguimientoTrimestral([40, 80], 3, 0), {
    promedioAvance: 60,
    coberturaTrimestral: {
      estado: 'no_aplica',
      explicacion: 'No hab\u00eda actividades evaluables.'
    }
  });
});

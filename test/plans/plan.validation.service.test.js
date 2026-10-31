import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validarCamposObligatoriosIndicador,
  validarFechasObligatoriasPlan,
  validarPresenciaResponsablePrincipal,
  validarCamposObligatoriosPlan
} from '../../app/services/plan.validation.service.js';

test('acepta cuando el nombre y la descripcion del indicador estan presentes', () => {
  assert.deepEqual(
    validarCamposObligatoriosIndicador('Indicador', 'Mide el resultado esperado'),
    { valido: true, errores: [] }
  );
});

test('informa cuando el nombre del indicador esta ausente', () => {
  assert.deepEqual(validarCamposObligatoriosIndicador(undefined, 'Descripcion'), {
    valido: false,
    errores: ['El nombre del indicador es obligatorio.']
  });
});

test('informa cuando la descripcion del indicador esta ausente', () => {
  assert.deepEqual(validarCamposObligatoriosIndicador('Indicador', undefined), {
    valido: false,
    errores: ['La descripci\u00f3n del indicador es obligatoria.']
  });
});

test('informa cuando ambos campos obligatorios estan ausentes', () => {
  assert.deepEqual(validarCamposObligatoriosIndicador(undefined, undefined), {
    valido: false,
    errores: [
      'El nombre del indicador es obligatorio.',
      'La descripci\u00f3n del indicador es obligatoria.'
    ]
  });
});

test('informa cuando los valores estan vacios o contienen solo espacios', () => {
  assert.deepEqual(validarCamposObligatoriosIndicador('', '   '), {
    valido: false,
    errores: [
      'El nombre del indicador es obligatorio.',
      'La descripci\u00f3n del indicador es obligatoria.'
    ]
  });
});

test('acepta cuando las fechas de inicio y fin estan presentes', () => {
  assert.deepEqual(validarFechasObligatoriasPlan('inicio', 'fin'), {
    valido: true,
    errores: []
  });
});

test('informa cuando la fecha de inicio esta ausente', () => {
  assert.deepEqual(validarFechasObligatoriasPlan(undefined, 'fin'), {
    valido: false,
    errores: ['La fecha de inicio es obligatoria.']
  });
});

test('informa cuando la fecha de fin esta ausente', () => {
  assert.deepEqual(validarFechasObligatoriasPlan('inicio', undefined), {
    valido: false,
    errores: ['La fecha de fin es obligatoria.']
  });
});

test('informa cuando ambas fechas estan ausentes', () => {
  assert.deepEqual(validarFechasObligatoriasPlan(undefined, undefined), {
    valido: false,
    errores: [
      'La fecha de inicio es obligatoria.',
      'La fecha de fin es obligatoria.'
    ]
  });
});

test('informa cuando los valores de fecha estan vacios', () => {
  assert.deepEqual(validarFechasObligatoriasPlan('', '   '), {
    valido: false,
    errores: [
      'La fecha de inicio es obligatoria.',
      'La fecha de fin es obligatoria.'
    ]
  });
});

test('acepta un valor presente del responsable principal sin inspeccionarlo', () => {
  assert.deepEqual(validarPresenciaResponsablePrincipal(0), {
    valido: true,
    errores: []
  });
});

test('informa cuando el valor del responsable principal esta ausente', () => {
  assert.deepEqual(validarPresenciaResponsablePrincipal(undefined), {
    valido: false,
    errores: ['El responsable principal es obligatorio.']
  });
});

test('informa cuando el valor del responsable principal esta vacio', () => {
  assert.deepEqual(validarPresenciaResponsablePrincipal('   '), {
    valido: false,
    errores: ['El responsable principal es obligatorio.']
  });
});

test('acepta el conjunto completo de campos obligatorios del plan', () => {
  assert.deepEqual(
    validarCamposObligatoriosPlan('Indicador', 'Descripcion', 'inicio', 'fin', 0),
    { valido: true, errores: [] }
  );
});

test('combina errores de varios campos invalidos', () => {
  assert.deepEqual(
    validarCamposObligatoriosPlan(undefined, '   ', 'inicio', undefined, null),
    {
      valido: false,
      errores: [
        'El nombre del indicador es obligatorio.',
        'La descripci\u00f3n del indicador es obligatoria.',
        'La fecha de fin es obligatoria.',
        'El responsable principal es obligatorio.'
      ]
    }
  );
});

test('conserva todos los mensajes de las validaciones existentes', () => {
  assert.deepEqual(validarCamposObligatoriosPlan(), {
    valido: false,
    errores: [
      'El nombre del indicador es obligatorio.',
      'La descripci\u00f3n del indicador es obligatoria.',
      'La fecha de inicio es obligatoria.',
      'La fecha de fin es obligatoria.',
      'El responsable principal es obligatorio.'
    ]
  });
});

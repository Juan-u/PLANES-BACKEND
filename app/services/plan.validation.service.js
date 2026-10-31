const MENSAJE_NOMBRE_REQUERIDO = 'El nombre del indicador es obligatorio.';
const MENSAJE_DESCRIPCION_REQUERIDA = 'La descripci\u00f3n del indicador es obligatoria.';
const MENSAJE_FECHA_INICIO_REQUERIDA = 'La fecha de inicio es obligatoria.';
const MENSAJE_FECHA_FIN_REQUERIDA = 'La fecha de fin es obligatoria.';
const MENSAJE_RESPONSABLE_REQUERIDO = 'El responsable principal es obligatorio.';

/** Valida la presencia del nombre y la descripcion obligatorios del indicador. */
export function validarCamposObligatoriosIndicador(nombre, descripcion) {
  const errores = [];

  if (typeof nombre !== 'string' || nombre.trim().length === 0) {
    errores.push(MENSAJE_NOMBRE_REQUERIDO);
  }

  if (typeof descripcion !== 'string' || descripcion.trim().length === 0) {
    errores.push(MENSAJE_DESCRIPCION_REQUERIDA);
  }

  return {
    valido: errores.length === 0,
    errores
  };
}

/** Valida la presencia de las fechas obligatorias del plan. */
export function validarFechasObligatoriasPlan(fechaInicio, fechaFin) {
  const errores = [];

  if (
    fechaInicio === undefined ||
    fechaInicio === null ||
    (typeof fechaInicio === 'string' && fechaInicio.trim().length === 0)
  ) {
    errores.push(MENSAJE_FECHA_INICIO_REQUERIDA);
  }

  if (
    fechaFin === undefined ||
    fechaFin === null ||
    (typeof fechaFin === 'string' && fechaFin.trim().length === 0)
  ) {
    errores.push(MENSAJE_FECHA_FIN_REQUERIDA);
  }

  return {
    valido: errores.length === 0,
    errores
  };
}

/** Comprueba que se haya proporcionado un valor de responsable. */
export function validarPresenciaResponsablePrincipal(responsablePrincipal) {
  const estaAusente =
    responsablePrincipal === undefined ||
    responsablePrincipal === null ||
    (typeof responsablePrincipal === 'string' && responsablePrincipal.trim().length === 0);

  return {
    valido: !estaAusente,
    errores: estaAusente ? [MENSAJE_RESPONSABLE_REQUERIDO] : []
  };
}

/** Combina las validaciones obligatorias existentes sin agregar reglas. */
export function validarCamposObligatoriosPlan(
  nombreIndicador,
  descripcionIndicador,
  fechaInicio,
  fechaFin,
  responsablePrincipal
) {
  const resultados = [
    validarCamposObligatoriosIndicador(nombreIndicador, descripcionIndicador),
    validarFechasObligatoriasPlan(fechaInicio, fechaFin),
    validarPresenciaResponsablePrincipal(responsablePrincipal)
  ];
  const errores = resultados.flatMap((resultado) => resultado.errores);

  return {
    valido: errores.length === 0,
    errores
  };
}

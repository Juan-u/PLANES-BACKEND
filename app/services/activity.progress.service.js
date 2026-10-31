/**
 * Decides whether a suspended activity is included based on approved follow-up.
 * The input contract is boolean, as defined by the caller.
 */
export function decidirInclusionActividadSuspendida(tieneSeguimientoAprobado) {
  return tieneSeguimientoAprobado ? 'incluida' : 'excluida_pendiente';
}

/** Returns the approved progress of an overdue activity and includes it. */
export function obtenerAvanceActividadVencida(ultimoPorcentajeAprobado) {
  return {
    incluida: true,
    avance: ultimoPorcentajeAprobado
  };
}

/** Returns whether a future activity should be excluded from the quarter. */
export function debeExcluirActividadFuturaDelTrimestre(esFuturaRespectoAlTrimestre) {
  return esFuturaRespectoAlTrimestre;
}

/** Returns the existing approved progress of a suspended activity unchanged. */
export function conservarAvanceAprobadoActividadSuspendida(ultimoPorcentajeAprobado) {
  return ultimoPorcentajeAprobado;
}

/** Calculates the unrounded simple mean of approved, evaluable progress values. */
export function calcularPromedioAvanceAprobado(porcentajesAprobados) {
  if (porcentajesAprobados.length === 0) {
    return {
      estado: 'no_aplica',
      explicacion: 'No había actividades evaluables.'
    };
  }

  const suma = porcentajesAprobados.reduce((total, porcentaje) => total + porcentaje, 0);
  return suma / porcentajesAprobados.length;
}

/** Calculates quarterly coverage separately from the progress average. */
export function calcularCoberturaTrimestral(
  actividadesConSeguimientoAprobado,
  actividadesCuyoSeguimientoVencia
) {
  if (actividadesCuyoSeguimientoVencia === 0) {
    return {
      estado: 'no_aplica',
      explicacion: 'No había actividades evaluables.'
    };
  }

  return (actividadesConSeguimientoAprobado / actividadesCuyoSeguimientoVencia) * 100;
}

/** Combines quarterly progress and coverage without merging their results. */
export function calcularResumenSeguimientoTrimestral(
  porcentajesAprobados,
  actividadesConSeguimientoAprobado,
  actividadesCuyoSeguimientoVencia
) {
  return {
    promedioAvance: calcularPromedioAvanceAprobado(porcentajesAprobados),
    coberturaTrimestral: calcularCoberturaTrimestral(
      actividadesConSeguimientoAprobado,
      actividadesCuyoSeguimientoVencia
    )
  };
}

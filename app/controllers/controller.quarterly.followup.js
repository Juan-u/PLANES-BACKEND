/**
 * Crea un controlador de seguimiento trimestral.
 *
 * prepararDatosPeriodo recibe la solicitud como contexto para identificar el
 * periodo y debe obtener los porcentajes y conteos oficiales desde el servidor.
 * Su resultado debe contener porcentajesAprobados,
 * actividadesConSeguimientoAprobado y actividadesCuyoSeguimientoVencia.
 */
export function crearControladorSeguimientoTrimestral(
  prepararDatosPeriodo,
  generarResumenSeguimientoTrimestral
) {
  return async function controladorSeguimientoTrimestral(req, res) {
    try {
      const datosPeriodo = await prepararDatosPeriodo(req);
      const resumen = await generarResumenSeguimientoTrimestral(
        datosPeriodo.porcentajesAprobados,
        datosPeriodo.actividadesConSeguimientoAprobado,
        datosPeriodo.actividadesCuyoSeguimientoVencia
      );

      return res.json(resumen);
    } catch {
      return res.status(500).json({
        error: 'No fue posible generar el resumen trimestral.'
      });
    }
  };
}

import { calcularResumenSeguimientoTrimestral } from './activity.progress.service.js';

export function generarResumenSeguimientoTrimestral(
  porcentajesAprobados,
  actividadesConSeguimientoAprobado,
  actividadesCuyoSeguimientoVencia
) {
  return calcularResumenSeguimientoTrimestral(
    porcentajesAprobados,
    actividadesConSeguimientoAprobado,
    actividadesCuyoSeguimientoVencia
  );
}

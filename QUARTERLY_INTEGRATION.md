# Bloque E: seguimiento trimestral integrado

Implementado en `develop` y activado localmente el 02/11/2026 exclusivamente en
`127.0.0.1:3307/planes_accion_test`, tras respaldo cifrado y restauración verificada.
Resultado, evidencias y recuperación: [ACTIVACION_LOCAL_BLOQUE_E.md](ACTIVACION_LOCAL_BLOQUE_E.md).

## Funcionalidad

- Consulta integrada de planes, actividades, objetivos e indicadores del Bloque C, períodos, avances y evidencias. Filtros por plan, actividad, año, trimestre y estado, con paginación de actividades e historial.
- Avance trimestral y último avance aprobado general aparecen separados. Los pendientes nunca sustituyen una aprobación. Cero y ausencia de aprobación tienen presentaciones distintas.
- Se reutilizan `activity.progress.service.js` y `quarterly.followup.service.js`, sin modificar sus fórmulas. El denominador conserva la elegibilidad existente: actividades iniciadas y vencidas hasta el final del período, incluidas las pendientes de períodos anteriores. No se inventa un calendario institucional de obligaciones trimestrales.
- Suspendidas y vencidas conservan su último avance aprobado. Una actividad marcada completada sin aprobación de 100 se señala como inconsistente; no se le asigna 100 artificialmente.
- Carga binaria privada de PDF, PNG, JPEG o TXT de hasta 10 MiB, validación de extensión, MIME y contenido, nombres internos aleatorios y metadatos de integridad. La API histórica base64 conserva su límite de 64 KiB. Los archivos no se sirven como contenido público ni se incluyen en Git o imágenes Docker.
- Asociación de evidencia nueva o existente con un seguimiento pendiente de la misma actividad y de un período abierto. La carga no equivale a aprobación. Se conservan autor, fecha, actividad y vínculo.
- Cada nuevo seguimiento conserva una instantánea de su formulación. Los cierres autorizados pueden conservar una versión inmutable de resultados. Los períodos históricos sin versión se identifican como tales; no se fabrica retrospectivamente una instantánea ni una zona horaria para fechas antiguas.
- Solicitudes de reapertura con motivo e identificador idempotente: registran la solicitud, pero no abren el período.

## Seguridad y decisiones institucionales pendientes

Las capacidades RBAC existentes se siguen comprobando en el servidor. La información de planes, actividades y evidencias se limita además a sus respectivas capacidades de consulta. Las comprobaciones transaccionales reutilizan el mecanismo existente de exclusión de cambios de permisos.

Crear/cerrar períodos, decidir seguimientos, reabrir períodos y verificar evidencias institucionalmente quedan bloqueados por defecto, incluso con un permiso general de edición. Los adaptadores internos requieren autoridad explícita y referencia verificable; las rutas de producción no inyectan esa autoridad. No existe bandera del cliente para habilitarla.

La terminación integral es informativa y exige cada avance realmente aprobado en 100 y requisitos de evidencia confirmados y verificados. Sin una definición institucional autorizada de esos requisitos se informa pendiente de verificación. Nunca se aprueba ni se cierra automáticamente un plan. Quedan pendientes las autoridades, la aplicabilidad de evidencias obligatorias y el calendario formal de obligaciones. La fórmula del indicador se presenta como referencia de formulación; no se evalúan expresiones arbitrarias ni se inventa una medición oficial.

## API y presentación

Rutas nuevas del backend, protegidas por autenticación y autorización:

- `GET /seguimiento/integrado`: contexto y resultados integrados.
- `GET /evidencias/opciones`: disponibilidad del esquema y límites de carga.
- `POST /actividades/:id/evidencias`: cuerpo binario limitado a 10 MiB.
- `POST /evidencias/:id/vinculo`: asociación de evidencia existente.
- `POST /periodos/:id/solicitudes-reapertura`: solicitud, sin reapertura efectiva.
- `POST /seguimiento/institucional/:action`: operaciones institucionales cerradas por defecto.

El frontend conserva sesión, JWT del lado servidor y CSRF. La contraseña, tokens y contenido de archivos no se guardan en la recuperación de formularios. Un error de carga conserva la selección y observaciones en el navegador. La vista integrada se utiliza solo cuando el esquema está disponible; de lo contrario se conserva la presentación compatible anterior.

## Migración y recuperación

`migrations/20261103_quarterly_integration.up.sql` añade siete tablas: `seguimiento_formulacion`, `evidencia_carga`, `seguimiento_evidencia`, `evidencia_decision_institucional`, `periodo_reapertura_solicitud`, `periodo_actuacion` y `periodo_resultado_version`. Incluye claves compuestas para impedir asociaciones entre actividades diferentes, 14 disparadores de inmutabilidad y ampliación del límite de metadatos del archivo a 10 MiB. No actualiza registros previos, credenciales, roles ni permisos.

La activación local se completó con autorización expresa. Para otra activación autorizada:

1. Verificar en la conexión efectiva `127.0.0.1:3307/planes_accion_test`, rama y versión de C/D/E. No asumir que el `.env` general apunta al entorno aislado.
2. Crear un respaldo completo nuevo, protegido, de esquema, datos y disparadores. Respaldar también el almacenamiento privado si contiene archivos. Restaurarlo en otra base desechable y comparar estructura, conteos y contenido antes de continuar.
3. Revisar el UP contra el código, registrar una huella de los datos existentes y aplicar únicamente el UP E necesario. Detenerse ante cualquier error de respaldo, destino o integridad.
4. Verificar siete tablas, 14 disparadores, restricciones y conservación de los datos previos. Reiniciar controladamente ambos procesos con la misma configuración aislada verificada, sin editar `.env`.
5. Ejecutar pruebas y consultas HTTP no destructivas. Con una sesión autorizada, abrir Seguimiento y el detalle de Actividades para revisar los controles. No crear datos permanentes como prueba.

El DOWN está preparado, **no ejecutado**. Su primera operación vuelve al límite de 64 KiB y falla si existen metadatos mayores, antes de retirar el historial nuevo. No borrar archivos para forzarla. Cualquier recuperación con datos requiere exportación, respaldo y revisión humana; nunca ejecutar DOWN automáticamente. Conservar los respaldos para una restauración controlada.

## Verificación reproducible

Desde backend: `node --experimental-test-module-mocks --test` (384 aprobadas). Desde frontend, el mismo comando (174 aprobadas).

`node test-db/verify-quarterly-integration.mjs --disposable-3307` verificó 41 condiciones en bases generadas y eliminadas por la herramienta: respaldo completo sintético restaurado antes del UP, conservación de registros previos, integridad, instantáneas de cierre, solicitudes idempotentes, carga real de 10485760 bytes, rechazos por exceso/tipo/asociación/período cerrado y bloqueos institucionales. Las decisiones RBAC de las cuentas sintéticas se simulan; transacciones, claves, archivos y migración se ejecutan realmente. No equivale a probar una sesión autenticada real. No se ejecutaron aprobaciones institucionales. Se comparó el esquema y contenido de la base fuente antes/después: sin cambios ni migración E.

Edge verificó 24 combinaciones de vistas con datos simulados, a 320, 390, 768 y 1440 px y menú abierto/contraído donde corresponde: sin desbordamiento de página, errores JavaScript ni controles sin etiqueta; sin formularios institucionales de aprobación/cierre. Se comprobó conservación del archivo y texto ante un error simulado y se inspeccionaron capturas de escritorio/móvil. Esta etapa no activó la aplicación real ni utilizó credenciales de usuarios.

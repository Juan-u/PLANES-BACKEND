# Activación local del Bloque E

Fecha local: 02/11/2026 (America/Bogota). Rama `develop` en backend y frontend.

## Resultado

Activación completada exclusivamente en `127.0.0.1:3307/planes_accion_test`.
Se aplicó únicamente `migrations/20261103_quarterly_integration.up.sql`, después
de comparar el código, sus huellas y el estado anterior. El UP se ensayó primero
en una restauración desechable del respaldo real. No se ejecutó DOWN.

Las 32 tablas anteriores y sus 171 registros conservan exactamente su contenido.
Las siete tablas nuevas están vacías: total 39 tablas y 171 registros. Se
verificaron 15 nuevas relaciones de clave foránea, los índices y restricciones
mediante comparación completa de definiciones con el ensayo, el límite de
10485760 bytes y 14 nuevos disparadores de inmutabilidad. Las 78 relaciones
de clave foránea de la base no presentan huérfanos. Porcentajes, decisiones,
credenciales, roles, permisos y datos de evidencias anteriores no cambiaron.

## Respaldo cifrado y restauración

Directorio local ignorado por Git: `test-db/activation-blocke.tmp/`.

- `complete-2026-11-03T02-57-27-806Z.sql.dpapi`: respaldo completo de esquema,
  registros, disparadores, rutinas y eventos, cifrado con Windows DPAPI CurrentUser.
- `evidence-2026-11-03T02-57-27-806Z.json.dpapi`: archivo cifrado del almacenamiento
  privado; se encontraron cero archivos físicos en ese directorio.
- `activation-2026-11-03T02-57-27-806Z.json`: manifiesto de versiones, definiciones,
  conteos, huellas y pasos completados. Contiene metadatos técnicos; no credenciales.

Se descifraron ambos archivos en memoria para verificar su contenido. El SQL se
restauró en otra base temporal del mismo servidor aislado; se compararon todas las
definiciones y registros con el origen antes de ensayar el UP. La base temporal se
eliminó al finalizar; los respaldos cifrados se conservaron. DPAPI requiere la
cuenta y perfil Windows que los generó; conservarlos para la recuperación.

## Servicios y comprobaciones

Se verificaron imagen, directorio, comando y configuración de ambos procesos antes
de reiniciarlos, copiando sus entornos efectivos en memoria. No se modificó `.env`.

- Backend: PID 40988, puerto 3000; conexión aislada comprobada tras el reinicio.
- Frontend: PID 20728, puerto 4000; entorno anterior conservado.
- Backend: 384 pruebas aprobadas. Frontend: 174 pruebas aprobadas.
- 19 comprobaciones HTTP no destructivas: inicio y recursos públicos disponibles;
  rutas de C/D/E protegidas por autenticación, redirecciones frontend correctas.
- Lectura de planes, actividades y catálogo C, consulta de expediente/bandeja D y
  contexto integrado E con las capacidades reales de la cuenta de revisión ya
  existente, sin crear una sesión HTTP ni generar tokens. Plantillas EJS de C/D/E
  renderizadas con los datos actuales. El límite binario disponible es 10 MiB.
- Diez actuaciones institucionales rechazadas usando fábricas de producción y una
  conexión que impide DML: presentar/recibir/observar/devolver/aprobar planes,
  abrir/cerrar períodos, decidir seguimiento, reabrir y verificar evidencia.

Las pruebas no guardaron formularios, crearon registros permanentes ni aprobaron
resultados. No se instalaron dependencias ni hubo commit, push, merge o despliegue.
Evidencias técnicas locales: `verification.json`, `http-verification.json`,
`integrity.json` y `processes.json`, dentro del directorio ignorado anterior.

## Revisión por el usuario

Abrir `http://localhost:4000`, iniciar sesión mediante el acceso normal con una
cuenta de pruebas autorizada y entrar a Seguimiento (`/seguimiento`). Planes
(`/planes`) y Actividades (`/actividades`) conservan C/D; el detalle de actividad
ofrece contexto trimestral y carga privada cuando sus permisos lo permiten.
Sin períodos disponibles, E muestra el estado vacío; no se crearon períodos para
demostrar la interfaz. La prueba autenticada de navegador queda para esa sesión
del usuario; no se conocen ni modificaron sus credenciales.

Las aprobaciones de seguimiento/evidencia, apertura/cierre y reapertura de períodos,
así como aprobación, recepción y devolución institucional de planes permanecen
bloqueadas en backend mientras no haya autoridades formalmente configuradas.
Una solicitud de reapertura no abre el período y una carga no aprueba evidencia.

## Recuperación controlada

No ejecutar DOWN automáticamente ni volver a ejecutar la herramienta de activación:
rechaza un esquema ya migrado. Ante un incidente, conservar los respaldos y el
estado actual, detener escrituras mediante un procedimiento autorizado y generar
otro respaldo antes de recuperar. Descifrar el respaldo solo con el perfil Windows
original, restaurarlo primero en una base desechable de `127.0.0.1:3307` y verificar
esquema, conteos y contenido contra el manifiesto. Una restauración sobre la base
de trabajo requiere revisión y autorización específica: sobrescribirla perdería
datos nuevos. Revisar también cualquier evidencia física posterior a este respaldo.
Nunca apuntar la recuperación a una base comercial o producción. El DOWN preparado
no sustituye un respaldo ni garantiza conservar el historial E.

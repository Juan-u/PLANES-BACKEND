# Bloque I — migración persistente autorizada y completada

Actualización J (03/11/2026): la comprobación de sesión pendiente en I se realizó
de forma guiada; el propietario confirmó que abren todos sus módulos permitidos.
No hubo observación automática ni captura de credenciales. Véase la sección J de
`../proyecto fronted erick/REVISION_VISUAL.md`. La utilidad de ensayo se llama ahora
`verify-focused.mjs`, para evitar su descubrimiento accidental por la suite normal.

Fecha: 03/11/2026, America/Bogota. Rama `develop` en ambos repositorios.

## Autorización, destino y resultado

Se ejecutó la autorización expresa posterior a la preparación I, limitada a
`migrations/20261104_reports_control.up.sql` sobre
**`127.0.0.1:3307/planes_accion_test`**. Se aplicaron sus ocho sentencias sin errores;
no se ejecutaron otras migraciones, DOWN ni restauraciones sobre la fuente.

Antes: 39 tablas, 171 registros y 78 relaciones FK sin huérfanos. Después: **43
tablas, los mismos 171 registros y 86 relaciones FK sin huérfanos**. Las cuatro
tablas F están vacías; sus ocho relaciones y cuatro disparadores están disponibles.
Definiciones completas e integridad coinciden con el ensayo restaurado. Todos los
contenidos originales se compararon antes/después, incluidos usuarios, credenciales,
roles, permisos, porcentajes, evidencias e historial: sin modificaciones.

El UP coincide con H y la preparación I. También se compararon las huellas de los
archivos registrados en el ensayo. La autorización se registra en el manifiesto;
el preparador original I sigue rechazando migraciones a la fuente.

## Respaldos comprobados

Se descifró y restauró otra vez el respaldo exigido
`test-db/activation-blocki.tmp/complete-2026-11-03T14-25-02-365Z.sql.dpapi` y se
comparó con su manifiesto: íntegro y restaurable.

Inmediatamente antes de migrar se creó otro respaldo completo nuevo, cifrado con
DPAPI CurrentUser, sin sobrescribir los anteriores:

- `test-db/activation-blocki-apply.tmp/complete-2026-11-03T14-44-43-973Z.sql.dpapi`.
- `evidence-2026-11-03T14-44-43-973Z.json.dpapi`, en el mismo directorio: respaldo
  del almacenamiento privado, que contenía cero archivos físicos en el origen.
- `activation-2026-11-03T14-44-43-973Z.json`: manifiesto con ocho sentencias
  aplicadas, restauración anterior/nueva, comparación de datos e integridad final.

El respaldo nuevo se restauró en otra base desechable; se compararon esquema,
registros, disparadores, rutinas y eventos. El UP se ensayó allí antes de aplicarlo
al destino. Antes de la escritura se volvió a comprobar que la fuente y el código
no habían cambiado. Las copias de restauración se eliminaron; los respaldos siguen
conservados. DPAPI necesita el perfil Windows original para recuperarlos.

## Procesos y disponibilidad

El reinicio de los dos procesos fue necesario para cargar las rutas F/G/H aún
ausentes en los procesos antiguos. Se verificaron comando/directorio/entorno y se
conservaron íntegramente sus variables, sin editar `.env`:

- Backend: PID anterior 40988, actual **81776**, puerto **3000**.
- Frontend: PID anterior 20728, actual **27328**, puerto **4000**.
- Conexión efectiva posterior: `127.0.0.1:3307/planes_accion_test`, usuario existente
  `planes_test`; no se sustituyó por root ni por la configuración de los ensayos.

El reinicio renueva el almacenamiento de sesiones en memoria: volver a iniciar
sesión normalmente si la sesión previa terminó. No se cambió ninguna credencial.

## Pruebas realizadas y límites

**En el destino persistente:** consulta de informes y consulta CI con autorización
real del repositorio RBAC para la cuenta de revisión existente; conexión limitada
a SELECT, que rechaza DML. Es una comprobación interna de autorización/consulta,
**no una sesión web autenticada**. Se confirmó disponibilidad de exportación por
esquema y mantenimiento de `writeEnabled:false` para CI. Se comparó otra vez cada
tabla contra el manifiesto posterior: 171 registros intactos, tablas F vacías.

Seis comprobaciones HTTP: inicio de backend/frontend disponible; informes/CI API
sin JWT devuelven 401; informes/CI frontend sin sesión redirigen 302. Procesos y
conexión efectivos posteriores verificados.

**31 comprobaciones autenticadas reales en una réplica idéntica:** se restauró el
respaldo nuevo y se aplicó el mismo UP; antes de las fixtures, su estructura y
datos coincidieron exactamente con la fuente migrada. Instancias paralelas
3010/4010, scrypt y login normal, sin fabricar JWT:

- Sesiones de cuenta sintética amplia y cuenta sintética restringida, con relaciones
  de autorización de prueba completas para roles existentes, siguiendo la fixture H.
  Ninguna definición de permiso se cambió, y ningún usuario original se utilizó.
- Informes consultables, exportación CSV autorizada vía BFF y CSRF, página privada
  de impresión y PDF real generado por Edge exclusivamente en memoria.
- Consulta CI, interfaz con bloqueo explícito y rechazo de lectura/exportación a
  la cuenta restringida. Escritura CI, publicación y verificación institucional
  de evidencia rechazadas con 403.
- Logout normal, cero excepciones JavaScript y conservación de todos los registros
  originales de la copia.

Las fixtures y las anotaciones legítimas de generación de exportaciones existieron
solo en esa réplica. No se crearon usuarios, asignaciones, informes ni datos de prueba
en la fuente persistente. Réplica, perfil de navegador, procesos auxiliares y archivos
sintéticos retirados al terminar; solo siguen los servicios originales 3000/4000.

**No ejecutado:** login web con una cuenta existente sobre 4000, por no disponer de
sus credenciales. No se extrajeron sesiones, se inventaron tokens ni se restablecieron
contraseñas para ello. La comprobación queda para el acceso normal del usuario.
No se repitieron las 612 pruebas históricas ni la matriz visual: no hubo cambios
de código funcional en esta activación. Los 31 resultados son nuevos y no se
presentan como pruebas autenticadas sobre la fuente.

## Restricciones, recuperación y pendientes

Aprobaciones de planes/seguimientos/evidencias, recepción/devolución, cierre y
reapertura, publicación oficial y escrituras CI pendientes de autoridad conservan
sus bloqueos. La migración no concede permisos ni autoridad institucional.

No hubo fallos durante el UP. Ante un incidente posterior: conservar estado y
evidencia, detener nuevas operaciones que lo agraven y respaldar el estado actual.
Descifrar/restaurar primero en una copia aislada y comparar con el manifiesto.
Solicitar autorización específica antes de sobrescribir la fuente o ejecutar
recuperación destructiva. **No ejecutar DOWN ni restaurar automáticamente**:
el DDL no proporciona rollback atómico y podría haber información nueva desde
este respaldo.

Revisión disponible mediante acceso normal en
`http://localhost:4000/informes/institucional` y
`http://localhost:4000/control-interno`, con las capacidades existentes. CSV/PDF
registrarán una generación legítima en F; no son operaciones de solo lectura.

## Evidencia y archivos

En el directorio ignorado `test-db/activation-blocki-apply.tmp/`: `apply.mjs`,
manifiesto/respaldos citados, `restart.py`, `processes.json`, `auth-focus.mjs`,
`verify-focused.mjs`, manifiesto del ensayo autenticado y
`persistent-verification.json`. La herramienta de aplicación no debe repetirse
sobre un esquema ya migrado; detiene la ejecución si las tablas F ya existen.

Documentación actualizada: este informe, `PREPARACION_ACTIVACION_BLOQUE_I.md`,
`INSTITUTIONAL_REPORTS.md` y `../proyecto fronted erick/REVISION_VISUAL.md`.
Sin cambios de código funcional, credenciales, permisos, cálculos o datos comerciales;
sin dependencias, despliegues, push ni merge.

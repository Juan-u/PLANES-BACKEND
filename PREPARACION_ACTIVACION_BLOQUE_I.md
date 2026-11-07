# Bloque I — preparación terminada; autorización persistente pendiente

**Actualización posterior:** se recibió autorización expresa y se completó la
migración el 03/11/2026, con verificación nueva de ambos respaldos y conservación
de los 171 registros. El contenido siguiente conserva el estado de preparación.
Resultado vigente: [ACTIVACION_PERSISTENTE_BLOQUE_I.md](ACTIVACION_PERSISTENTE_BLOQUE_I.md).

Fecha: 03/11/2026, America/Bogota. Ambos repositorios permanecen en `develop`.

## Destino y estado comprobados

Destino de la futura migración: **`127.0.0.1:3307/planes_accion_test`**.
La configuración efectiva del proceso backend coincide con ese destino y utiliza
`planes_test`. Backend PID 40988/3000 y frontend PID 20728/4000 permanecen activos;
no se detuvieron ni reiniciaron. No se editó `.env`.

Antes y después de la preparación: **39 tablas y 171 registros**, sin cambios en
contenido ni definiciones, disparadores, rutinas o eventos. Se verificaron **78
relaciones FK, sin huérfanos**. No se modificaron credenciales, usuarios, permisos,
roles, porcentajes, registros comerciales ni historial institucional.

## Migración concreta preparada

Únicamente `migrations/20261104_reports_control.up.sql`: cuatro tablas nuevas
(`control_hallazgo`, `control_recomendacion`, `control_evento`,
`informe_generacion`), ocho FK, restricciones de estado y cuatro disparadores
append-only. No contiene actualizaciones de datos anteriores ni cambios de permisos.

La huella del UP coincide exactamente con el manifiesto exitoso del ensayo H
`activation-2026-11-03T13-38-38-642Z.json`. También coinciden las huellas de los
archivos de código que dicho manifiesto registró. Se revisó el DOWN: solo retira
estructuras F y no se ejecutó; no es una recuperación automática segura con datos.

## Respaldo nuevo restaurable

Directorio protegido e ignorado por Git: `test-db/activation-blocki.tmp/`.

- `complete-2026-11-03T14-25-02-365Z.sql.dpapi`: SQL completo cifrado con Windows
  DPAPI CurrentUser, incluidos datos, estructura, disparadores, rutinas y eventos.
- `evidence-2026-11-03T14-25-02-365Z.json.dpapi`: respaldo cifrado del almacenamiento
  privado verificado; cero archivos físicos encontrados en el origen.
- `activation-2026-11-03T14-25-02-365Z.json`: manifiesto de preparación, huellas,
  comparación de integridad y autorización pendiente.
- `http-continuity.json`: resultados de continuidad de los procesos actuales.

No se sobrescribieron respaldos anteriores. Se descifraron los nuevos en memoria
para comprobar integridad. El SQL completo se restauró en una base desechable y
se compararon todas las estructuras y registros con el origen antes del ensayo.

Después se aplicó el UP solo a esa restauración: **43 tablas, los mismos 171
registros y 86 relaciones FK sin huérfanos**. Las cuatro tablas F quedaron vacías;
se verificaron las cuatro nuevas definiciones de disparador y la disponibilidad
del esquema mediante el servicio existente. La copia fue eliminada al terminar;
el manifiesto confirma `restoreCloneRemoved: true`. Respaldo y resultados quedan
conservados y disponibles para revisión.

## Actividades y pruebas de esta etapa

- Preparación real ejecutada: nuevo respaldo cifrado, descifrado, restauración,
  comparación completa, ensayo del UP, verificación FK y nueva comparación de la
  fuente sin modificaciones. No se crearon datos funcionales de prueba en I.
- Cuatro comprobaciones HTTP no destructivas: inicio backend/frontend disponibles,
  API de planes sin JWT devuelve 401 y planes frontend sin sesión redirige 302.
- Comprobación de rama y `git diff --check`; sin errores de espacios, con avisos
  preexistentes de normalización CRLF. Sintaxis del preparador comprobada.
- No se repitieron las 612 pruebas automatizadas ni las 59 autenticadas de H:
  no hubo cambios en código funcional durante I. Esos resultados son antecedentes,
  no pruebas nuevas de esta preparación. Tampoco se repitió la matriz visual G.
- Las pruebas autenticadas y operaciones sobre una instancia persistentemente
  migrada **no se ejecutaron**, porque falta la autorización específica.

No aparecieron incompatibilidades nuevas que justificaran modificar código. Se
preparó la utilidad local ignorada `test-db/activation-blocki.tmp/prepare.mjs`;
**rechaza expresamente aplicar SQL de migración a cualquier destino distinto de
su copia desechable**. Ejecutarla no autoriza ni realiza la migración persistente.

## Punto de autorización

La autorización requerida es exclusivamente para aplicar el UP F señalado a
**`127.0.0.1:3307/planes_accion_test`**. No se interpreta la solicitud I como dicha
autorización. Tras recibirla, primero se comparará nuevamente la fuente y el UP
con este manifiesto. Si cambió algo, se detendrá la ejecución y se renovará el
respaldo/ensayo del estado actual antes de aplicar.

Después de autorizar y aplicar: verificar cuatro tablas, ocho relaciones y cuatro
disparadores, comparar cada registro anterior, conservar cerradas las actuaciones
institucionales y seguir las validaciones posteriores de I. Los procesos aún
cargan la versión previa al ensayo H; un reinicio controlado debe conservar sus
entornos efectivos, nunca los secretos/base/root de las instancias desechables.

Las pruebas que creen usuarios, asignaciones, planes o seguimientos deben continuar
en copias desechables. La verificación persistente inicial será de consulta con
cuenta autorizada. CSV/PDF registran generación en F: distinguir ese registro
legítimo de una prueba de solo lectura y no introducir fixtures persistentes para
demostrar la interfaz.

## Riesgos residuales y recuperación

El UP es aditivo, pero MySQL/MariaDB ejecuta DDL con confirmaciones implícitas: un
fallo intermedio puede dejar la migración parcial y puede haber bloqueos de esquema.
No existe garantía de rollback transaccional del conjunto. Debe comprobarse además
que el origen no cambió entre respaldo y aplicación; no activar sobre un estado
diferente del verificado. DPAPI requiere el perfil Windows original: conservar el
perfil y estos archivos; no son un respaldo portable a otra cuenta sin un mecanismo
adicional autorizado de recuperación.

Si se detecta fallo crítico: detener nuevas operaciones que lo agraven, conservar
el estado parcial y sus registros, crear otro respaldo antes de recuperar y
restaurar el respaldo I primero en otra base desechable. Descifrar solo en memoria
con el perfil original y comparar con el manifiesto. Revisar datos/evidencias
posteriores a este respaldo. **Solicitar autorización específica antes de
sobrescribir la base persistente o ejecutar una recuperación destructiva.**
Nunca ejecutar DOWN automáticamente ni borrar información nueva para forzarlo.

El procedimiento operativo detallado del cliente SQL y posterior reinicio sigue en
`VALIDACION_OPERATIVA_BLOQUE_H.md`, sección de activación persistente pendiente.
No se ejecutó en I. Aprobaciones, cierre/reapertura, publicación y escrituras CI
sin autoridad continúan bloqueadas independientemente de que se aplique F.

## Archivos y siguiente bloque

Documentación actualizada: este informe, `INSTITUTIONAL_REPORTS.md` y
`../proyecto fronted erick/REVISION_VISUAL.md`. Utilidad y artefactos nuevos solo
en el directorio ignorado indicado; sin modificaciones de código funcional,
dependencias, commits, push, merge o despliegues.

Estado I: **preparación completa; ejecución persistente pendiente de autorización**.
Siguiente paso: autorización expresa del destino y UP indicados; a continuación,
aplicación controlada, revisión de integridad y consolidación autenticada sin
contaminar registros institucionales.

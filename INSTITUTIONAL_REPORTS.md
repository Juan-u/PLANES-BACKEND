# Bloque F — Informes y Control Interno

## Verificación Docker final y entrega — 03/11/2026

Ambas imágenes construidas y ejecutadas en proyecto aislado con base sintética,
puertos 3015/4015, 43 tablas/86 FK/20 disparadores y 44 comprobaciones aprobadas.
Autenticación real, rutas principales, evidencia privada, informes/CSV/impresión
y bloqueos verificados. Respaldo sintético Windows→Linux, restauración de SQL con
checksums de 43 tablas y prueba complementaria SQL+archivo correctos; rechazo de
clave incorrecta/manipulación. Ningún respaldo institucional fue descifrado.

Base persistente no utilizada ni consultada; procesos originales 3000/4000 y
recursos preexistentes preservados. Recursos de datos del ensayo retirados;
imágenes base y caché de construcción conservadas sin prune. No se repitieron suites históricas.
Procedimiento y evidencia actualizados en `GUIA_INSTALACION.md` y
`OPERACION_Y_RECUPERACION.md`. `LISTA_ENTREGA_OPERATIVA.md` usa los estados
Verificado/Pendiente/Requiere autorización y distingue preparación técnica de
aceptación institucional y producción, que siguen sin declararse.

## Bloque K — cierre técnico y preparación operativa

03/11/2026: resuelta instalación limpia de dependencias en copias offline,
plantillas sin secretos, inicio local explícito, Dockerfiles por `npm ci` y Compose
con destino/secretos obligatorios y API interna del BFF. Configuración Docker
validada, sin construir ni iniciar servicios. Nuevo comprobador de disponibilidad
sin autenticación/escrituras; cinco pruebas propias y cuatro regresiones aprobadas,
además de seis comprobaciones HTTP reales.

Baseline sin datos/cuentas instalado y verificado solo en una base desechable:
43 tablas, 86 relaciones, 20 disparadores y cero registros. Fuente comparada antes
y después, intacta con 171 registros. No hubo migraciones persistentes ni respaldos
completos adicionales. No se repitieron suites/visuales de J ni se cambiaron reglas,
permisos, credenciales o autoridades. Guías y límites en `README.md`,
`GUIA_INSTALACION.md`, `OPERACION_Y_RECUPERACION.md` y `LISTA_ENTREGA_OPERATIVA.md`.

Pendientes externos: custodia/retención/recuperación portable, responsables de
operación, aprovisionamiento inicial autorizado de una organización y aceptación
formal. Producción y prueba completa Docker requieren otro entorno autorizado;
no se declaran aprobadas. Siguiente bloque recomendado: cerrar esas condiciones
de entrega y ensayar el paquete completo en una instalación separada.

## Bloque J — consolidación final local

03/11/2026: estados y actuaciones en español mediante parcial reutilizable;
descarga privada de evidencias desde la consulta autorizada, sin enlaces en la
impresión; contexto plan/actividad y fechas UTC accesibles en CI. El informe
histórico y su CSV ahora rechazan trimestre fuera de 1–4 antes de consultar datos.
Sin cambios en fórmulas, permisos o autoridades institucionales.

617 pruebas automatizadas y 24 configuraciones visuales focalizadas aprobadas.
El propietario confirmó por comprobación guiada que su sesión real abre todos
los módulos permitidos; no se observaron sus credenciales ni su navegador.
Base persistente intacta: 43 tablas/171 registros/86 relaciones. Backend reiniciado
solo para cargar la corrección, conservando entorno; frontend y sesión sin reiniciar.
La utilidad temporal I fue renombrada a `verify-focused.mjs` para que la suite normal
no la ejecute como prueba automática. Sin migraciones ni fixtures persistentes.
Archivos/evidencia en la sección J de `../proyecto fronted erick/REVISION_VISUAL.md`.
Preparación para entrega y pendientes: [LISTA_ENTREGA_OPERATIVA.md](LISTA_ENTREGA_OPERATIVA.md).

## Activación persistente I — completada con autorización expresa

03/11/2026: UP F aplicado únicamente a `127.0.0.1:3307/planes_accion_test`, tras
restaurar el respaldo requerido y otro nuevo inmediato. Base: 43 tablas, 171
registros originales intactos y 86 relaciones sin huérfanos; cuatro tablas F
vacías, ocho FK y cuatro disparadores nuevos. Reinicio necesario conservando
entornos en 3000/4000. Lecturas RBAC reales sobre el destino, seis comprobaciones
HTTP y 31 autenticadas en réplica idéntica aprobadas. Login de cuenta existente
en el destino no ejecutado, sin credenciales disponibles; no se modificó ninguna.
Autoridades institucionales siguen cerradas. Resultado y recuperación:
[ACTIVACION_PERSISTENTE_BLOQUE_I.md](ACTIVACION_PERSISTENTE_BLOQUE_I.md).

Las secciones de preparación siguientes son antecedentes, no el estado vigente.

## Bloque I — listo para autorización, no migrado

03/11/2026: respaldo completo nuevo DPAPI restaurado y comparado; UP F y código
registrado coinciden con H. Ensayo de cuatro tablas, ocho FK y cuatro disparadores
solo en la copia (43 tablas/171 registros, 86 relaciones sin huérfanos). Fuente
intacta: 39 tablas/171 registros, 78 relaciones sin huérfanos. Cuatro comprobaciones
HTTP de continuidad correctas. No se repitieron pruebas históricas sin cambios.
Autorización persistente pendiente; procesos originales sin reiniciar.
Destino, respaldo, riesgos y recuperación en
[PREPARACION_ACTIVACION_BLOQUE_I.md](PREPARACION_ACTIVACION_BLOQUE_I.md).

## Bloque H — ensayo autenticado completado, sin activación persistente

El 03/11/2026 se verificó un respaldo completo cifrado mediante restauración real,
se aplicó UP F solo a la copia y se ejecutaron 59 comprobaciones operativas con
sesiones reales en 3010/4010. Fuente intacta: 39 tablas y 171 registros. Se corrigió
la dirección fija de verificación de sesión para usar el backend configurado;
puertos/URL admiten instancias paralelas, sin cambios al mecanismo de seguridad.
612 pruebas automatizadas aprobadas. Procesos originales sin reiniciar; autoridades
institucionales cerradas. Informe, límites y procedimiento exacto de activación
pendiente en [VALIDACION_OPERATIVA_BLOQUE_H.md](VALIDACION_OPERATIVA_BLOQUE_H.md).

## Consolidación del Bloque G — 03/11/2026

El código permanece en `develop`, sin activar F ni reiniciar los procesos locales.
Se corrigieron filtros, navegación y disponibilidad; no cambian los cálculos ni
las reglas institucionales de este documento.

- El BFF rechaza filtros conocidos duplicados, mal formados o demasiado largos
  antes de consultar/exportar. Antes los descartaba y podía ampliar silenciosamente
  el alcance. El backend rechaza además listas en año/trimestre y estados de plan
  no reconocidos. Los parámetros siguen siendo consultas SQL parametrizadas.
- El detalle por actividad conserva todos los filtros y su ruta de origen de
  Informes o Control Interno. Las consultas relacionadas entre detalle de actividad,
  seguimiento, informes y contexto CI trasladan plan/actividad/período y respetan
  las capacidades verificadas; no se añaden permisos ni se evita la autorización
  del backend. No se ofrecen enlaces redundantes a la misma consulta.
- `meta.exportReady` indica si las cuatro tablas, ocho relaciones y cuatro
  disparadores de F están disponibles. Sin ellos se conserva la consulta compatible
  y se informa por qué no se ofrecen CSV/PDF; nunca se activa una migración desde
  la vista. Las exportaciones mantienen su revalidación y registro transaccional.
- Nueva pantalla de error accesible con filtros editables conservados, estados HTTP
  400/404/409/422/503 y vuelta al módulo. Se mantiene el rechazo previo de sesión y
  permisos, sin reintentos automáticos de escrituras. Los valores se escapan.
- Control Interno conserva su menú activo y `aria-current` en su consulta de contexto.
  Las consultas GET anuncian carga y recuperan los controles al volver por historial;
  el comportamiento no se aplica a descargas ni altera envíos institucionales.

Archivos de G: backend `app/services/institutional-report.rules.js`,
`app/services/institutional-report.service.js`, `test/plans/institutional-reports.test.js`
y `test-db/verify-reports-control.mjs`. Frontend
`app/controllers/institutional-reports.views.js`, nuevo `report-navigation.js`,
`views/informe-institucional.ejs`, nuevo `views/report-error.ejs`, nuevo parcial
`views/partials/related-views.ejs`, `views/partials/navigation.ejs`,
`views/actividad-detalle.ejs`, `views/seguimiento-integrado.ejs`, `public/app.js`,
`public/style.css`, `test/institutional-reports.test.js` y nuevo
`test/report-integration.test.js`. Documentación actualizada aquí, en
`REVISION_VISUAL.md` y `ARQUITECTURA.md`.

Resultados G: 417 pruebas backend y 191 frontend aprobadas (608 total); incluidas
regresiones por navegación, script compartido y permisos. La verificación desechable
añade disponibilidad previa/posterior al UP: 74 comprobaciones aprobadas, respaldo
sintético restaurado, comparación completa de la fuente sin cambios (39 tablas y
171 registros). No se aplicó F a la fuente ni se ejecutó DOWN. Edge: 24 combinaciones
de informe, impresión, contexto CI y recuperación de errores a 320/390/768/1440 px,
menú abierto/contraído; sin desbordamiento de página ni errores JS, etiquetas y
PDF sintético comprobados. Capturas de escritorio y móvil inspeccionadas.
No equivale a una sesión autenticada real en la aplicación activa.

Pendiente: activación local F con respaldo nuevo verificado y autorización expresa;
escrituras CI y publicación oficial siguen bloqueadas conforme al diseño vigente.
Siguiente bloque recomendado: activación controlada y prueba autenticada de extremo
a extremo con las cuentas y capacidades autorizadas, sin cambiar permisos para
demostrar la interfaz. El procedimiento de activación al final sigue siendo válido.

Estado: implementado en `develop`, probado en bases desechables y preparado para
activación. **No migrado a `planes_accion_test` ni cargado mediante reinicio de los
procesos locales.** C/D/E y sus 39 tablas/171 registros permanecen intactos.

## Informes implementados

Consulta y detalle combinables por plan, proceso institucional, responsable
(coincidencia exacta de actividad o responsable principal), objetivo específico,
actividad, período, año, trimestre, estado del expediente D y estado de seguimiento.
Los planes sin expediente se distinguen como `sin_expediente`, sin tratarlos como
aprobados. La consulta se basa en actividades; un plan sin actividades no genera
filas de resultados ni un porcentaje.

Incluye actividades exigibles/programadas, aprobadas, sin aprobación, pendientes
de decisión, avance y cobertura por trimestre; referencias de objetivo e indicador,
seguimientos, observaciones de Planeación, metadatos de evidencias y actuaciones
del expediente del plan. El enlace de actividad ofrece detalle con esos filtros.
Las observaciones de Control Interno permanecen en su expediente independiente.

Se reutilizan `officialSummary`/`progress` del Bloque E y los servicios oficiales
`quarterly.followup.service.js` y `activity.progress.service.js`, sin modificarlos.
Cada período mantiene su propio resultado; no se promedian trimestres entre sí.
Cero aprobado se conserva; un pendiente no recibe cero ni integra el promedio.
Las instantáneas E de períodos cerrados prevalecen sobre fechas/resultados actuales.
Los filtros de ámbito delimitan el denominador; el filtro de estado de seguimiento
solo delimita el detalle, como indica la pantalla. La elegibilidad conserva el
criterio vigente de fechas hasta fin del período, incluidas obligaciones anteriores.
No se inventa otro calendario de programación ni se evalúa una fórmula de texto.

La clasificación del informe es **analítico**. Cada seguimiento distingue aprobado,
pendiente/provisional y rechazado. Usar datos aprobados no convierte el documento
en publicación oficial. Sin períodos/resultados suficientes aparece Información no
disponible; el denominador cero mantiene el No aplica del servicio oficial.

## Exportaciones y autenticidad

- CSV UTF-8 con BOM, columnas de actividad/seguimiento/evidencia/actuación,
  indicadores, identidad, filtros, carácter y metadatos adicionales. Escapa comillas
  y neutraliza prefijos de fórmulas de hoja de cálculo.
- Vista de impresión autorizada y auditada, con estilos A4 horizontal. El usuario
  selecciona **Guardar como PDF** en el diálogo del navegador. No hay un generador
  PDF binario de servidor, dependencia nueva ni ejecución del navegador por endpoint.
  Edge produjo un PDF real de prueba usando la misma vista con datos sintéticos.
- Generación con UUID, hora ISO (presentada en Colombia), usuario ID, filtros y
  SHA256 del contenido. El hash verifica contenido, no es firma institucional.
  Sin configuración autorizada del nombre institucional se indica Institución no
  configurada; no se inventa la identidad de una entidad. El nombre institucional
  se admite como dependencia interna de composición, no como parámetro del cliente.
- La exportación revalida los mismos permisos y filtros; no reutiliza un informe
  de sesión obsoleto. Registra la generación en transacción, antes de devolverla.
  El registro acredita generación autorizada; no acredita entrega al destinatario
  ni que el usuario terminó de guardar el archivo. No se almacenan archivos finales.
- Respuestas privadas sin caché. No se exportan rutas físicas, hashes de contraseña,
  tokens, correos de cuentas ni contenido binario de evidencias.

Las consultas completas se limitan a 500 actividades, 20 períodos y 2000 registros
de cada conjunto de seguimientos, evidencias e historial. Si se excede un límite se
rechaza con 422 y se solicitan filtros: nunca se presenta una suma parcial como total.

## Control Interno

Consulta independiente de planes/actividades/seguimientos/evidencias autorizados,
lista de hallazgos paginada, detalle, observaciones, recomendaciones, respuestas,
estados administrativos de atención e historial inmutable.

Persistencia implementada para crear hallazgo, recomendar, actualizar observación/
atención y responder recomendaciones. Exige permisos vigentes y un adaptador de
autoridad institucional explícito del servidor, **cerrado por defecto**. Las rutas
de producción no inyectan el adaptador y la interfaz muestra el bloqueo. Parámetros
como `authority` no habilitan nada. El código de escritura fue probado con un
adaptador exclusivamente sintético en bases desechables; no es solo una maqueta.

Estados administrativos preparados: hallazgo registrado/en atención/atendido y
recomendación pendiente/en atención/atendida. No constituyen aprobación de planes,
cierre institucional de hallazgos ni evaluación de eficacia. Su uso real queda
supeditado a confirmar competencias y política institucional. El control optimista
de revisión impide sobrescrituras concurrentes; plan/actividad se validan juntos;
cada cambio y referencia de autoridad se registran en la misma transacción.
No hay eliminación ni transición sobre planes o seguimientos.

## Autorización

Servicios con JWT, cuenta activa, transacciones y exclusión RBAC existentes:

- Informe: `M12.reports.read` + `M03.plans.read` + `M04.activities.read` +
  `M05.followup.read`.
- Exportar: los anteriores + `M12.reports.export`.
- Evidencias: se omiten sin `M13.evidence.read`, también al exportar.
- Control Interno y su contexto: `M15.audit.read` + lecturas M03/M04/M05;
  no presupone que una cuenta con consulta de auditoría pueda conocer todos los
  datos de negocio. El contexto no exige ni concede permisos de Informes.
- Escrituras CI futuras: lecturas anteriores + `M09.corrective.create` o `.update`
  y autoridad institucional explícita. **Esas capacidades existentes son necesarias,
  pero no suficientes; no se afirma que definan por sí solas la competencia CI.**

Se usan únicamente concesiones globales vigentes (`scopeRef:null`), siguiendo el
modelo de C/D/E. Concesiones exclusivamente por ámbito no se amplían a acceso
global; se deniegan hasta implementar una política formal de filtrado por ámbito.
No se añadieron permisos ni se asignaron roles a ninguna cuenta real. Las pruebas
de permisos reales emplean asignaciones nuevas solo en la base desechable.

El frontend conserva sesión y token del lado servidor y usa CSRF en exportaciones
y actuaciones. Las rutas institucionales no pueden publicar, aprobar ni cambiar
Planeación. Publicar informes oficiales está bloqueado; validación, firma,
versionado institucional, programación y correcciones oficiales requieren reglas
y autoridades posteriores. No se implementan por inferencia del rol del usuario.

## Rutas

Backend bajo `/api`:

- GET `/informes/institucional`, `/informes/institucional/export.csv` y
  `/informes/institucional/impresion` (esta última entrega datos autorizados al BFF).
- POST `/informes/institucional/publicar`: siempre bloqueado.
- GET `/control-interno`, `/control-interno/contexto`, `/control-interno/:id`.
- POST `/control-interno/actuaciones/:action`: bloqueado por autoridad no definida.

Frontend: `/informes/institucional`, POST `/informes/institucional/exportar/csv`
o `/pdf`, `/control-interno`, `/control-interno/contexto`, `/control-interno/:id`.
Informes anterior y su CSV histórico se conservan; un enlace abre la consulta nueva.
Control Interno aparece en navegación según la capacidad existente de auditoría;
el backend comprueba además todas las lecturas. No cambia el comportamiento del menú.

## Migración, pruebas y activación local

UP/DOWN: `migrations/20261104_reports_control.*.sql`. Cuatro tablas nuevas:
`control_hallazgo`, `control_recomendacion`, `control_evento`, `informe_generacion`;
ocho relaciones FK, restricciones de estados y cuatro disparadores append-only.
No contiene cambios a estructuras o registros C/D/E ni a permisos. La disponibilidad
para exportaciones/CI exige tablas, relaciones y disparadores; una migración parcial
no habilita sus escrituras. El DOWN elimina información F y nunca se ejecuta solo.

Verificación:

- Backend: 416 pruebas aprobadas. Frontend: 181. Total: 597, incluidas las 558 previas.
- `node test-db/verify-reports-control.mjs --disposable-3307`: 72 comprobaciones,
  respaldo completo sintético restaurado antes del UP, datos previos intactos,
  ceros/ausencias, filtros, instantáneas, exportación auditada, denegación, escrituras
  CI con autoridad sintética, conflictos y trazabilidad. También SQL RBAC real con
  asignación sintética vigente/sin asignación/vencida. Ninguna aprobación ejecutada.
  Cada base generada se elimina al terminar; no se ejecuta DOWN.
- Edge: 24 combinaciones a 320/390/768/1440 px con menú expandido/contraído,
  sin desbordamiento de página ni errores JS, controles etiquetados, impresión PDF
  real y capturas de escritorio/móvil inspeccionadas, con datos sintéticos.
- Herramienta compara estructura, contenido y disparadores de la fuente antes y
  después: 39 tablas/171 registros sin cambios, sin migración F. No se probó una
  sesión web autenticada real de F ni se reiniciaron los procesos activos.

Para activar, se necesita autorización separada:

1. Verificar `develop`, versión C/D/E/F y conexión efectiva estricta
   `127.0.0.1:3307/planes_accion_test`; no confiar en el `.env` general.
2. Crear respaldo completo nuevo cifrado de esquema/datos/disparadores y archivos
   privados; descifrar y restaurar en otra base aislada y comparar antes de continuar.
3. Ensayar el UP F exacto contra esa restauración. Registrar huellas y conteos del
   destino y comprobar que no cambió mientras se verificaba el respaldo.
4. Aplicar únicamente UP F pendiente. Verificar cuatro tablas, ocho FK, cuatro
   disparadores y la conservación completa de las 39 tablas/171 registros anteriores
   (o detenerse si el estado autorizado de partida ya es diferente).
5. Reiniciar controladamente ambos procesos con sus entornos efectivos conservados,
   sin editar `.env`, y verificar HTTP y pruebas no destructivas.
6. Entrar a `http://localhost:4000/informes/institucional` con sesión normal
   autorizada. Consultar Control Interno solo con sus capacidades existentes;
   no modificar permisos para demostrarlo. Las escrituras institucionales continúan
   bloqueadas después de aplicar la migración.

Si destino, respaldo o integridad no se verifican, detenerse. Ante fallos conservar
el respaldo y revisar una recuperación controlada; no ejecutar DOWN ni sobrescribir
la base automáticamente. Los archivos sintéticos de pruebas no sustituyen un respaldo
completo recuperable de la base que se vaya a activar.

## Archivos principales

Backend: `institutional-report.rules.js`, `institutional-report.service.js`,
`internal-control.service.js`, `controller.institutional-reports.js`,
`routes.institutional-reports.js`, `index.js`, migraciones F, pruebas y herramienta.
Frontend: `institutional-reports.views.js`, controladores/rutas de vistas,
`informe-institucional.ejs`, `control-interno.ejs`, enlace en `informes.ejs`,
navegación condicionada, estilos `.report-page`, impresión en `app.js` y pruebas.
Documentación: este archivo, `REVISION_VISUAL.md` y `ARQUITECTURA.md`.


## Preparaci?n de prueba privada Railway

Se prepar? un perfil optativo `railway-private-test`, sin activar recursos externos.
Procedimiento consolidado: [RAILWAY_PRUEBA_PRIVADA.md](RAILWAY_PRUEBA_PRIVADA.md).
Frontend p?blico HTTPS, backend privado en staging y MySQL nuevo; sesiones SQL
separadas del negocio y volumen privado obligatorio para evidencias. Se conserva
el bloqueo institucional existente y el comportamiento de las instancias locales.
El inicializador exige base cloud vac?a y manifiesto del esquema; nunca se ejecuta
con el arranque normal ni selecciona `planes_accion_test`.

Se corrigieron dependencias vulnerables sin cambiar de tecnolog?as ni versiones
mayores de dependencias directas. `npm audit --omit=dev`: cero vulnerabilidades
en ambos repositorios. Ante esos cambios se ampli? la regresi?n: suite backend
427/427 y frontend 202/202, total 629 aprobadas. Las pruebas focalizadas previas
sumaron 48 backend y 17 frontend. El informe Railway recoge las comprobaciones
Docker con MySQL 8.4, sus resultados y los pendientes de publicaci?n.

No se modificaron datos persistentes, cuentas, credenciales, roles, capacidades,
reglas institucionales o c?lculos. No hubo commit, push, merge ni despliegue.
La identidad inicial cloud, los costos y la publicaci?n requieren autorizaci?n;
no se copia la cuenta local ni se ejecuta el bootstrap de desarrollo en Railway.

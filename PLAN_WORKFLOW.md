# Bloque D — expediente y flujo institucional de planes

Implementación técnica en `develop`. **Activada localmente en
`127.0.0.1:3307/planes_accion_test`; las actuaciones institucionales siguen cerradas.**
Resultado, respaldo completo nuevo y recuperación:
[ACTIVACION_LOCAL_BLOQUE_D.md](ACTIVACION_LOCAL_BLOQUE_D.md).
Referencia funcional: Documento Maestro, sección 3 (planes) y sección 4
(actividades), junto con la solicitud del Bloque D. Conserva la formulación del C.

## Alcance implementado

Modelo independiente `plan_flujo`: estado institucional, revisión concurrente,
fechas de calendario del plan y cuenta responsable **propuesta**. La propuesta
no concede permisos, no designa un responsable oficial ni modifica al creador.
Guardar esos campos incompletos está permitido con `M03.plans.update`.

Los registros anteriores no se incorporan ni cambian de estado con la migración.
Una consulta de un plan con estado heredado vacío/Borrador muestra un borrador
virtual, revisión 0, sin escribir. La incorporación técnica ocurre al guardar su
preparación explícitamente. Otros estados heredados requieren una decisión de
incorporación: no se traducen silenciosamente a un borrador ni a una aprobación.

`plan_accion.estado` permanece intacto. El estado institucional se consulta como
`flujo.estado` en el CRUD y como `profile.estado` en el expediente. No sustituye
estados de actividad, período, seguimiento ni datos de los cálculos oficiales.

El motor implementa estas transiciones:

| Origen | Acción | Destino |
|---|---|---|
| Borrador | Presentar | Presentado a Planeación |
| Devuelto | Presentar nuevamente | Presentado a Planeación |
| Presentado | Registrar recepción | En revisión |
| En revisión | Registrar observación | En revisión |
| En revisión | Devolver con motivo | Devuelto para correcciones |
| En revisión | Aprobar con autoridad válida | Aprobado |

**Las seis transiciones anteriores están cerradas en la composición de producción.**
No existe un interruptor de entorno, campo de formulario ni parámetro del router
que pueda habilitarlas. Los servicios, persistencia y validaciones están escritos;
su ejecución institucional requiere las confirmaciones descritas abajo.

## Autorización: lo que falta confirmar

El catálogo actual contiene `M03.plans.submit` y `M03.plans.approve`, pero sus perfiles
se documentan como **ASUMIDO** en `role-permission-matrix.js`. No hay una capacidad
institucional confirmada para recepción, observación o devolución. No se deduce
Planeación del nombre del rol ni del privilegio de administrador del sistema.

Antes de habilitar actuaciones se necesita:

1. Confirmar quién puede presentar como líder y la relación con el plan/proceso.
2. Definir las capacidades institucionales para recibir, observar y devolver;
   no se adopta automáticamente `plans.update` ni `plans.approve` como sustitutos.
3. Confirmar el aprobador válido, sus ámbitos y las incompatibilidades/segregación
   aplicables. Aprobar requiere **siempre** `M03.plans.approve` además del aval
   institucional; nunca basta edición general.
4. Determinar la fuente y vigencia de las designaciones autorizadas de responsable
   de plan y actividades. Una cuenta activa o un nombre escrito no acreditan esa
   designación. La cuenta propuesta debe estar activa para guardarse.
5. Confirmar cuándo aplican valor/unidad de meta y fórmula/unidad/fuente del indicador.
   Las evidencias esperadas son opcionales según el Maestro; solo una regla
   institucional confirmada puede exigirlas en un caso particular.
6. Resolver la incorporación de estados heredados no vacíos distintos de Borrador.

El servicio acepta dos dependencias **internas del servidor**, para una futura
composición revisada: `authority` y `requirements`. El router actual no las acepta
desde sus opciones y compone siempre la política cerrada. No se implementó una
interfaz para alterar permisos, roles, asignaciones o esos adaptadores.

Contrato de futura integración, no configuración de usuario:

- `authority.permissionFor(action)`: capacidad registrada y expresamente aprobada
  para esa operación. Presentar exige `M03.plans.submit`; aprobar exige
  `M03.plans.approve`. La devolución no obtiene autorización por tener edición.
- `authority.authorize({actorId,action,planId}, tx)`: aval vigente dentro de la misma
  transacción, `{allowed:true, reference:'referencia institucional verificable'}`.
- `requirements(aggregate,tx)`: confirmación con `reference`,
  `responsibleAuthorized`, `activityResponsibilitiesAuthorized`,
  `conditionalRulesConfirmed` y `requiredFields` aplicables. Campos condicionales
  admitidos: `meta_valor`, `meta_unidad`, `indicador.formula`, `indicador.unidad`,
  `indicador.fuente`, `actividades.evidencias_esperadas`. Una regla desconocida no
  se considera cumplida. Los requisitos conocidos se comprueban en el servidor.

Se reutiliza el autorizador persistente y su mutex. El ámbito actual es global
(`scopeRef:null`), coherente con el CRUD existente; **no** se habilitan decisiones
por ámbitos nuevos. La resolución institucional por plan/proceso necesita su
definición e integración autorizada antes de activar esas operaciones.

## Validación y protección de datos

La comprobación de presentación informa por separado:

- Datos faltantes: proceso activo, problema, causas, consecuencias, objetivo
  general, objetivos específicos, meta/resultado, nombre y descripción del indicador,
  fechas del plan y cuenta responsable propuesta activa.
- Actividades: al menos una, asociadas a objetivos del mismo plan, con descripción,
  resultado esperado, responsable propuesto, prioridad, fechas válidas/ordenadas y
  método de verificación.
- Confirmaciones institucionales: designación de responsables y requisitos
  condicionales. Completar textos no certifica estas decisiones.

No se inventa obligatoriedad universal de fórmula, unidad, fuente, recursos/costos,
nombre de actividad adicional a su descripción o evidencias esperadas. No se
impone una regla no aprobada de contención de todas las fechas de actividad dentro
del intervalo del plan. Se comprueba el orden inicio/fin de cada intervalo.

Una presentación o aprobación exige el informe completo dentro de la transacción;
un fallo devuelve 422 con campos pendientes y no cambia el estado. Los borradores
siguen admitiendo información incompleta. Fechas: `YYYY-MM-DD` al guardar, sin
conversiones de zona horaria. Los instantes de actuaciones se generan en UTC y
se presentan en hora colombiana, conservando `time[datetime]`.

Cada actuación requiere la revisión vigente y `contentVersion` de la consulta.
La huella incluye el contenido persistido del plan, actividades, recursos y ficha:
editar el Bloque C después de consultar invalida una presentación antigua. Conflictos
devuelven 409; duplicados concurrentes no crean dos decisiones.

Los guardas están también en los controladores anteriores de edición de plan y
creación/edición de actividades. Presentado, En revisión y Aprobado bloquean esas
escrituras, aunque se llame directamente a la API heredada. Devuelto permite
corregir. No se añade una excepción de edición posterior a aprobación sin autoridad.
Antes de migrar D, la ausencia de sus tablas mantiene funcionando C; otros fallos
de comunicación no se ocultan ni eluden los guardas.

## Historial y frontend

`plan_flujo_evento` almacena plan, acción, actor, fecha/hora UTC, estado anterior y
nuevo, motivo/observación y referencia institucional. Cada evento conserva una
instantánea completa y su SHA256. La revisión es única por plan. El evento y el
cambio de estado se confirman o revierten juntos.
La instantánea de presentación/aprobación conserva también la referencia de las
reglas y designaciones confirmadas utilizadas en su validación.

No existen rutas de actualización/eliminación de observaciones. Triggers rechazan
UPDATE y DELETE de eventos. Una nueva presentación añade eventos y conserva los
anteriores. Los historiales preexistentes del C y los seguimientos no se alteran
ni se mezclan con decisiones de planes.

Bandeja EJS con filtros por estado/nombre y paginación de 50 expedientes. Historial
con paginación de 50 eventos, cursor BIGINT sin pérdida de precisión. Los registros
no incorporados se consultan desde Planes; no se fabrican expedientes para poblar
la bandeja. Un fallo de consulta o migración ausente se muestra como indisponibilidad,
no como lista vacía.

Expediente: faltantes por campo, preparación opcional, autoridades pendientes y
observaciones con autor/fecha. Las acciones aparecen deshabilitadas cuando el
servidor no las habilita. Los formularios usan el CSRF existente; el BFF solo envía
campos permitidos y retiene lo escrito ante errores en la sesión del usuario,
incluidos motivos y fechas. No retiene CSRF, contraseñas ni tokens en esa recuperación.
Las propuestas se pueden consultar incluso si el expediente dejó de ser editable.
Los cambios no guardados de preparación bloquean las actuaciones del navegador.

## API

Todas bajo `/api`, con JWT verificado y permisos comprobados en el servicio:

| Método | Ruta | Comportamiento |
|---|---|---|
| GET | `/planeacion?estado=&q=&after=` | Bandeja, permiso actual de lectura de planes |
| GET | `/planes/:id/flujo?before=` | Expediente, faltantes e historial |
| GET | `/planes/:id/flujo/validacion` | Comprobación sin escritura |
| POST | `/planes/:id/flujo/ficha` | Preparación opcional, `plans.update` y estado editable |
| POST | `/planes/:id/flujo/acciones` | Actuación; actualmente 403 por autoridad no configurada |

Ficha: `revision`, `fecha_inicio`, `fecha_fin`, `responsable_propuesto_id`.
Actuación: `action`, `revision`, `contentVersion`, `observacion`.
No se aceptan autor, rol, estado de destino ni una autoridad aportada por el cliente.

## Migraciones, pruebas y activación posterior

- `migrations/20261103_plan_workflow.up.sql`: dos tablas y dos triggers, aditiva,
  sin INSERT/UPDATE de datos anteriores.
- `migrations/20261103_plan_workflow.down.sql`: preparada únicamente para recuperación
  manual autorizada, después de exportar la información nueva. **No se ejecutó.**

Desde la carpeta del backend:

```powershell
node test-db/verify-plan-workflow.mjs --disposable-3307
node --experimental-test-module-mocks --test
```

El comprobador verifica `127.0.0.1:3307/planes_accion_test`, copia **solo estructura**
a bases nuevas `planes_blockd_*` y crea fixtures sintéticos no comerciales sin
credenciales utilizables ni asignaciones de roles/permisos. Antes de aplicar D,
respalda el esquema y esos datos sintéticos, verifica SHA256 y restaura en otra base
desechable. UP conserva exactamente los datos C de compatibilidad anteriores.
Las actuaciones se ejecutan únicamente sobre planes nuevos del comprobador, con
decisiones de autorización simuladas. Persistencia, claves foráneas, mutex,
transacciones, bloqueos y triggers son reales. Las bases temporales se eliminan
al terminar; el respaldo verificable queda en `test-db/workflow-backups.tmp/`,
ignorado por Git. Nunca se migra la base fuente ni se ejecuta DOWN.

**No se aprobó ningún plan real ni de prueba.** Se comprueba el rechazo de aprobación;
el camino exitoso de aprobación requiere autoridad y una prueba expresamente
autorizada posterior. Las simulaciones no certifican una autoridad institucional.

Procedimiento de activación local, ejecutado posteriormente con autorización
específica y documentado en `ACTIVACION_LOCAL_BLOQUE_D.md`:

1. Verificar otra vez destino y procesos. Crear un **respaldo completo nuevo** de
   `planes_accion_test` con su estado C actual, cifrado, con integridad y restauración
   comprobadas. El respaldo C anterior no sustituye ese respaldo nuevo.
2. Ensayar este UP en la restauración, revisar compatibilidad/estados heredados,
   verificar usuario de aplicación y triggers, sin asignar permisos automáticamente.
3. Solo con autorización de activación, aplicar el mismo UP en la conexión verificada
   de 3307 y comprobar datos y estructuras. Nunca ejecutar DOWN de oficio.
4. Reiniciar backend/frontend con sus entornos efectivos aislados, sin editar `.env`.
   Iniciar sesión nuevamente. Las actuaciones institucionales seguirán cerradas.
5. Consultar `http://localhost:4000/planeacion` y
   `http://localhost:4000/planes/ID/gestion`. La formulación C continúa en `/planes`
   y `/actividades`. Los enlaces aparecen después de comprobar disponibilidad D.

Durante la entrega técnica anterior a la activación no se reiniciaron los procesos
ni se aplicaron cambios de esquema a `planes_accion_test`. La activación posterior
aplicó únicamente UP y reinició ambos procesos locales; no se hicieron transiciones de sus registros,
no se modificaron cuentas/credenciales/roles/permisos ni cálculos oficiales, y no
hubo instalaciones, commit, push, merge o despliegue.

Resultados finales: 361 pruebas backend y 168 frontend aprobadas, 40 comprobaciones
de persistencia y 24 configuraciones Edge. Las 30 tablas y 171 registros del entorno
C siguen coincidiendo con sus huellas verificadas. La activación posterior añadió
las dos tablas D y ambos triggers, sin crear registros de prueba. Sintaxis JavaScript
y `git diff --check`: correctos.

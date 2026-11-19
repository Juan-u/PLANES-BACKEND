# Integración del módulo de roles y permisos

## Estado actual

El menú usa los códigos de permisos efectivos del usuario, incluidos los de asignaciones con ámbito. Para Actividades, Seguimiento y sus evidencias, el backend consulta los ámbitos tipados vigentes del permiso solicitado. Las colecciones y métricas se limitan a las actividades de esos ámbitos. Para una operación individual, el backend obtiene el plan de la actividad persistida o de la actividad asociada a la evidencia. Una asignación de plan cubre sus actividades y una asignación de actividad cubre esa actividad. La administración de períodos y la aprobación de seguimientos mantienen sus controles institucionales y permisos globales.

El módulo cuenta con el servicio de asignaciones, repositorios protegidos por el mutex persistente, administración de catálogo y cuentas, controladores y routers HTTP. La aplicación usa el middleware JWT existente; la identidad de las operaciones nuevas se toma de `req.usuario.sub` después de verificar el token. La autorización del nuevo módulo consulta asignaciones, permisos, configuración y vigencia; `usuario.id_rol` no concede permisos nuevos.

La autenticación del login permanece independiente de la autorización de módulos. El API de cuentas mantiene la validación de cuenta activa. La interfaz EJS consume el API con el JWT guardado en la sesión del servidor y aplica CSRF a sus formularios de escritura.

El catálogo y la administración de roles/permisos se montan fuera de `NODE_ENV=production` como antes. En producción, el catálogo administrativo y las rutas de asignación permanecen desactivados por defecto y solo se montan conjuntamente con los opt-ins explícitos `ENABLE_ROLE_PERMISSION_ADMINISTRATION=true` y `ENABLE_ROLE_PERMISSION_ROUTES=true`, la confirmación `ROLE_PERMISSION_PRODUCTION_CONFIRMATION=ENABLE_PRODUCTION_ROLE_ADMIN_AND_ASSIGNMENT_ROUTES` y una ventana positiva `ROLE_APPROVAL_WINDOW_MS`. En ese modo el arranque verifica en modo solo lectura las columnas, claves foráneas y configuración del procedimiento de autoridad inicial, además de la fila mutex; si falta algo, falla antes de montar las rutas. No se monta el endpoint de capacidades en producción. Las migraciones `20261118_role_scope_resources.up.sql` y `20261119_initial_scope_authority.up.sql` están preparadas localmente y no se han ejecutado en producción.

Las rutas funcionales de planes, actividades, seguimiento, evidencias, informes y flujo de planes se montan independientemente de esos interruptores. Cada endpoint conserva sus verificaciones JWT y de permisos; el opt-in conjunto activa solo las superficies de roles y asignaciones, sin omitir sus controles.

## Pendiente de decisión funcional: Control Interno

Las consultas de Control Interno requieren actualmente `M15.audit.read`, `M03.plans.read`, `M04.activities.read` y `M05.followup.read`. La navegación del frontend solo debe mostrar el módulo cuando están presentes los cuatro permisos, de modo que coincide con el control efectivo del servicio. El perfil inicial `auditor` no incluye los permisos de planes, actividades ni seguimiento, por lo que su acceso queda denegado sin cambiar la matriz ni conceder permisos automáticamente.

Queda pendiente que el responsable funcional confirme si ese alcance combinado es la política deseada o si Control Interno debe limitarse a `M15.audit.read`. Cualquier modificación de la política requerirá aprobación explícita; mientras tanto, se conserva la comprobación más restrictiva existente.

## Catálogo y permisos configurables

La documentación funcional identifica los módulos M01–M16, pero no enumera nombres definitivos de roles operativos ni el reparto detallado de acciones. Por eso `app/config/role-permission-matrix.js` define perfiles iniciales **ASUMIDOS**, claramente codificados y revisables:

- `system_administrator`: administración total de los 16 módulos y operaciones de asignación, revocación y aprobación.
- `technology_administrator`, `planning_coordinator`, `plan_author`, `plan_approver`, `activity_responsible`, `collaborator` y `auditor`: perfiles operativos iniciales con permisos explícitos y mínimo privilegio.
- `scope_authority_manager`: autoridad institucional separada, ordinaria, con ámbito obligatorio y vigencia finita. Sus permisos no se conceden a `system_administrator`; su asignación inicial requiere nominación documentada y decisión independiente.

El catálogo contiene 65 permisos de módulo/operación; las tres operaciones de asignación, revocación y aprobación se mantienen como códigos separados. La migración incorpora `M01.roles.manage_scope` sin otorgarlo globalmente a los administradores técnicos. Las delegaciones no están activadas. La falta de configuración, permiso o asignación vigente deniega el acceso.

El perfil administrador total está protegido frente a la eliminación de sus permisos esenciales desde el servicio. Las cuentas de Erick y Juan Esteban no están fijadas por nombre/correo en el código ni tienen contraseñas por defecto. Al preparar el entorno, ambas cuentas existentes deben identificarse explícitamente por ID y nombre exacto, estar activas y ser distintas. El bootstrap asigna a ambas el perfil `system_administrator`; una puede aprobar el alta privilegiada de la otra.

## Administración HTTP

En entornos no productivos, el API expone el catálogo y las consultas protegidas de administración de roles/permisos:

| Método y ruta | Operación |
|---|---|
| `GET /api/roles/capacidades` | Consultar exclusivamente los permisos efectivos del usuario autenticado; se monta en entornos no productivos como lectura propia |
| `POST /api/roles/asignaciones` | Optativa: crear asignación ordinaria o solicitar aprobación privilegiada |
| `GET /api/roles/asignacion-recursos?targetUserId=...&roleId=...` | Optativa: listar los recursos tipados habilitados para el rol y sobre los que el actor tiene autoridad efectiva de asignación |
| `POST /api/roles/asignaciones/:assignmentId/revocacion` | Optativa: revocar o solicitar revocación |
| `POST /api/roles/solicitudes/:requestId/decision` | Optativa: aprobar o rechazar una solicitud pendiente |
| `GET /api/roles/catalogo` | Leer roles y su configuración |
| `GET /api/roles/permisos` | Leer catálogo de permisos |
| `GET /api/roles/solicitudes` | Leer solicitudes y decisiones |
| `GET /api/roles/usuarios/:userId/asignaciones` | Leer asignaciones del usuario indicado |
| `GET /api/roles/ambitos/recursos` | Listar planes y actividades institucionales; requiere `M01.roles.manage` |
| `POST /api/roles/ambitos/recursos` | Habilitar explícitamente un plan o actividad para un rol con ámbito obligatorio; requiere motivo, permiso vigente y auditoría |
| `GET /api/roles/autoridad-inicial/solicitudes` | Consultar nominaciones y decisiones de autoridad inicial; requiere `M01.roles.manage` |
| `POST /api/roles/autoridad-inicial/solicitudes` | Registrar una nominación con titular activo, Plan, vencimiento, motivo y referencia institucional |
| `POST /api/roles/autoridad-inicial/solicitudes/:requestId/decision` | Aprobar o rechazar con un segundo actor técnico distinto y confirmación de la misma referencia institucional |
| `POST /api/roles/catalogo` | Crear rol sin permisos asociados; requiere autorización vigente |
| `PUT /api/roles/catalogo/:roleId/configuracion` | Cambiar clasificación y reglas de vigencia/ámbito; requiere autorización vigente |
| `PUT /api/roles/catalogo/:roleId/permisos` | Configurar permisos del rol; requiere autorización vigente |
| `PUT /api/roles/permisos/:code/estado` | Activar/desactivar un permiso sin borrar historial; requiere autorización vigente |

Las rutas de catálogo, solicitudes y asignaciones de lectura del router de roles se montan en entornos no productivos aunque `ENABLE_ROLE_PERMISSION_ROUTES` esté desactivado; cada una conserva autenticación JWT y autorización interna. La asignación, revocación y decisión de cambios siguen requiriendo el flag y la ventana aprobada. La autoridad de las operaciones administrativas se vuelve a comprobar dentro de cada transacción y bajo el mutex. La auditoría, el cambio efectivo y la decisión se escriben conjuntamente. Los formularios no son una barrera de seguridad: el API valida cada acción.

Las rutas de usuarios conservan la autenticación JWT. Las lecturas se protegen con el middleware de permisos; creación, actualización, desactivación y reactivación consultan la autorización dentro de la transacción que realiza el cambio y guarda auditoría. La desactivación es lógica, no borra usuarios ni su historial. En producción el endpoint de capacidades sigue sin montarse; la administración de roles y las rutas de asignación requieren la activación conjunta documentada en `RAILWAY_PRODUCTION.md`.

El permiso técnico global `M01.roles.manage` permite a sus titulares administrar asignaciones de roles ordinarios en recursos con ámbito tipado y habilitado para ese rol. Esto no concede `M01.roles.manage_scope`: los roles privilegiados y la autoridad institucional protegida no quedan cubiertos por ese permiso global. El bootstrap institucional crea una asignación finita del rol protegido `scope_authority_manager` únicamente tras nominación con referencia institucional y aprobación por un administrador técnico distinto; la segunda persona debe confirmar la misma referencia. Al aprobar se comprueba que la vigencia no haya expirado, y la solicitud, referencia, actores, vencimiento y asignación se conservan en auditoría. No asigna autoridad a Erick, Juan Esteban ni a otra persona por defecto. El usuario titular no puede ampliar o volver a asignar este rol mediante el flujo general; la rotación posterior requiere un procedimiento institucional revisado. La referencia se registra y confirma por dos actores; su veracidad documental debe comprobarse fuera del sistema.

## Ámbitos tipados de planes y actividades

La migración aditiva `migrations/20261118_role_scope_resources.up.sql` crea `rol_scope_recurso`, que enlaza una referencia de ámbito con un plan o una actividad y comprueba por claves foráneas que la actividad pertenece al plan indicado. La migración `migrations/20261119_initial_scope_authority.up.sql`, que debe aplicarse después, crea el registro de nominación/decisión y agrega el rol y permiso institucional sin conceder asignaciones. Ninguna de las dos migraciones enlaza referencias antiguas por coincidencia de ID. No se ha aplicado ninguna en Railway. La migración de autoridad no tiene `DOWN`: retirarla requiere primero un procedimiento de archivo y revocación revisado, no una eliminación automática.

La pantalla EJS sustituye la referencia libre por un selector que muestra nombre e ID de plan o actividad. Las opciones de asignación se consultan mediante la sesión autenticada y se filtran en el Back-End según rol, habilitación explícita y autoridad efectiva del actor para ese usuario y ámbito. El envío vuelve a resolver el tipo e ID dentro de la transacción; el selector no sustituye la autorización del servicio. La habilitación administrativa exige `M01.roles.manage`, un motivo y auditoría, pero por sí sola no concede autoridad institucional para asignar el rol. Las asignaciones privilegiadas conservan el flujo de aprobación independiente.

Para validar localmente, primero preparar una base desechable compatible con el esquema y las migraciones previas, aplicar allí esta migración versionada y habilitar las rutas de asignación solo con `ENABLE_ROLE_PERMISSION_ROUTES=true` y `ROLE_APPROVAL_WINDOW_MS` válido en entorno no productivo. No aplicar esta migración ni habilitar estas rutas en Railway/producción como parte de esta implementación.

## Bootstrap de desarrollo — no ejecutado

El script `scripts/bootstrap-role-permissions.dev.js` prepara una inicialización idempotente restringida a una base local cuyo nombre termine en `_dev`, `_development` o `_test`. Antes de usarlo, la persona operadora debe proporcionar por variables de entorno:

- `NODE_ENV=development` y `ROLE_PERMISSION_BOOTSTRAP_CONFIRM=SEED_DEVELOPMENT_ROLE_PERMISSIONS`.
- `DB_HOST` local, nombre de base de prueba/desarrollo, usuario no-root y contraseña suministrada fuera del repositorio.
- ID y nombre exacto ya registrado de cada una de las dos cuentas administradoras, mediante `ROLE_BOOTSTRAP_ADMIN_PRIMARY_ID`, `ROLE_BOOTSTRAP_ADMIN_PRIMARY_NAME`, `ROLE_BOOTSTRAP_ADMIN_SECONDARY_ID` y `ROLE_BOOTSTRAP_ADMIN_SECONDARY_NAME`.
- `ROLE_BOOTSTRAP_TEST_USERS_JSON`: un usuario por cada perfil, con nombre, correo, contraseña de al menos 14 bytes y, para perfiles con ámbito, un ID de referencia ya existente y permitido.

El script verifica estado activo y coincidencia ID/nombre de las dos cuentas administrativas, hashea las contraseñas de los usuarios de prueba mediante el servicio scrypt existente y verifica que los ámbitos ya existan, estén activos y permitidos. No inventa identidades, credenciales, referencias de ámbito ni las crea. Todo el bootstrap está dentro de una transacción con mutex y auditoría. No se ha ejecutado; no se incluyen valores de entorno ni ejemplos de credenciales en el repositorio.

## Verificación pendiente antes de activar

1. Revisar y aprobar los perfiles y la matriz asumidos; el script no los siembra hasta su ejecución explícita.
2. Confirmar identidad de las dos cuentas mediante sus datos reales de entorno, sin copiar credenciales al código.
3. Cotejar el borrador SQL con el DDL aprobado del entorno aislado y provisionar la fila singleton del mutex por el procedimiento autorizado.
4. Ejecutar migración y bootstrap únicamente en una base aislada autorizada; nunca contra la base comercial.
5. Ejecutar pruebas de integración con MariaDB/InnoDB aislada, incluidas concurrencia, FK, bloqueo y rollback. Las pruebas actuales son unitarias o simuladas y no certifican el motor real.
6. Probar la experiencia EJS contra un backend aislado y revisar que las acciones ocultas por interfaz continúan protegidas por autorización backend.
7. Mantener el router desactivado en producción hasta concluir esas verificaciones y obtener la autorización de activación correspondiente.

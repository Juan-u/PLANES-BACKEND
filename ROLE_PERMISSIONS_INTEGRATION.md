# Integración del módulo de roles y permisos

## Estado actual

El módulo cuenta con el servicio de asignaciones, repositorios protegidos por el mutex persistente, administración de catálogo y cuentas, controladores y routers HTTP. La aplicación usa el middleware JWT existente; la identidad de las operaciones nuevas se toma de `req.usuario.sub` después de verificar el token. La autorización del nuevo módulo consulta asignaciones, permisos, configuración y vigencia; `usuario.id_rol` no concede permisos nuevos.

La autenticación del login permanece independiente de la autorización de módulos. El API de cuentas mantiene la validación de cuenta activa. La interfaz EJS consume el API con el JWT guardado en la sesión del servidor y aplica CSRF a sus formularios de escritura.

Las rutas administrativas son optativas mediante `ENABLE_ROLE_PERMISSION_ROUTES=true`, requieren `ROLE_APPROVAL_WINDOW_MS` y rechazan el arranque si se intenta habilitarlas bajo `NODE_ENV=production`. La migración `documentacion funcional recuperada/migracion_roles_permisos_v1.sql` es un borrador: no se ha ejecutado ni validado contra MariaDB comercial. Los routers de roles y asignación no se montan por defecto.

## Catálogo y permisos configurables

La documentación funcional identifica los módulos M01–M16, pero no enumera nombres definitivos de roles operativos ni el reparto detallado de acciones. Por eso `app/config/role-permission-matrix.js` define perfiles iniciales **ASUMIDOS**, claramente codificados y revisables:

- `system_administrator`: administración total de los 16 módulos y operaciones de asignación, revocación y aprobación.
- `technology_administrator`, `planning_coordinator`, `plan_author`, `plan_approver`, `activity_responsible`, `collaborator` y `auditor`: perfiles operativos iniciales con permisos explícitos y mínimo privilegio.

El catálogo contiene 64 permisos de módulo/operación. Los códigos de operación de roles (`assign-role`, `revoke-role`, `approve-role-change`) se configuran aparte y no se insertan automáticamente al arrancar. Las delegaciones no están activadas. La falta de configuración, permiso o asignación vigente deniega el acceso.

El perfil administrador total está protegido frente a la eliminación de sus permisos esenciales desde el servicio. Las cuentas de Erick y Juan Esteban no están fijadas por nombre/correo en el código ni tienen contraseñas por defecto. Al preparar el entorno, ambas cuentas existentes deben identificarse explícitamente por ID y nombre exacto, estar activas y ser distintas. El bootstrap asigna a ambas el perfil `system_administrator`; una puede aprobar el alta privilegiada de la otra.

## Administración HTTP

Con el router optativo habilitado, el API expone:

| Método y ruta | Operación |
|---|---|
| `GET /api/roles/capacidades` | Consultar exclusivamente los permisos efectivos del usuario autenticado; se monta en entornos no productivos como lectura propia |
| `POST /api/roles/asignaciones` | Crear asignación ordinaria o solicitar aprobación privilegiada |
| `POST /api/roles/asignaciones/:assignmentId/revocacion` | Revocar o solicitar revocación |
| `POST /api/roles/solicitudes/:requestId/decision` | Aprobar o rechazar una solicitud pendiente |
| `GET /api/roles/catalogo` | Leer roles y su configuración |
| `GET /api/roles/permisos` | Leer catálogo de permisos |
| `GET /api/roles/solicitudes` | Leer solicitudes y decisiones |
| `GET /api/roles/usuarios/:userId/asignaciones` | Leer asignaciones del usuario indicado |
| `POST /api/roles/catalogo` | Crear rol sin permisos asociados |
| `PUT /api/roles/catalogo/:roleId/configuracion` | Cambiar clasificación y reglas de vigencia/ámbito |
| `PUT /api/roles/catalogo/:roleId/permisos` | Configurar permisos del rol |
| `PUT /api/roles/permisos/:code/estado` | Activar/desactivar un permiso sin borrar historial |

La autoridad se vuelve a comprobar dentro de cada transacción y bajo el mutex. La auditoría, el cambio efectivo y la decisión se escriben conjuntamente. Los formularios no son una barrera de seguridad: el API valida cada acción.

Las rutas de usuarios conservan la autenticación JWT. Las lecturas se protegen con el middleware de permisos; creación, actualización, desactivación y reactivación consultan la autorización dentro de la transacción que realiza el cambio y guarda auditoría. La desactivación es lógica, no borra usuarios ni su historial. El endpoint de capacidades no se monta en producción. El router de asignaciones y los endpoints mutables/de catálogo se montan solo con `ENABLE_ROLE_PERMISSION_ROUTES=true`; en producción ese flag causa rechazo de arranque.

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

# Instalación inicial segura en Railway production

Este procedimiento prepara la instalación para el proyecto Railway
`courteous-grace`, entorno `production`, servicio MySQL `MySQL-EZwX`. No se
ejecutó ni se conectó a Railway o a una base de datos al preparar este documento.
La base debe confirmarse vacía por una persona autorizada antes de iniciar.

## Alcance y controles

- El inicializador existente de `private-test` no se modifica.
- El perfil de producción usa `railway-production` y exige el nombre exacto de
  proyecto, entorno y servicio MySQL, además de comparar el host privado y el
  nombre esperado de base con las variables de aplicación.
- La aplicación no crea tablas al arrancar. La instalación del esquema y el
  aprovisionamiento de administradores son dos comandos explícitos y separados.
- El esquema versionado contiene 43 tablas; `web_sessions.up.sql` añade la tabla
  de sesiones. El resultado esperado es 44 tablas, 86 claves foráneas y 20
  disparadores.
- El SQL principal y el SQL de sesiones verifican sus huellas antes de ejecutar
  DDL. El inicializador usa un bloqueo de ejecución de servidor y comprueba la
  base vacía, el puerto, el destino y que no existan previamente las dos cuentas
  técnicas. DDL MySQL no es transaccional: un fallo exige detenerse e inspeccionar;
  no reintentar, no ejecutar `DOWN` ni restaurar automáticamente.
- El Back-End requiere el volumen de evidencias montado en `/data/evidence`.
  Mantiene `ENABLE_ROLE_PERMISSION_ROUTES=false` en producción. No habilitar esa
  superficie para resolver el inicio de sesión.
- El Front-End requiere HTTPS público, Back-End en red privada y sesiones MySQL
  persistentes; no usa `MemoryStore` como fallback.

## Configuración

Usar como referencia las plantillas, sustituyendo el nombre real de base por el
que muestra el servicio MySQL en Railway:

- Back-End: `deployment/railway/backend.production.variables.example`
- Front-End: `../proyecto fronted erick/deployment/railway/frontend.production.variables.example`
- Variables temporales: `deployment/railway/production-bootstrap.variables.example`

`RAILWAY_PROJECT_NAME` y `RAILWAY_ENVIRONMENT_NAME` deben proceder del contexto de
Railway; el perfil los compara con el destino autorizado. `PRODUCTION_DB_HOST`
debe ser el dominio privado exacto del servicio `MySQL-EZwX`, y
`PRODUCTION_DB_NAME` el nombre exacto de la base creada allí. No inferir el nombre
de base del nombre visual del servicio ni usar el host público/TCP proxy. Las
variables `DB_HOST`, `DB_NAME`, `SESSION_DB_HOST` y `SESSION_DB_NAME` deben
coincidir con ese destino. Confirmar el vínculo de servicio en el panel antes de
configurar estos valores.

No usar valores del `.env` local. Crear secretos nuevos e independientes para
`JWT_SECRET`, `SESSION_SECRET`, `DB_PASSWORD` y `SESSION_DB_PASSWORD`, almacenados
como secretos en Railway. El `BOOTSTRAP_DB_USER` y `BOOTSTRAP_DB_PASSWORD` son
credenciales administrativas temporales del MySQL nuevo: solo sirven para la
inicialización del esquema, no deben ser las credenciales de la aplicación.
Retirarlas al terminar. No incluir contraseñas ni tokens en archivos, comandos,
logs o commits.

## Paso 1: comprobar el destino

En Railway, verificar visualmente proyecto, entorno, servicio MySQL, estado,
dominio privado, puerto y nombre de base. Comprobar también que Front-End y
Back-End están vinculados a los servicios previstos. Confirmar en una consulta de
solo lectura sobre ese destino que no hay tablas y no hay información que se deba
conservar. Este control debe realizarse por el operador autorizado; no se ha
realizado en esta preparación. Si el destino no coincide exactamente, detenerse.

La variable `PRODUCTION_MYSQL_SERVICE_NAME` comprueba la declaración explícita
del destino; por sí sola no acredita el servicio. La relación real se valida al
copiar el dominio privado directamente desde `MySQL-EZwX` y comprobarlo en el
panel de Railway.

## Paso 2: inicializar solo el esquema

Configurar las variables de producción del Back-End y las credenciales temporales
de base nueva. Verificar de nuevo que `DB_HOST`/`DB_NAME` coinciden con
`PRODUCTION_DB_HOST`/`PRODUCTION_DB_NAME`. Ejecutar manualmente una sola vez en el
servicio Back-End:

```text
node deployment/railway/initialize-empty-production.mjs --initialize-new-railway-production
```

El usuario temporal requiere privilegios MySQL para crear las cuentas técnicas y
otorgar permisos por tabla. El script comprueba la ausencia previa de las cuentas
`planes_backend` y `planes_web_sessions`; si el usuario administrativo no puede
consultar ese metadato, el proceso falla antes de aplicar DDL. No sortear esa
comprobación concediendo permisos amplios a las cuentas de la aplicación.

Éxito informa únicamente los conteos de tablas, claves foráneas y triggers. Ante
cualquier error, preservar el estado y solicitar revisión. Debido al DDL no
transaccional, un estado parcial no es reintentable de forma segura.

Después del éxito, retirar `BOOTSTRAP_DB_USER`, `BOOTSTRAP_DB_PASSWORD` y
`SESSION_DB_PASSWORD` del Back-End. Mantener `SESSION_DB_PASSWORD` como secreto
solo en el Front-End para abrir el store de sesiones. No volver a ejecutar el
inicializador.

## Paso 3: aprobar y aprovisionar las dos cuentas administrativas

No hay un administrador inicial en el esquema ni un mecanismo anónimo de alta.
Antes del bootstrap, la autoridad institucional debe aprobar por un medio externo
y verificable a **dos personas distintas**, sus correos institucionales, el rol
existente `system_administrator` y la referencia de aprobación que se conservará
en auditoría. La matriz de permisos en `app/config/role-permission-matrix.js`
define ese rol como privilegiado y de alcance global. No cambiar el catálogo ni
crear roles o permisos ad hoc para esta instalación.

Configurar temporalmente en el servicio Back-End:

- `PRODUCTION_ADMIN_APPROVAL_REFERENCE`: identificador del acta/ticket de
  autorización ya aprobado.
- `PRODUCTION_ADMIN_ACCOUNTS_JSON`: arreglo con exactamente dos objetos, cada
  uno con `name`, `email` y una contraseña distinta de al menos 14 bytes.
- `PRODUCTION_ADMIN_BOOTSTRAP_CONFIRMATION`: el literal de confirmación de la
  plantilla.

El JSON incluye contraseñas en texto durante la ejecución; guardarlo únicamente
como secreto temporal de Railway y nunca en un archivo versionado, consola o
registro. Los dos nombres y correos deben corresponder a las personas aprobadas.
El script no comprueba por sí mismo la validez institucional de la referencia:
esa verificación y la custodia dual son responsabilidad del operador autorizado.

Ejecutar manualmente una sola vez, después de inicializar el esquema:

```text
node deployment/railway/bootstrap-authorized-admins.mjs --create-authorized-production-admins
```

El script exige el destino exacto, esquema completo y limpio (excepto el mutex
técnico); crea las dos cuentas con hash scrypt, carga el catálogo de roles y
permisos existente y asigna `system_administrator` a ambas personas. En la misma
transacción y bajo el mutex persistente, registra cuentas, catálogo, asignaciones,
solicitudes, decisiones cruzadas y eventos de auditoría con la referencia
aprobada. Cada asignación privilegiada queda solicitada por una cuenta y aprobada
por la otra; no se asigna a una persona su propio rol privilegiado.

Ejemplo de estructura (datos ficticios; no copiar contraseñas de ejemplo):

```json
[
  {"name":"Nombre aprobado 1","email":"persona1@example.invalid","password":"<secreto individual>"},
  {"name":"Nombre aprobado 2","email":"persona2@example.invalid","password":"<secreto individual>"}
]
```

Los cambios DML del bootstrap son transaccionales. Si falla la transacción, el
script intenta rollback y avisa si el resultado no pudo confirmarse. Antes de
cualquier reintento, comprobar el estado de solo lectura y revisar la auditoría;
un commit con respuesta perdida puede haber completado el alta. No volver a
ejecutar a ciegas.

Tras el éxito, retirar del entorno todas las variables temporales de bootstrap.
Las contraseñas deben haberse generado como credenciales individuales de uso
continuado y entregarse por canales privados a sus titulares. No se encontró un
flujo de cambio o recuperación de contraseña en la aplicación; por tanto, acordar
la política de rotación con los responsables y no prometer una acción de cambio
desde la interfaz. Mantener el registro de aprobación fuera de los secretos de
despliegue.

## Compatibilidad y límites operativos

El perfil productivo no habilita los endpoints de catálogo, capacidades ni
asignación de roles: el código los excluye deliberadamente de `NODE_ENV=production`.
El login y las rutas protegidas por el catálogo de permisos permanecen separados
de esa superficie. No activar rutas de asignación ni editar permisos como atajo.
La gestión ordinaria de roles en producción requiere un diseño y autorización
separados; no forma parte de este bootstrap.

El esquema no contiene registros institucionales ni cuentas iniciales. No se
ejecutan migraciones históricas además de la instantánea versionada. La cuenta
Front-End solo recibe permisos DML en `web_sessions`; el Back-End recibe DML y
`TRIGGER` sobre sus tablas, sin permisos de crear, alterar o eliminar tablas.

## Validación local realizada

Las pruebas nuevas validan únicamente políticas de destino/perfil y entradas
inválidas. No conectan a MySQL, no inicializan la base, no crean usuarios ni
realizan despliegues. Antes de publicar todavía se debe confirmar manualmente el
nombre real de base y host privado, completar secretos aprobados, ejecutar los
dos procedimientos de manera controlada y verificar readiness y login desde
HTTPS.

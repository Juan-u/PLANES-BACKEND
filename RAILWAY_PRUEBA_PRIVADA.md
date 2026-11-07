# Prueba privada en Railway

Estado: preparación local; no se creó proyecto, recurso, dominio ni despliegue externo.
Dos repositorios independientes en `develop`; la raíz del espacio de trabajo no
es un repositorio. Se conservan los cambios anteriores. No usar los remotos como
fuente de despliegue hasta que exista una entrega autorizada del código actual.

## Tres servicios

| Servicio | Ejecución | Red y persistencia |
| --- | --- | --- |
| frontend | Dockerfile existente, `npm start`, PORT dinámico (ejemplo 4000) | Único dominio HTTPS. Sesiones en MySQL con cuenta exclusiva. Una réplica. |
| backend | Dockerfile existente, `npm start`, PORT dinámico (ejemplo 3000) | Solo DNS privado; volumen privado `/data/evidence`. Una réplica. |
| MySQL | MySQL 8.4, base nueva `planes_accion_railway_test` | Solo red privada, volumen de base de datos; sin TCP proxy ni dominio público. |

Los servicios deben estar en el mismo proyecto y entorno `private-test`. La
comunicación privada usa HTTP entre aplicaciones y MySQL dentro de la red de
Railway; HTTPS termina en su proxy público. No se afirma TLS de aplicación en esos
enlaces internos. `APP_HOST=::` permite escuchar la red privada IPv6 y los puertos
se toman de `PORT`; las referencias deben usar el mismo puerto del backend.

Referencias oficiales: [red privada](https://docs.railway.com/networking/private-networking),
[MySQL](https://docs.railway.com/databases/mysql) y
[volúmenes](https://docs.railway.com/volumes/reference).

## Variables y arranque seguro

Plantillas, sin valores secretos:

- Backend: `deployment/railway/backend.variables.example`.
- Frontend: `../proyecto fronted erick/deployment/railway/frontend.variables.example`.

Agregar las variables en Railway, sin editar `.env` locales. `JWT_SECRET` y
`SESSION_SECRET`: secretos nuevos e independientes, Base64URL aleatorio de 48
bytes, mediante un gestor de secretos o generador privado; nunca copiarlos a logs,
argumentos, documentación o control de versiones. Contraseñas técnicas nuevas para
`planes_backend` y `planes_web_sessions`, guardadas como variables selladas.
`ROLE_APPROVAL_WINDOW_MS` conserva el valor de la política ya aprobada: introducirlo
manualmente, sin inventar otra ventana.

`DEPLOYMENT_PROFILE=railway-private-test` es optativo y rechaza otros destinos.
Backend usa `NODE_ENV=staging`: la composición existente bloquea deliberadamente
las rutas funcionales con `NODE_ENV=production`. No se elude ese bloqueo. Express
oculta errores internos en el perfil cloud. No es una certificación de producción.

Frontend usa `NODE_ENV=production`, confía en un solo proxy y requiere
`PUBLIC_ORIGIN=https://<dominio-frontend>`. Las cookies `__Host-planes.sid` son
Secure, HttpOnly, SameSite=Lax, sin Domain y duran dos horas. Redirección HTTP a
origen fijo, rechazo de escrituras HTTP y HSTS. No exponer el puerto del frontend
saltándose el proxy HTTPS. `/health/ready` queda disponible para el healthcheck
de la plataforma y no devuelve datos institucionales. Las sesiones se almacenan
en `web_sessions`; el frontend no puede consultar tablas de usuarios o negocio.
Si MySQL o su tabla faltan, el frontend no arranca; no usa MemoryStore como respaldo.
El comportamiento local sin el perfil permanece igual.

## Esquema limpio e inicialización explícita

Se reutiliza `schema/through-block-f.sql` y su manifiesto SHA256: los bloques C–F
ya están incluidos; no volver a ejecutar sus migraciones históricas encima.
Se añade `deployment/railway/web-sessions.up.sql` exclusivamente a la base cloud.
Resultado: 44 tablas, 86 relaciones, 20 disparadores; ningún usuario ni registro
institucional. Únicamente se inserta el mutex técnico de autorización.

`deployment/railway/initialize-empty.mjs` verifica por la misma conexión: hostname
privado, puerto 3306, nombre exacto y cero tablas. Verifica también el manifiesto.
Crea cuentas técnicas nuevas separadas y consultas parametrizadas. No puede
seleccionar `planes_accion_test`. No se invoca desde `npm start`.

MySQL exige privilegio `TRIGGER` para que el backend pueda consultar los metadatos
usados por sus controles existentes. Se concede solo sobre sus tablas de negocio,
junto con DML; no se concede CREATE/ALTER/DROP de tablas. La cuenta frontend solo
tiene DML sobre `web_sessions`. Estos son privilegios de cuentas técnicas nuevas,
no cambios en roles o capacidades de usuarios de la aplicación.

Una vez autorizados los recursos y el primer despliegue, configurar por una sola
vez el pre-deploy del backend con:

```text
node deployment/railway/initialize-empty.mjs --initialize-new-railway-test
```

Para ese único paso: `RAILWAY_ENVIRONMENT_NAME=private-test`, `BOOTSTRAP_DB_USER`
y `BOOTSTRAP_DB_PASSWORD` de administración de la base NUEVA, además de las
variables normales y `SESSION_DB_PASSWORD` de la cuenta técnica frontend. No
usar credenciales locales ni comerciales. La base debe haberse creado con el
nombre exacto indicado, antes de inicializarla. Después del éxito, retirar el
pre-deploy y las variables BOOTSTRAP y SESSION_DB_PASSWORD del backend; conservar
esta última solo en el frontend. El inicializador no es idempotente: si el esquema
no está vacío, cancela. Un segundo despliegue requiere haber quitado ese pre-deploy.

DDL no es transaccional en MySQL. Ante un fallo, conservar estado y diagnóstico;
no reintentar sobre esquema parcial, no ejecutar DOWN ni restauraciones automáticas.
En cloud nuevo vacío, su recreación necesita revisión/autorización del propietario.

La primera cuenta y su asignación autorizada siguen pendientes: no existe bootstrap
administrativo cloud aprobado. El inicializador no copia la cuenta local ID 78,
no genera contraseñas ni concede roles institucionales. No usar el bootstrap de
desarrollo para habilitar autoridades en Railway. El login público solo permitirá
entrar cuando se aprovisione una identidad de prueba autorizada por un procedimiento
independiente. Las pruebas automáticas crean sus propias cuentas sintéticas solo
en MySQL desechable y las eliminan con ese entorno.

## Evidencias

Crear volumen privado del backend, montado exactamente en `/data/evidence`.
Railway debe proporcionar `RAILWAY_VOLUME_MOUNT_PATH`; no simularlo en un
contenedor sin volumen. El arranque comprueba también el montaje real en Linux.
No hay ruta estática pública. Se conservan autorización, límite binario 10 MiB,
MIME/extensión/contenido, UUID, SHA256 y trazabilidad; la compatibilidad Base64
anterior mantiene su límite de 64 KiB. No importar evidencias reales.

Antes de permitir cargas, habilitar y ensayar recuperación conjunta de MySQL y
su volumen de evidencias; una copia de SQL no contiene los archivos. El volumen
resuelve persistencia entre despliegues, no reemplaza un respaldo. No escalar el
backend a varias réplicas con ese almacenamiento local.

## Publicación, solamente después de autorización

No hay Railway CLI instalado ni sesión accesible desde esta ejecución. El usuario
debe autorizar proyecto/workspace, región, presupuesto y publicación antes de los
pasos siguientes. No ejecutar comandos con valores secretos en argumentos.

1. Crear proyecto NUEVO `planes-accion-private-test`, entorno `private-test`,
   tres servicios anteriores y sus volúmenes. Desactivar autodeploy desde GitHub;
   no enlazar proyectos existentes ni producción. Configurar MySQL sin exposición
   pública y crear la base vacía con el nombre indicado.
2. Cargar variables privadas de las plantillas. Backend con volumen y pre-deploy
   inicializador; ambos servicios con `/health/ready`, timeout 90 s, una réplica y
   Dockerfile de su propio repositorio. No ejecutar migraciones en la construcción.
3. Instalar/autenticar CLI manualmente según documentación oficial. Desde cada
   repositorio enlazar exclusivamente el proyecto/entorno nuevos; revisar `status`.
   Los comandos de subida siguientes publican código y NO se ejecutaron aquí:

```powershell
Set-Location 'C:\Users\erick\OneDrive\Documentos\Proyecto Final\proyecto backend erick'
$railwayProjectId = 'REEMPLAZAR_CON_ID_NUEVO_AUTORIZADO'
railway login
railway link --project $railwayProjectId --environment private-test --service backend
railway status
railway up --project $railwayProjectId --environment private-test --service backend
# Tras inicialización correcta, quitar pre-deploy y secretos de administración.
Set-Location 'C:\Users\erick\OneDrive\Documentos\Proyecto Final\proyecto fronted erick'
railway link --project $railwayProjectId --environment private-test --service frontend
railway status
railway up --project $railwayProjectId --environment private-test --service frontend
```

4. Generar dominio Railway únicamente para frontend y fijar su URL HTTPS como
   `PUBLIC_ORIGIN` antes de aceptar tráfico. No habilitar dominios para backend ni
   MySQL. Proveer la cuenta de prueba mediante procedimiento autorizado pendiente.
5. Verificar HTTPS/cookie, acceso por permisos, sesión tras reinicio, formularios,
   descarga autorizada y persistencia de evidencia sintética; después eliminar los
   datos sintéticos por un procedimiento autorizado, sin tocar datos reales.

`railway up` respeta `.gitignore` y `.railwayignore`; no usar `--no-gitignore`.
Revisar el paquete antes de subir: no debe contener `.env`, respaldos, evidencias,
test-db, tokens ni claves. Los Dockerfiles usan `npm ci` y lockfiles; no hay build
frontend adicional. No es necesario push para desplegar código local autorizado.

También se entrega `deployment/railway/railway.ts.example` como manifiesto opcional
de infraestructura, en un espacio de despliegue separado. No altera el stack JS/EJS.
No instala el SDK ni configura fuentes GitHub o dominios automáticamente. Requiere
validación con SDK/CLI vigente y variables selladas existentes antes de `config plan`;
no se aplicó. No se genera `railway.json` obsoleto para servicios nuevos.

Referencias: [CLI y tratamiento de archivos](https://docs.railway.com/cli/up),
[IaC actual](https://docs.railway.com/infrastructure-as-code).

## Costos y límite de esta entrega

Requieren autorización: proyecto cloud, ejecución de tres servicios, CPU/RAM,
volúmenes MySQL/evidencias, respaldos y tráfico saliente; configurar presupuesto
y alertas antes de desplegar. No se ha contratado ningún recurso. Consultar la
[tarifa vigente](https://docs.railway.com/pricing) del workspace; esta preparación
no garantiza un importe mensual ni que la prueba sea gratuita.

Pendientes externos: instalar/conectar Railway, validar el manifiesto opcional,
crear recursos autorizados, inicializar cloud, provisionar identidad autorizada,
emitir dominio y verificar TLS/red privada/respaldo en Railway real. No existe
una dirección web nueva todavía. Esto prepara una prueba privada, no certifica
producción ni habilita publicación oficial o decisiones institucionales.

## Verificación local reproducible

```powershell
# Backend: Docker Desktop activo; crea y limpia exclusivamente recursos propios.
node test-db/verify-railway.mjs --railway-simulation
```

Usa MySQL 8.4 desechable sin puerto de base publicado y cuentas sintéticas.
Prueba el inicializador real, Dockerfiles, autenticación scrypt/JWT, RBAC, CSRF,
formularios, seguimiento provisional, evidencias persistentes, informes y consultas
de Control Interno. Simula el encabezado HTTPS de un proxy confiable para verificar
las cookies: no sustituye una prueba del certificado o red privada de Railway.
Los puertos auxiliares son 3016 y 4016; 3000/4000 y `planes_accion_test` permanecen
ajenos a la simulación. Resultados de esta ejecución se registran al finalizar.

### Resultado obtenido

Ejecución final `planes-cloud-098e933944`: **47 comprobaciones aprobadas**, limpieza
completa de sus propios contenedores y volúmenes. Se conservaron los recursos
Docker anteriores. Evidencia técnica local ignorada por Git:
`test-db/railway-check.tmp/result-098e933944.json`.

Se construyeron ambas imágenes con sus lockfiles. El esquema original de 43 tablas
se instaló en MySQL 8.4 y la tabla de sesiones elevó el total a 44; permanecieron
86 claves foráneas y 20 disparadores. Antes de crear fixtures no había cuentas ni
datos institucionales, solo el mutex técnico. Se validaron login scrypt, JWT,
capacidades, denegación RBAC, formularios con CSRF, creación sintética de plan y
actividad, seguimiento provisional, carga/descarga de evidencia, sesión después
de reiniciar frontend y evidencia después de reiniciar backend. Diez rutas EJS,
CSV y página imprimible para PDF respondieron correctamente. El usuario SQL del
frontend no puede leer usuarios. Se verificaron 403 para escritura de Control
Interno, publicación oficial y aprobación de seguimiento; logout invalida acceso.

Pruebas focalizadas: **48 backend y 17 frontend aprobadas**, incluidas siete
nuevas de los perfiles, destinos rechazados y HTTPS. La revisión de dependencias
detectó avisos de seguridad y justificó ampliar la regresión después de corregirlos:
suite completa **427 backend + 202 frontend = 629 aprobadas**, cero fallos.
También se repitió la simulación con los lockfiles finales: 47/47.
`npm audit --omit=dev`: cero vulnerabilidades reportadas en ambos lockfiles.
Se actualizaron body-parser 2.4.0, proxy-addr 2.0.8, qs 6.17.1 y mysql2 3.24.6
dentro de la compatibilidad del stack. El store 3.0.3 fijaba mysql2 antiguo:
se añadió un override explícito a 3.24.6. No se actualizó Express a otra versión.
Sintaxis de las nuevas utilidades y `git diff --check` verificados.
La primera ejecución detectó truncamiento de GROUP_CONCAT del comprobador en
MySQL; se corrigió el comprobador. La segunda identificó falta de visibilidad
de disparadores de la cuenta técnica; se añadió el privilegio documentado y la
ejecución final terminó correctamente. Ningún intento usó la base local persistente.

### Archivos de esta preparación

Backend: `index.js`, `app/config/railway-profile.js`, `package-lock.json`, `.dockerignore`,
`.railwayignore`, `deployment/railway/backend.variables.example`,
`deployment/railway/initialize-empty.mjs`, `deployment/railway/web-sessions.up.sql`,
`deployment/railway/railway.ts.example`, `test/railway-profile.test.js`,
`test-db/verify-railway.mjs`, este documento y referencias en README e
`INSTITUTIONAL_REPORTS.md`.

Frontend: `index.js`, `app/services/railway-profile.js`, `package.json`,
`package-lock.json` (express-mysql-session 3.0.3 y dependencias transitivas),
`.dockerignore`, `.railwayignore`, `deployment/railway/frontend.variables.example`,
`test/railway-profile.test.js`, README y `REVISION_VISUAL.md`.

No se modificaron las vistas ni los estilos, los Dockerfiles ni los cálculos,
roles o permisos de la aplicación. La base local, credenciales, respaldos y
procesos originales no participaron en las pruebas ni se reiniciaron. No hubo
commit, push, merge, publicación ni gasto cloud. Las imágenes base y la caché
de construcción se conservaron; las imágenes temporales de aplicación se limpiaron.

El frontend tiene archivos de `node_modules` versionados de antes. Se conservaron
sin cambios en Git: no se incluyeron actualizaciones de dependencias vendorizadas
en esta entrega ni se alteró el índice. Railway y Docker los excluyen y construyen
desde package-lock con npm ci. Para reproducir las versiones corregidas, usar
una instalación limpia/Docker, no esos archivos históricos. Su retirada futura
del control de versiones queda separada de este alcance.

Comprobación final del entorno original: backend PID 74584 y frontend PID 27328
siguen escuchando en 3000 y 4000; GET backend `/` y frontend `/` responden 200;
frontend `/menu` sin sesión redirige a `/` (302), como corresponde. GET `/login`
no es una página de acceso de esta aplicación: devuelve 404; el acceso es `/`.
El contenedor MySQL local existente continúa saludable; no se consultó ni migró
su base en esta preparación. No quedan recursos de la simulación final.

# Instalación y configuración

Guía vigente al 03/11/2026 para una instalación **nueva** o copia autorizada.
No ejecutar sobre los servicios actuales ni sobrescribir sus archivos locales.
No certifica producción. Referencia probada: Node.js v22.20.0 y MariaDB 10.4.32.

## Dependencias

Conservar las carpetas backend/frontend y los archivos raíz. No distribuir
`node_modules`, secretos, respaldos o evidencias como código. En cada carpeta:

```powershell
npm.cmd ci --no-audit --no-fund
```

En otros shells usar `npm`. En este equipo `npm.ps1` está bloqueado; `npm.cmd`
funciona sin modificar la política de ejecución. Añadir `--offline` solo si la
caché está disponible. No reemplazar el lockfile para sortear fallos.
K probó instalaciones inicialmente vacías con `npm ci --offline`: 92 paquetes
backend y 81 frontend, importaciones principales correctas y lockfiles intactos.
Aviso no bloqueante: `node-domexception` transitivo está deprecado; no se actualizaron
dependencias para silenciarlo.

## Variables y ejecución local

Solo en una instalación nueva, en cada carpeta:

```powershell
if (Test-Path -LiteralPath .env.local) { throw 'Revisar archivo existente; no sobrescribir' }
Copy-Item -LiteralPath .env.example -Destination .env.local
```

Completar los secretos mediante un mecanismo privado, sin imprimirlos ni incluirlos
en Git, capturas o tickets. `.env.local` sigue ignorado; `.env.example` contiene
secretos vacíos. Backend:

| Variable | Uso |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Destino y cuenta autorizados; sin credenciales comerciales para ensayos. |
| `JWT_SECRET` | Base64URL aleatorio de al menos 32 bytes, según el validador existente. |
| `NODE_ENV=development` | Entorno local; las rutas funcionales no dependen del flag administrativo. |
| `ENABLE_ROLE_PERMISSION_ROUTES=true` | Habilita asignaciones, revocaciones y decisiones de roles; requiere `ROLE_APPROVAL_WINDOW_MS`. El catálogo de roles/permisos tiene sus propios controles de autorización y no necesita este flag. Tampoco se necesita para Planes, Actividades, Seguimiento, Informes o Control Interno. |
| `ROLE_APPROVAL_WINDOW_MS` | Entero positivo de la política aprobada; no deducir un valor institucional. |
| `PORT`, `APP_HOST` | 3000 y loopback en la plantilla local. |
| `EVIDENCE_STORAGE_DIR` | Opcional, ruta privada absoluta; omitir para usar `storage/evidence`. |

Frontend: `SESSION_SECRET`, `PORT=4000`, `APP_HOST=127.0.0.1`,
`BACKEND_API_URL=http://127.0.0.1:3000/api`, `APP_TIME_ZONE=America/Bogota`.
Login y verificación de sesión comparten esa API. No poner tokens en URL.

En terminales separadas, primero backend y después frontend:

```powershell
npm.cmd run start:local
```

Este script exige `.env.local`. `npm start` y `npm run dev` conservan la ejecución
con entorno ya preparado; el script nuevo no modifica su comportamiento. Las
variables heredadas prevalecen. La configuración activa puede diferir del `.env`
general: **no cambiarla como consecuencia de leer esta guía**.

Para reiniciar el entorno local que ya utiliza `.env`, detén las instancias actuales
desde sus terminales con `Ctrl+C`. En una terminal para cada servicio:

```powershell
Set-Location 'proyecto backend erick'
$env:NODE_ENV = 'development'
Remove-Item Env:ENABLE_ROLE_PERMISSION_ROUTES -ErrorAction SilentlyContinue
Remove-Item Env:ROLE_APPROVAL_WINDOW_MS -ErrorAction SilentlyContinue
npm.cmd run dev
```

```powershell
Set-Location 'proyecto fronted erick'
node --env-file=.env index.js
```

No habilites `ENABLE_ROLE_PERMISSION_ROUTES` para recuperar los módulos funcionales.

## Base de datos e instalación reproducible

Para recuperar datos existentes, restaurar un respaldo autorizado primero en una
base vacía aislada y verificarlo. No aplicar baseline o UP históricos sobre esa
restauración; véase `OPERACION_Y_RECUPERACION.md`.

Para estructura nueva vacía: `schema/through-block-f.sql` contiene 43 tablas,
86 FK y 20 disparadores hasta F, sin registros, cuentas, concesiones, secretos,
definers del servidor ni próximos valores AUTO_INCREMENT del origen. El JSON
acompañante contiene huella y definiciones. Comprobar nombre/destino y cero tablas
en un cliente autorizado antes de `SOURCE schema/through-block-f.sql`.
**Nunca aplicarlo a `planes_accion_test` o una base existente.** No contiene DML
ni DROP; fallar ante tablas existentes no sustituye la comprobación del destino.

Prueba reproducible y acotada desde backend:

```powershell
node test-db/verify-installation.mjs --disposable-3307
```

Usa `test-db/.env.test` local ignorado, crea solo una base aleatoria `planes_install_*`
en 127.0.0.1:3307, instala/verifica con FK habilitadas y la elimina. K comprobó
43 tablas/86 FK/20 disparadores/cero registros y conservación íntegra de la fuente.
No ejecuta migraciones persistentes ni genera un respaldo adicional.

El baseline no provisiona cuentas, catálogo de permisos, asignaciones ni registro
operativo del mutex. No habilita por sí solo una sesión administrativa. Para una
organización nueva, el aprovisionamiento inicial debe seguir el procedimiento
autorizado y las definiciones ya aprobadas; no se copiaron roles ni crearon cuentas
para resolverlo en K. No repetir C/D/E/F después del baseline.

## Docker preparado, no desplegado

Dockerfiles con `npm ci --omit=dev` y `npm start`. Compose exige destino/secretos,
usa `http://backend:3000/api` para el BFF, publica solo en loopback y declara un
volumen privado de evidencias. **No crea ni migra MySQL.** El destino debe ser
accesible desde esa red; localhost del contenedor no identifica al MySQL del host.

En una instalación nueva, completar una copia privada de
`docker-compose.env.example` fuera del control de versiones. Desde la raíz:

```powershell
docker compose --env-file RUTA_PRIVADA config --quiet
# Solo en un entorno nuevo autorizado y sin conflicto con los servicios actuales:
docker compose --env-file RUTA_PRIVADA up --build -d
```

`stop` conserva contenedores; `start` reanuda. No retirar volúmenes/recrear servicios
con datos sin respaldo. `depends_on` no acredita disponibilidad de MySQL/API.
K validó inicialmente solo la configuración. La verificación final posterior
construyó ambas imágenes y ejecutó un entorno separado con MySQL desechable,
puertos 3015/4015 y datos exclusivamente sintéticos, con los resultados siguientes.
Producción/HTTPS/sesiones persistentes continúan pendientes; el bootstrap vigente
rechaza habilitar rutas de roles bajo `NODE_ENV=production`.

### Resultado de la verificación Docker final — 03/11/2026

Docker Desktop disponible: contexto `desktop-linux`, Engine 29.7.2 y Compose v5.5.1.
Se utilizaron los Dockerfiles existentes sin modificar código funcional ni
dependencias. Imagen DB: `mariadb:10.4.32`; Node de la imagen `node:22`: v22.23.4.
La etiqueta base es mutable: registrar la revisión/digest aprobado al preparar
una entrega; esta prueba no certifica automáticamente futuras reconstrucciones.

**44 comprobaciones aprobadas:** construcción de ambas imágenes, red entre
frontend/backend/DB, instalación del baseline vacío (43 tablas, 86 FK, 20
disparadores), autenticación scrypt/JWT y sesión real del BFF, denegación a cuenta
sin permisos, diez rutas principales, plan creado con CSRF, actividad, seguimiento
pendiente, evidencia privada con descarga idéntica, informe analítico, CSV y página
de impresión autorizados. CI, publicación y aprobación de seguimiento siguieron
bloqueados. No se repitieron las suites históricas ni la matriz visual.

El único ajuste de arranque fue en el descriptor del ensayo: `mariadb-admin ping`
aceptaba disponibilidad antes de acreditar una consulta autenticada y el cliente
recibía acceso denegado durante la inicialización. Se sustituyó por `SELECT 1`
autenticado por TCP antes de iniciar la aplicación. No se cambiaron contraseñas
para sortear el fallo. Dos intentos iniciales se retiraron; el tercero completó
el ensayo y la limpieza. El Compose habitual no se ejecutó sobre los puertos actuales.

Repetición acotada, solo cuando se necesite validar otra revisión:

```powershell
# Desde backend, con sus dependencias y Docker Desktop disponibles;
# requiere 3015/4015 libres. No detener servicios ajenos para liberarlos.
node test-db/verify-docker.mjs --isolated-docker
```

La utilidad genera proyecto/etiquetas únicos, una red y dos volúmenes nuevos. No
publica el puerto de MySQL ni conecta a `planes_accion_test`. Las cuentas/relaciones
RBAC son fixtures en esa DB nueva; no existe un bootstrap administrativo automático
para instalaciones reales. El ensayo retira sus contenedores, volúmenes, red y
etiquetas de aplicación, preservando recursos preexistentes. Las imágenes base y
caché de construcción se conservan; no ejecuta prune.

Evidencia local ignorada: `test-db/docker-final.tmp/result-202e2c4678.json`,
`build-202e2c4678.log` y el descriptor generado `compose-202e2c4678.yml`, sin
secretos guardados. El descriptor usa referencias a variables efímeras; las claves
no se escribieron en él. La utilidad mantenida pasó comprobación de sintaxis,
importaciones y su modo de descifrado sintético; el ensayo completo se ejecutó
con su precursor equivalente dentro del directorio temporal. No se repitió el
ciclo completo solo por mover esa utilidad al directorio versionable.

Sistema original: el contenedor preexistente conserva su ID y los procesos
3000/4000 conservaron PID 74584/27328. No se utilizó ni consultó la base persistente
durante este ensayo. El recuento 43 tablas/171 registros corresponde a la última
verificación K; no se presenta como un recuento nuevo de esta actividad.

## Diagnóstico inicial

Desde backend: `npm.cmd run check:local`. Revisar `OPERACION_Y_RECUPERACION.md`.

| Síntoma | Revisión segura |
|---|---|
| Falta variable/secreto | Existencia y formato en entorno efectivo, sin imprimir valores. |
| Puerto ocupado | Identificar PID/directorio; no terminar todos los procesos Node. |
| MySQL no conecta | Host/puerto/base autorizados y red; no cambiar a otra base para probar. |
| Login vuelve al acceso | Coincidencia de `BACKEND_API_URL` de login/sesión; no sortear JWT. |
| 403 | Capacidad vigente/bloqueo esperado; no ampliar permisos. |
| F no disponible | Revisar estructuras; nunca migrar automáticamente. |
| Offline sin caché | Usar registro/red autorizados en copia, manteniendo lockfile. |

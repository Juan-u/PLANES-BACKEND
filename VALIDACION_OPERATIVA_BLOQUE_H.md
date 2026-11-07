# Bloque H — ensayo de activación e integración autenticada

Fecha: 03/11/2026, America/Bogota. Backend y frontend en `develop`.

## Resultado y alcance

**Ensayo completado; F no se migró a la base persistente.** Se restauró una copia
completa de `127.0.0.1:3307/planes_accion_test`, se aplicó únicamente UP F a esa
copia y se probaron procesos reales separados en 3010/4010 con sesiones reales.
La copia y todos sus datos sintéticos se eliminaron al terminar. No se reiniciaron
los procesos originales: backend PID 40988/3000 y frontend PID 20728/4000.

Fuente antes y después: **39 tablas y 171 registros**, comparando cada contenido,
definiciones, disparadores, rutinas y eventos. Los datos anteriores de la copia
también se conservaron íntegros durante las operaciones nuevas. No cambiaron
credenciales, asignaciones, permisos o cálculos de la fuente.

## Respaldo recuperable

Directorio local ignorado: `test-db/activation-blockh.tmp/`.

- Respaldo exitoso: `complete-2026-11-03T13-38-38-642Z.sql.dpapi`.
- Archivos privados: `evidence-2026-11-03T13-38-38-642Z.json.dpapi`;
  el almacenamiento original contenía cero archivos físicos.
- Manifiesto: `activation-2026-11-03T13-38-38-642Z.json`.

Cifrado Windows DPAPI CurrentUser. Se descifró en memoria, verificó integridad y
restauró todo el SQL en una base desechable; estructura, registros y objetos se
compararon antes de ejecutar el UP. Se conservaron asimismo los respaldos nuevos
de los dos intentos previos; no se sobrescribió ninguno. La recuperación requiere
el perfil Windows original. El PDF conservado es exclusivamente sintético.

## Migración F

UP y DOWN revisados: `20261104_reports_control.*.sql`. Solo el UP se ejecutó en la
restauración; el ejecutor H rechaza explícitamente aplicarlo a la fuente. Cuatro
tablas nuevas, ocho relaciones y cuatro disparadores, con definiciones compatibles
con los servicios actuales. Las cuatro prohibiciones UPDATE/DELETE se probaron
realmente sobre filas sintéticas de eventos CI y generación de informes, obteniendo
el rechazo esperado. No se ejecutó DOWN ni se habilitó autoridad institucional.

La restauración migrada quedó con 43 tablas antes de introducir datos de prueba;
los 171 registros originales permanecieron íntegros. Las relaciones FK y estados
mantienen las restricciones del esquema; no se desactivaron para las operaciones
autenticadas. El directorio de respaldo y manifiesto permanece; la base del ensayo
fue eliminada mediante su nombre aleatorio verificado.

## Pruebas ejecutadas

**59 comprobaciones operativas aprobadas**, con JWT emitidos por login real y
sesión del frontend creada mediante el formulario en Edge, sin fabricar tokens:

- Cuenta sintética administrativa y cuenta sintética sin permisos; scrypt oficial
  y credenciales aleatorias solo en memoria. No se inició sesión con una cuenta
  original. Las credenciales no se entregaron ni guardaron en archivos.
- Capacidades vigentes reales; usuario restringido denegado en usuarios/informes.
- Creación y actualización de un usuario nuevo por API autorizada; asignación
  efectiva de un rol ordinario **ya existente** por el endpoint real. No se cambió
  ninguna definición de rol/permiso ni se reasignaron cuentas originales.
- Formulario autenticado de plan con objetivo general, específico e indicador;
  actividad con objetivo, responsable y ficha institucional. Fechas inválidas
  rechazadas, manteniendo los datos de recuperación, sin guardar esa actividad.
- Seguimiento registrado como pendiente; historial y observaciones visibles.
  Evidencia binaria subida y descargada por rutas privadas reales.
- Informe con filtros, detalle que conserva plan y período, separación entre datos
  aprobados/provisionales y carácter analítico. Promedio 50 y cobertura 2/3 según
  el servicio oficial, usando referencias históricas **sintéticas** 0/100 y un
  envío pendiente. No se ejecutaron aprobaciones para obtener esas referencias.
- CSV real a través del BFF con CSRF y vista de impresión autorizada; Edge produjo
  un PDF real. Generaciones registradas por el servicio en la copia.
- Consulta CI de hallazgo, recomendación, respuesta e historial sintéticos. Los
  datos de ejemplo se prepararon únicamente en la copia; sus endpoints de escritura
  permanecieron cerrados. No se simula con ello una actuación institucional válida.
- Aprobación/rechazo de seguimiento, cierre, verificación institucional de evidencia,
  escritura CI, publicación y aprobación/recepción/devolución de plan: rechazados.
- Cierre normal de sesión y rutas frontend protegidas; cero excepciones JavaScript.

Preparación de autenticación: la fuente solo dispone de un rol privilegiado de
acceso amplio y otro ordinario restringido. Para el administrador sintético se
introdujeron en la copia relaciones sintéticas completas de asignación, solicitud
y decisión con actores nuevos separados, reproduciendo los requisitos del rol
privilegiado existente. **Es una fixture de autorización inicial**, no una prueba
del proceso real de aprobación de roles ni una modificación de la política. Las
comprobaciones posteriores utilizaron el SQL RBAC y middleware reales, sin mocks.

Automatizadas tras la corrección: **418 backend y 194 frontend = 612 aprobadas**.
Incluyen regresiones de autenticación, permisos, formularios, cálculos e informes,
validación de puertos/URL y uso coherente del backend al verificar la sesión.
`git diff --check`: sin errores de espacios; permanecen avisos previos de CRLF.
No se repitió la matriz visual completa de G: aquí se verificó navegación real,
contenido autenticado, errores JavaScript y PDF; no se certifica una nueva matriz
visual por cada resolución.

## Error real corregido y archivos

El frontend permitía configurar el destino de login para el ensayo, pero la
verificación de sesión seguía apuntando a 3000; el backend original rechazaba
correctamente el JWT de la instancia paralela. Ahora ambos usan la misma URL
validada. No se modificó la comprobación JWT, scrypt, permisos ni duración de sesión.

- Backend: `app/config/runtime.js`, `index.js`, `test/auth/runtime-config.test.js`.
- Frontend: `app/services/runtime-config.js`, `index.js`,
  `app/controllers/controller.views.js`, `app/middleware/auth.middleware.js`,
  `test/runtime-config.test.js`, `test/auth/configured-session.test.js`.
- Herramientas locales ignoradas: `test-db/activation-blockh.tmp/rehearse.mjs` y
  `operations.mjs`. En el backend, `node test-db/activation-blockh.tmp/rehearse.mjs`
  repite respaldo/ensayo **sin migrar la fuente**, crea cuentas únicamente en la
  copia y detiene sus procesos. No es un activador persistente.
- Documentación: este informe, `INSTITUTIONAL_REPORTS.md`, `REVISION_VISUAL.md` y
  `ARQUITECTURA.md`.

Configuración nueva, sin editar `.env`: `PORT` (3000 backend/4000 frontend por
defecto), `APP_HOST` (0.0.0.0 por defecto) y `BACKEND_API_URL` (frontend, por defecto
`http://localhost:3000/api`). Para el ensayo se usaron 3010, 4010, 127.0.0.1 y
`http://127.0.0.1:3010/api`. Puertos fuera de rango y URL con credenciales, query,
fragmento, protocolo no HTTP o ruta diferente de `/api` se rechazan al iniciar.
Cada proceso tuvo secretos nuevos en memoria y el backend apuntó solo a la copia.

Perfil Edge y archivos de evidencia sintéticos retirados con rutas verificadas.
Solo siguen escuchando los procesos originales en 3000 y 4000. No se instalaron
dependencias, ejecutó commit/push/merge ni realizó despliegue.

## Activación persistente pendiente: procedimiento exacto

**No ejecutar los siguientes pasos sin autorización expresa para migrar
`planes_accion_test`.** H no la concede. Al autorizarse:

1. Confirmar procesos/configuración efectiva, `develop`, código F/G/H y destino
   externo `127.0.0.1:3307/planes_accion_test`. Crear un respaldo cifrado **nuevo**,
   restaurarlo y comparar nuevamente; el ensayo ya realizado no sustituye esa
   verificación del estado que exista en el momento de activar.
2. Confirmar ausencia de las cuatro tablas F y huella del UP ensayado. Si existe
   una migración parcial o cambió el contenido, detenerse antes de ejecutar SQL.
3. Desde la carpeta backend, abrir un cliente interactivo local autorizado:

   ```powershell
   mariadb --protocol=TCP --host=127.0.0.1 --port=3307 --user=CUENTA_AUTORIZADA --password --database=planes_accion_test
   ```

   Introducir su contraseña solo en el prompt privado del cliente, nunca como
   argumento. Verificar `status` y `SELECT DATABASE();`. El servidor Docker puede
   declarar 3306 internamente; la conexión del cliente debe ser externa a 3307.
   Confirmar el esquema y los conteos exactos contra el manifiesto del respaldo.
4. Solo con todas las comprobaciones correctas, ejecutar en ese cliente:

   ```sql
   SOURCE migrations/20261104_reports_control.up.sql;
   ```

   Detenerse ante cualquier error. No reintentar sobre una migración parcial.
   Comparar datos previos y definiciones; deben conservarse las 39 tablas/171
   registros, salvo un cambio previo expresamente verificado, y añadirse cuatro
   tablas vacías, ocho FK y cuatro disparadores. No ejecutar DOWN automático.
5. Reiniciar controladamente los procesos 3000/4000 conservando sus entornos
   efectivos y verificando de nuevo el destino. No sustituirlos por los entornos
   con root, secretos efímeros o base aleatoria usados en el ensayo.
6. Verificar rutas y una sesión normal autorizada en
   `http://localhost:4000/informes/institucional`, sin crear datos permanentes ni
   habilitar autoridades. Exportar crea un registro legítimo de generación: si se
   requiere una activación sin ninguna escritura funcional, limitarla a consulta.

Pendientes reales: migración persistente y reinicio autorizados; validación de esa
instancia con las cuentas del usuario; definición de autoridades aún no configuradas
para actuaciones restringidas. No se probaron aprobaciones exitosas de planes,
seguimientos o CI: su denegación es el comportamiento esperado, no un fallo.

Siguiente bloque recomendado: activación persistente F/G/H con autorización
expresa, respaldo nuevo restaurable y verificación autenticada de solo lectura.
Si falla algo, conservar respaldos y estado, preparar restauración en otra copia
y revisar recuperación; nunca sobrescribir la fuente ni ejecutar DOWN por iniciativa.

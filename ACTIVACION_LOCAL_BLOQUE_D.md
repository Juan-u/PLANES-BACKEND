# Activación local del Bloque D

Fecha: 2026-11-02, America/Bogota. Rama `develop` en ambos repositorios.
Estado: **activado exclusivamente en el entorno aislado; actuaciones institucionales cerradas**.

## Destino, respaldo y migración

Se verificaron el proceso backend activo, su configuración efectiva y el contenedor
`planes-action-test-planes-accion-db-test-1`, publicado solo en `127.0.0.1:3307`.
Antes de cada sentencia de migración, la misma conexión confirmó:
`127.0.0.1:3307/planes_accion_test`. No se utilizó el `.env` general para migrar.

Se creó un **respaldo completo nuevo**, posterior a la activación C, con estructura,
datos y definiciones de vistas, triggers, rutinas y eventos existentes. Se conserva
cifrado con Windows DPAPI `CurrentUser`, sin SQL en texto plano:

- `test-db/activation-blockd.tmp/complete-2026-11-03T01-32-49-633Z.sql.dpapi`
- Manifiesto: `test-db/activation-blockd.tmp/activation-2026-11-03T01-32-49-633Z.json`

Se releyó y descifró el archivo guardado, se comprobó su SHA256 y se restauró en
una base nueva del mismo servidor aislado. Todas sus definiciones y registros
coincidieron exactamente con el origen. UP se ensayó primero en esa restauración;
después se comprobó nuevamente que el origen no había cambiado.

Se aplicó únicamente `migrations/20261103_plan_workflow.up.sql`, sin modificaciones:

- Tablas `plan_flujo` y `plan_flujo_evento`.
- Triggers `plan_flujo_evento_no_update` y `plan_flujo_evento_no_delete`.
- Cuatro claves foráneas y la unicidad de revisión definidas por el mismo UP.

El SHA256 del SQL y los de los componentes backend/frontend relevantes quedaron
en el manifiesto y se volvieron a verificar antes de ejecutar UP. La composición
del router se comprobó cerrada: `createPlanWorkflowService({pool})` conserva
`CLOSED_AUTHORITY`, sin adaptadores institucionales habilitados.

Las **30 tablas anteriores y sus 171 registros** conservaron exactamente sus datos
y definiciones. El resultado completo coincidió con el ensayo de restauración,
incluidos ambos triggers nuevos. Tras las pruebas finales se repitió la comparación
de todos los registros: siguen idénticos y las dos tablas D permanecen vacías.
No se incorporaron planes al flujo ni se crearon registros permanentes de prueba.
No se ejecutó DOWN. La base temporal de restauración se eliminó; el respaldo queda
conservado en una carpeta `.tmp` ignorada por Git.

## Procesos locales

Se identificaron ejecutable, directorio y punto de entrada de ambas instancias.
Se reiniciaron exclusivamente esos dos procesos, conservando su entorno efectivo
en memoria, sin imprimir ni guardar sus secretos y sin editar `.env`:

| Servicio | PID anterior | PID actual | Puerto |
|---|---:|---:|---:|
| Backend | 64168 | 56968 | 3000 |
| Frontend | 37904 | 20632 | 4000 |

Los registros de inicio y las respuestas HTTP confirman que ambos iniciaron bien.
Después del reinicio se verificaron otra vez sus puertos y el destino efectivo del
backend: host `127.0.0.1`, puerto `3307`, base `planes_accion_test`, usuario aislado
`planes_test`, entorno development y las rutas locales ya habilitadas.
No se detuvo MySQL ni Docker. Las sesiones del frontend estaban en memoria y se
vaciaron al reiniciar: el usuario debe iniciar sesión nuevamente.

## Comprobaciones

- **361 pruebas backend y 168 frontend aprobadas**, cero fallos.
- **23 comprobaciones HTTP no destructivas**: raíz backend/login/recursos estáticos
  responden 200; API C/D sin JWT responden 401; los módulos web C/D sin sesión
  redirigen al acceso. El script y los estilos servidos incluyen D.
- Conexión de aplicación `planes_test`: lectura real de Planes, Actividades y
  catálogo C, consulta de bandeja, expediente, faltantes e historial D y renderizado
  EJS con datos existentes, correctos. El catálogo confirma disponibilidad D.
- Las cuatro claves foráneas D y ambos triggers de historial fueron verificados.
- Cuenta de revisión ID 78: activa, con sus permisos anteriores intactos.
- El servicio real, con su composición cerrada y una conexión limitada a SELECT
  por el comprobador, rechazó **presentar, recibir, observar, devolver y aprobar**
  con `AUTHORITY_NOT_CONFIGURED` (403), incluso con esa cuenta y con falsas
  afirmaciones de autoridad en el cuerpo. Ninguna actuación produjo escritura.
- Todos los controles de actuaciones devueltos por el servidor aparecen deshabilitados.
- Las huellas finales de todos los registros coinciden con el respaldo/ensayo.

Las lecturas internas autorizadas y las comprobaciones HTTP son verificaciones
separadas. No se fabricó JWT ni sesión web, no se utilizaron contraseñas y no se
enviaron formularios autenticados de guardado. La revisión HTTP con una sesión
iniciada por el usuario queda pendiente; no se presenta como realizada.

## Funcionalidades disponibles y límites

Después de iniciar sesión en `http://localhost:4000`:

- `/planes` y `/actividades`: formulación C conservada.
- `/planeacion`: bandeja institucional con filtros y navegación.
- `/planes/ID/gestion`: expediente, estado, datos pendientes, preparación opcional
  de fechas y cuenta propuesta, e historial. También se abre desde Gestión
  institucional en cada plan de la lista.

Una consulta de un plan anterior elegible muestra su borrador virtual sin crear
registros. La bandeja puede estar vacía porque no se incorporan planes automáticamente.
Los estados heredados no se sobrescriben. Guardar preparación requiere el permiso
existente de edición; una propuesta de responsable **no es** una designación oficial.

Siguen bloqueadas todas las actuaciones institucionales, incluidas aprobación,
recepción, observación, devolución y presentación formal. No existe un cambio de
roles/permisos ni asignación oficial de responsables en esta activación. Las
autoridades, ámbitos, designaciones y requisitos condicionales pendientes están
detallados en `PLAN_WORKFLOW.md`. Activar el esquema no confirma esas decisiones.

## Recuperación controlada

No fue necesaria recuperación. Si aparece una incidencia:

1. Conservar el respaldo cifrado, su manifiesto y los registros de inicio. No repetir
   UP a ciegas ni ejecutar DOWN automáticamente: MariaDB hace commits implícitos
   de DDL. Una migración fallida exige revisar su punto exacto antes de continuar.
2. Bajo el mismo perfil de Windows que creó el respaldo, descifrarlo en memoria
   con DPAPI `CurrentUser` y verificar el SHA256 contra `backup.sha256` del
   manifiesto, sin mostrar ni guardar el SQL en texto plano. Esa comprobación y
   su restauración completa ya se realizaron antes de aplicar UP.
3. Restaurar primero en una **nueva base temporal** del mismo servidor aislado
   3307. Confirmar el destino y que el SQL no cambia de base ni referencia al origen.
   Comparar estructura, relaciones, registros, triggers, rutinas y eventos con
   `before` del manifiesto. Nunca ensayar una restauración sobre la base activa.
4. Para sustituir la base existente se necesita una operación de recuperación
   expresamente autorizada: detener controladamente los procesos locales, respaldar
   también cualquier información creada después de activar D y acordar el punto
   de recuperación. No sobrescribir datos posteriores de oficio.
5. Tras una recuperación autorizada, verificar destino, integridad, configuración,
   funcionamiento de C y cierre de actuaciones antes de reabrir el acceso.

El respaldo anterior a D no contiene información que el usuario registre después
de esta activación. No sustituye un respaldo actualizado de esos datos nuevos.
No se modificaron datos comerciales, producción, credenciales, roles, permisos,
aprobaciones ni cálculos. Sin instalaciones, commit, push, merge o despliegue.

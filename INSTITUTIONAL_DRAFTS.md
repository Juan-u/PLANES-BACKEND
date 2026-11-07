# Bloque C — formulación institucional en borrador

Implementado en `develop`, 2026-11-02. Base funcional: Documento Maestro de Reglas
recuperado y contratos CRUD existentes. No incorpora presentación, aprobación,
cancelación, eliminación ni nuevas reglas de autorización.

## Modelo y alcance real

La información nueva se guarda en tablas complementarias. Los registros anteriores
no requieren relleno ni cambio de estado. Un registro sin ficha conserva sus valores.
`institucional.modo = "borrador"` describe exclusivamente la ficha de formulación;
no es un nuevo estado oficial del plan o de la actividad.

- `proceso_institucional`: catálogo autorizado, inicialmente vacío. No se crean
  procesos de negocio ficticios ni una ruta para administrarlos.
- `plan_institucional`: problema, causas, consecuencias, objetivo general, meta,
  valor decimal, unidad y responsable propuesto, separado del creador (`id_usuario`).
- `plan_objetivo`: objetivos específicos con identificadores estables.
- `plan_indicador`: indicador principal del plan: nombre, descripción, fórmula,
  unidad y fuente. La fórmula es texto; no se evalúa ni modifica cálculos oficiales.
- `actividad_institucional`: nombre, resultado esperado, referencias al objetivo
  y al indicador del mismo plan, verificación, prioridad, evidencias esperadas,
  observaciones e instrucciones. La descripción, responsable y fechas existentes
  siguen usando sus columnas originales.
- `actividad_recurso`: descripción, cantidad y costo estimado por recurso.
  No calcula totales ni presupuestos. No se infiere una moneda.
- `registro_cambio_institucional`: actor, instante, valores anteriores y nuevos
  de las fichas; se escribe en la misma transacción. No contiene credenciales.

La ficha incompleta se puede guardar: únicamente se mantienen los mínimos técnicos
preexistentes (nombre de plan / asociación de actividad a un plan). Añadir una fila
de objetivo o recurso exige su descripción; una fila nueva completamente vacía se
omite desde el formulario. Los elementos existentes no se eliminan por omisión.

Los catálogos y las referencias se validan en servidor. Un objetivo o indicador de
otro plan se rechaza. La designación oficial de un responsable activo/autorizado
queda pendiente del mecanismo institucional de asignación: el campo del plan es
una propuesta de formulación y no confiere acceso. No se usa el texto para autorizar.

## API y compatibilidad

Los POST/PUT existentes de `/api/planes` y `/api/actividades` aceptan un objeto
opcional `institucional`. Si no se envía, se conserva el contrato anterior y no se
modifica la ficha. Si se envía, los campos escalares de la ficha se reemplazan:
enviar el formulario completo y la `revision` obtenida en la consulta.

La consulta de lista/detalle adjunta `institucional` (o `null`). Sin migración se
mantiene la lectura heredada; guardar una ficha requiere el esquema nuevo y falla
sin cambios parciales si no está disponible. No ocultar ese fallo como un guardado.

`GET /api/planes/catalogo-institucional` devuelve `{ procesos: [...] }`, protegido
por el mismo JWT y permiso de lectura de Planes. No divulga usuarios ni asignaciones.
No cambia los códigos `M03.plans.*` ni `M04.activities.*` ni sus políticas actuales.

Ejemplo de cuerpo institucional de plan (los demás campos del CRUD son iguales):

```json
{
  "institucional": {
    "revision": 1,
    "id_proceso": null,
    "problema": "Situación identificada",
    "objetivo_general": "Resultado que se busca",
    "meta_valor": "0.0000",
    "objetivos": [{ "id": 7, "descripcion": "Objetivo específico" }],
    "indicador": { "nombre": "Indicador", "descripcion": "Qué mide", "formula": "Texto de la fórmula" }
  }
}
```

Una actividad puede enviar `id_objetivo`, `id_indicador`, `prioridad` (`alta`,
`media`, `baja` o vacío) y `recursos` con `id` opcional, `descripcion`, `cantidad`
y `costo_estimado`. Los decimales se validan sin conversión a coma flotante:
DECIMAL(18,4) para meta/cantidad, DECIMAL(18,2) para costo, recursos no negativos.
Los valores cero no se sustituyen por datos ausentes. Las fechas permanecen como
días de calendario `YYYY-MM-DD`; no se convierten zonas horarias.

Actualizar una ficha existente exige su revisión vigente. Un conflicto devuelve
409 y revierte también los cambios de la fila base. Validación devuelve 400;
indisponibilidad devuelve un 503 genérico sin errores internos de MySQL. El
frontend conserva los campos permitidos en la sesión del servidor ante fallos;
no guarda credenciales ni CSRF en el borrador. La recuperación está limitada por
la vigencia de la sesión y por los límites de cuerpo HTTP ya existentes. Un fallo
de consulta puede impedir renderizar hasta que se recupere el servicio; el
borrador queda en la sesión. Al guardar correctamente se elimina esa recuperación.

## Migraciones y ejecución segura

Preparadas:

- `migrations/20261102_institutional_drafts.up.sql`
- `migrations/20261102_institutional_drafts.down.sql`

Actualización 2026-11-02: UP aplicado a `planes_accion_test` en `127.0.0.1:3307`,
después de verificar un respaldo completo cifrado y su restauración. No se aplicó
a producción. Resultado y recuperación: [ACTIVACION_LOCAL_BLOQUE_C.md](ACTIVACION_LOCAL_BLOQUE_C.md).
DDL de MariaDB hace commits implícitos: una migración fallida requiere comprobar
su estado y restaurar el respaldo; no asumir una reversión transaccional del DDL.
La migración DOWN elimina información **nueva**, incluidas fichas y su historial;
exportarla antes de revertir. Conserva las filas heredadas de planes/actividades.

Comprobación reproducible desde la carpeta del backend:

```powershell
node test-db/verify-institutional.mjs --isolated-3307
```

El comprobador usa exclusivamente `127.0.0.1:3307`, obtiene la credencial aislada
de `test-db/.env.test`, comprueba `planes_accion_test` y MariaDB, y copia solo DDL
de cinco tablas a dos bases desechables de nombre aleatorio `planes_blockc_*`.
Antes de migrar guarda un respaldo de esquema, verifica su SHA256 y lo restaura
en la segunda base. No copia cuentas ni datos existentes. Crea únicamente fixtures
sintéticos deshabilitados para probar claves foráneas, nunca credenciales de login.
Prueba persistencia real, conflictos, integridad, y subida/reversión/subida. Al
terminar elimina únicamente esas dos bases generadas. El respaldo sin datos queda
en `test-db/institutional-backups.tmp/`, excluido de Git. No inicia sesión ni toca
la base `planes_accion_test` más allá de consultas de esquema de solo lectura.

Para utilizar las fichas en la aplicación local existente, el operador debe primero
obtener y verificar un respaldo recuperable completo de **su base aislada**, confirmar
host `127.0.0.1`, puerto `3307` y `SELECT DATABASE() = 'planes_accion_test'` en la
misma conexión que ejecutará el SQL. Solo entonces ejecutar el archivo UP con su
herramienta de mantenimiento. No aplicar los SQL por medio de la conexión general
del proyecto ni del `.env` comercial. El respaldo del comprobador no respalda los
registros de la base existente: solo sirve para sus bases desechables.

Después, cargar el código actualizado de backend y frontend en procesos locales
configurados explícitamente para el entorno aislado, sin cambiar `.env` comercial.
La activación local reinició backend y frontend conservando su configuración
efectiva. Los permisos actuales siguen siendo necesarios para acceder a `/planes`
y `/actividades`. Es necesario iniciar sesión de nuevo tras el reinicio.

## Uso de los formularios

1. Abrir Planes y desplegar Crear plan o Editar. Completar los campos de formulación
   disponibles. Los objetivos se añaden con su botón; guardar no aprueba el plan.
2. Guardar el borrador. Su consulta muestra la ficha y conserva los IDs de objetivos
   e indicador, necesarios para asociar actividades.
3. En Actividades, seleccionar el plan: las asociaciones muestran sus objetivos e
   indicador. Completar recursos, prioridad y verificación cuando se conozcan.
4. Consultar la ficha en el detalle de actividad. Las evidencias esperadas son texto
   de formulación; cargar/aprobar evidencias reales conserva el flujo ya existente.
5. Ante conflicto, comparar el borrador conservado y usar el enlace explícito para
   descartarlo/cargar la versión vigente; no reintentar con una revisión inventada.

## Pendientes institucionales deliberados

No se implementan designación oficial de responsables, alta de procesos del catálogo,
formato del código institucional, transiciones, aprobación, validación de completitud
para presentación, cambios de composición aprobada, eliminación, múltiples indicadores
ponderados ni nuevas fórmulas de evaluación. Requieren su mecanismo autorizado y no
se sustituyen con validaciones técnicas. Esta entrega completa formulación/persistencia
de borradores, no el ciclo institucional de aprobación completo.

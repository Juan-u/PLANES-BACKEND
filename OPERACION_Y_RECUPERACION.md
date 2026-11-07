# Operación, soporte y recuperación

Guía local breve. No autoriza migraciones, recuperación destructiva o publicación.

## Disponibilidad, inicio y cierre

Desde backend:

```powershell
npm.cmd run check:local
node scripts/check-local.mjs --backend http://127.0.0.1:3010 --frontend http://127.0.0.1:4010 --timeout 3000
```

Seis GET sin sesión/token: inicio y protección de Informes/CI (401 API, 302 frontend).
No sigue redirecciones ni descarga cuerpos; rechaza destinos externos y URL con
credenciales; no escribe datos. Salida JSON sin datos de cuentas. Códigos: 0 correcto,
1 indisponibilidad/respuesta inesperada, 2 argumentos inválidos. No acredita MySQL,
sesión real, cálculos, integridad o aceptación institucional.

Instalación nueva: `GUIA_INSTALACION.md`. Para detener procesos iniciados por el
operador en primer plano, usar Ctrl+C en su terminal tras verificar ausencia de
operaciones activas. Si tienen otro gestor, identificar PID/comando/directorio y
entorno antes de una parada autorizada; reiniciar conservando destino/secretos sin
imprimirlos. Reiniciar frontend finaliza las sesiones del almacenamiento en memoria.
No detener servicios actuales como parte de una revisión documental.

Operación habitual: comprobar disponibilidad, capacidad del almacenamiento privado,
antigüedad de respaldos según política y errores sanitizados. La validación guiada
de J fue confirmada por el propietario; soporte no necesita contraseñas, cookies,
JWT ni capturas sensibles. CSV/PDF registran generación: no son pruebas sin escritura.

## Incidentes y mantenimiento

Desarrollo/administración principal: **Erick Anderson Gómez Acosta** y
**Juan Esteban Dueñas Lozano**. No se inventan turnos, contactos o designaciones
operativas. Canal, guardia y tiempos deben acordarse externamente.

Registro mínimo en el canal privado designado:

```text
ID / fecha y zona / reportante por canal autorizado
Entorno y módulo / pasos sin datos personales / HTTP o resultado del comprobador
Impacto / clasificación técnica / responsable de seguimiento
Contención / evidencia sanitizada / resolución o pendiente / cierre confirmado
```

Crítico: riesgo de integridad, exposición o pérdida; contener y escalar conservando
estado. Alto: servicio/módulo necesario indisponible. Normal: presentación o ayuda
sin afectación de acceso/integridad. Es triage técnico, no nuevos estados ni reglas
institucionales. No registrar secretos, SQL con datos ni volcados sin cifrar.

Actualización controlada: revisión autorizada, instalación por lockfile en copia,
pruebas focalizadas, respaldo nuevo restaurable si habrá cambios persistentes,
ensayo/integridad, autorización específica de migración, reinicio necesario con
entorno conservado y comprobación posterior. No hacer despliegue, merge, rollback
o reinstalación por iniciativa para sortear un fallo. Registrar versión y límites.

## Respaldo: procedimiento ya validado

Ejecución comprobada: `ACTIVACION_PERSISTENTE_BLOQUE_I.md`. K no creó otro respaldo
real, porque no modificó datos persistentes. Para un respaldo futuro autorizado:

1. Verificar destino efectivo, permisos y espacio; registrar esquema, conteos y
   revisión sin información sensible. No confiar solo en el `.env` general.
2. Usar `mariadb-dump` existente con transacción consistente, rutinas, eventos,
   disparadores y binarios hexadecimales, como I; credenciales solo por mecanismo
   privado, no argumentos ni logs. No dejar SQL plano en carpetas compartidas.
3. Cifrar el flujo con DPAPI CurrentUser, como los `.sql.dpapi` de I, con nombre
   nuevo/escritura exclusiva. Conservar manifiesto de huella, conteos y destino.
4. Incluir almacenamiento privado y correspondencia con metadatos: SQL solo no
   recupera archivos. No incorporar evidencias a imágenes o Git.
5. Descifrar en memoria, comprobar huella y restaurar primero en base nueva aislada;
   comparar datos, definiciones, FK, disparadores y archivos. Existencia del archivo
   no equivale a restauración verificada.

Los ejecutores temporales anteriores tienen guardas/expectativas de sus fases;
**no repetirlos como comandos genéricos de respaldo del esquema actual**. Son
evidencia del procedimiento. No se creó un servicio nuevo de backup en K.

## Recuperación

Contener, conservar evidencia y estado, identificar respaldo verificado y datos
posteriores. Restaurar/comparar en otra base y revisar la posible pérdida de datos.
Solicitar autorización específica antes de sobrescribir la fuente o recuperar
destructivamente. Nunca ejecutar DOWN o borrar archivos para forzar restricciones.

DPAPI requiere el perfil Windows original; custodia, retención, frecuencia y
recuperación portable fuera del equipo siguen pendientes de decisión operativa.
Un baseline vacío no sustituye un respaldo de datos.

### Custodia portable: propuesta y ensayo sintético final

Se propone un paquete versionado que reúna SQL, evidencias privadas y manifiesto
de integridad, cifrado con **AES-256-GCM** y clave derivada mediante **scrypt**:
sal aleatoria de 16 bytes, nonce de 12, clave de 32, etiqueta de 16 y parámetros
N=16384/r=8/p=1 del prototipo ensayado. La cabecera (versión, algoritmo, KDF, sal
y nonce) se autentica como AAD. La protección no usa identidad DPAPI. El formato
y parámetros deberán revisarse para el volumen y política de una instalación
real; el prototipo no es una nueva política de credenciales del aplicativo.

Pruebas nuevas ejecutadas únicamente con información sintética:

- El volcado del MySQL desechable, de 86631 bytes, se cifró en Windows y descifró
  en otro proceso y en el contenedor Linux. Su SHA256 coincidió con el original.
- Se restauró el SQL descifrado en una segunda base del mismo contenedor
  desechable. Los checksums de datos de sus 43 tablas coincidieron.
- Clave incorrecta y alteración del contenido cifrado fueron rechazadas.
- Un segundo paquete sintético SQL+archivo se cifró en Windows y descifró en un
  contenedor Linux sin red. Se materializó la evidencia en su sistema de archivos
  y se verificaron los hashes de SQL y archivo. El contenedor se eliminó.

Las claves se generaron en memoria, viajaron por entrada privada de proceso y
no se guardaron ni imprimieron. Por diseño, los artefactos de prueba no tienen
una clave de recuperación conservada: acreditan el ensayo, no son respaldos
operativos reutilizables. No se descifró, convirtió, exportó o alteró ningún
respaldo institucional existente. No se accedió a la base persistente.

Evidencia: `test-db/docker-final.tmp/result-202e2c4678.json`,
`portable-synthetic-202e2c4678.json` y `portable-package-*-result.json`. El paquete
SQL+archivo y el volcado completo son dos pruebas complementarias; no se afirma
una restauración productiva integral de una organización.

Para recuperar fuera del equipo original hacen falta: paquete íntegro y versión
de formato documentada, acceso autorizado a la clave independiente de Windows,
implementación compatible del KDF/cifrado, Node/herramientas MySQL compatibles,
almacenamiento privado de archivos y destino aislado nuevo para verificar datos,
FK, disparadores y correspondencia de evidencias antes de cualquier sustitución.
Restaurar usuarios/definers requiere revisar las cuentas autorizadas del servidor
destino; no quitar controles ni conceder privilegios para forzar una importación.

**Requiere autorización organizacional:** custodios y acceso a claves, canal de
entrega separado del respaldo, retención/rotación, localizaciones y recuperación
ante pérdida. No almacenar clave y paquete juntos ni depender exclusivamente del
perfil Windows. Una eventual conversión de DPAPI real necesita autorización
expresa; no se hizo en este ensayo. **Pendiente técnico:** simulacro completo en
otro equipo físico y prueba del procedimiento de custodia autorizado. Windows a
Linux en Docker demuestra independencia del cifrado respecto de DPAPI, no sustituye
ese simulacro externo ni la aceptación institucional.

**Advertencia:** el contenedor de `test-db/compose.yml`, originalmente efímero,
alberga actualmente los datos consolidados. No ejecutar `down` ni recrearlo por
instrucciones históricas de descarte. `stop` conserva el contenedor; cambios de
persistencia o recuperación requieren respaldo verificado y alcance autorizado.

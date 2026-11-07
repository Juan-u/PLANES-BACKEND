# Activación local del Bloque C

Fecha local: 2026-11-02, America/Bogota. Ambos repositorios en `develop`.
Estado: UP aplicado y procesos locales reiniciados. Sin despliegue.

## Destino y respaldo

Destino verificado antes de escribir y en la misma conexión de migración:
`127.0.0.1:3307`, base seleccionada `planes_accion_test`. Se comprobó el contenedor
aislado `planes-action-test-planes-accion-db-test-1`, publicado únicamente en
`127.0.0.1:3307`. No se utilizó la conexión del `.env` general.

Respaldo **completo**, no solo de estructura: tablas, registros, vistas y definiciones
de triggers, rutinas y eventos que existieran. Se obtuvo con `mariadb-dump`
transaccional. No se imprimieron credenciales ni contenido del respaldo.

- Archivo cifrado: `test-db/activation-blockc.tmp/complete-2026-11-03T00-22-44-166Z.sql.dpapi`.
- Manifiesto de integridad y ejecución: `test-db/activation-blockc.tmp/activation-2026-11-03T00-22-44-166Z.json`.
- Cifrado Windows DPAPI `CurrentUser`: requiere el mismo perfil de Windows que
  realizó la activación. No se dejó SQL en texto plano ni una clave junto al archivo.
- Se releyó y descifró el archivo guardado, verificando SHA256 del SQL completo.
- Se restauró en una base nueva del mismo servidor aislado y se compararon todos
  los registros y definiciones con el origen. La restauración coincidió exactamente.
- UP se ensayó sobre esa restauración antes de ejecutarse en la base de destino.
  La base temporal de restauración se eliminó al finalizar. El respaldo se conserva.

Los archivos auxiliares y el respaldo están dentro de una carpeta `.tmp` ignorada
por Git. Conservar el archivo cifrado y su manifiesto juntos; no divulgar el SQL
descifrado, porque un respaldo completo contiene información de autenticación.

## Migración y conservación

Se aplicó exactamente `migrations/20261102_institutional_drafts.up.sql`, sin
alteraciones. Su SHA256 y los de servicio, controladores y router se registraron en
el manifiesto y se volvieron a comprobar inmediatamente antes de aplicar UP.
El SQL se validó como siete CREATE TABLE y un índice único aditivo de actividad.

Nuevas tablas: `proceso_institucional`, `plan_institucional`, `plan_objetivo`,
`plan_indicador`, `actividad_institucional`, `actividad_recurso` y
`registro_cambio_institucional`. También se agregó el índice
`uq_actividad_plan_institucional` sobre `(id_actividad,id_plan)`.

Las 23 tablas existentes y sus **171 registros** conservaron exactamente sus datos,
comprobados por conteo y huella de contenido antes/después y tras las pruebas finales.
El esquema resultante coincidió con el ensayado en la restauración. Las siete tablas
nuevas permanecen vacías: no se crearon datos de prueba permanentes ni se inventaron
procesos institucionales. No se ejecutó DOWN.

## Procesos y comprobaciones

- Backend: PID anterior 73384, nuevo PID **64168**, puerto **3000**.
- Frontend: PID anterior 47764, nuevo PID **37904**, puerto **4000**.
- Se verificaron PID, ejecutable, directorio y punto de entrada antes de detener
  exclusivamente esas dos instancias. Se conservaron sus entornos efectivos en
  memoria, incluidos los secretos, sin imprimirlos ni guardarlos en archivos.
- El backend reiniciado conserva `DB_HOST=127.0.0.1`, `DB_PORT=3307`,
  `DB_NAME=planes_accion_test`, usuario aislado `planes_test`, entorno development
  y las rutas locales previamente habilitadas. No se modificaron archivos `.env`.
- Ambos procesos iniciaron correctamente. La configuración y los puertos se
  volvieron a comprobar después del reinicio. No se detuvo MySQL ni Docker.

Resultados:

- Suite backend: **323 aprobadas**, cero fallos.
- Suite frontend: **159 aprobadas**, cero fallos.
- **16 comprobaciones HTTP**: raíz backend, login y recursos estáticos responden
  200; las API protegidas responden 401 sin token; los módulos web redirigen al
  acceso sin sesión. El script y los estilos servidos incluyen el Bloque C.
- Consultas de solo lectura con `planes_test`: lista/detalle de planes y actividades,
  catálogo institucional y renderizado EJS con los datos existentes, correctos.
- Cuenta de revisión ID 78: activa y conserva lectura, creación y actualización de
  Planes y Actividades. No se utilizaron ni cambiaron sus credenciales.
- Se volvieron a comparar todos los registros, incluidos usuarios, roles y permisos:
  permanecen idénticos. Las tablas nuevas siguen vacías.

Las lecturas de datos y las comprobaciones HTTP son verificaciones separadas.
No se autenticó artificialmente ninguna sesión ni se enviaron formularios de
creación/edición. La comprobación HTTP autenticada y el guardado manual completo
quedan para el usuario; no se certifican como realizados en esta activación.

## Acceso local

1. Abrir `http://localhost:4000` e iniciar sesión con las credenciales actuales de
   la cuenta de pruebas autorizada. El reinicio vació las sesiones en memoria.
2. Abrir `http://localhost:4000/planes` y desplegar Crear plan o Editar.
3. Abrir `http://localhost:4000/actividades` para consultar los campos nuevos.
4. Para revisar sin escribir, desplegar los formularios y cerrar con Cancelar o
   Escape; no pulsar Crear/Guardar. El catálogo está vacío hasta su carga autorizada.

La designación oficial de responsables y los flujos de aprobación siguen pendientes
del mecanismo institucional. Los campos propuestos no conceden permisos y guardar
una ficha no aprueba el plan ni modifica cálculos oficiales.

## Recuperación controlada

No fue necesaria una recuperación. Si se presenta una incidencia:

1. Conservar este respaldo, el manifiesto y los registros de inicio. No ejecutar
   DOWN automáticamente ni repetir el auxiliar de activación sobre el esquema ya
   migrado. MariaDB realiza commits implícitos para DDL.
2. Trabajar bajo el mismo perfil de Windows que creó el respaldo. Comprobar que el
   archivo cifrado puede descifrarse y que el SHA256 del SQL coincide con
   `backup.sha256` del manifiesto, sin imprimir ni guardar el SQL en texto plano.
   Esta comprobación y una restauración completa ya se realizaron antes de migrar.
3. Restaurar primero en una **nueva base temporal** del servidor aislado 3307.
   Verificar que el SQL no cambia de base ni hace referencia cualificada al origen.
   Comparar tablas, definiciones, cantidades y contenido con `before` del manifiesto.
4. Antes de sustituir la base existente, detener los procesos locales de manera
   controlada, respaldar también cualquier información nueva y acordar el punto
   de recuperación. No restaurar sobre datos posteriores ni sobre otra base por
   iniciativa automática. La sustitución requiere una operación de recuperación
   expresamente autorizada; esta activación no la ejecutó.
5. Tras una recuperación autorizada, comprobar de nuevo destino, integridad,
   configuración efectiva y rutas antes de reabrir el acceso.

No se modificaron cuentas, contraseñas, roles, permisos, datos comerciales,
producción, reglas de aprobación ni cálculos. No se instalaron dependencias y no
hubo commit, push, merge o despliegue.

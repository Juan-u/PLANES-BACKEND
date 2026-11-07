# Lista de entrega y aceptación operativa

Estado al 03/11/2026, rama `develop`. Desarrollo A–K y ensayo técnico final
completados dentro del alcance local. Preparación operativa verificada en los
puntos indicados; aceptación institucional y producción **no declaradas**.

Estados únicos: **Verificado** (evidencia técnica ejecutada), **Pendiente**
(prueba técnica no completada) y **Requiere autorización** (decisión organizacional).

| Área / requisito | Estado | Evidencia o condición concreta |
|---|---|---|
| Dependencias por lockfiles | Verificado | K: instalaciones vacías offline backend/frontend e importaciones; lockfiles intactos. |
| Configuración local sin secretos | Verificado | Plantillas, scripts y variables validados; archivos reales no modificados. |
| Instalación de estructura limpia | Verificado | Baseline hasta F: 43 tablas, 86 FK, 20 disparadores y cero registros en DB desechable. |
| Build Docker de backend y frontend | Verificado | Dockerfiles existentes construidos; Desktop Engine 29.7.2, Compose v5.5.1, Node imagen v22.23.4. |
| Arranque y red Docker | Verificado | Proyecto nuevo, DB sin puerto publicado, backend→db y frontend→backend; 3015/4015 alternativos. |
| Autenticación Docker y permisos | Verificado | Login scrypt/JWT, sesión real sintética del BFF, cuenta restringida denegada; sin cuentas reales. |
| Funciones focalizadas Docker | Verificado | Diez rutas principales, plan con CSRF, actividad, seguimiento pendiente, evidencia privada, informe y CSV/página de impresión; parte de 44 comprobaciones. |
| Restricciones institucionales | Verificado | Escritura CI, aprobación de seguimiento y publicación bloqueadas en el ensayo; políticas existentes sin cambios. |
| Sesión del propietario | Verificado | J: confirmó apertura de todos sus módulos permitidos; verificación guiada, sin observar credenciales. |
| Integridad persistente | Verificado | Última comprobación K: 43 tablas y 171 registros intactos. El ensayo final no conectó a esa DB ni volvió a contar registros. |
| Conservación del entorno original | Verificado | Contenedor original con mismo ID; PID 74584/3000 y 27328/4000 intactos. |
| Limpieza de ensayo | Verificado | Contenedores, volúmenes, red y etiquetas de aplicación propios retirados; recursos preexistentes preservados, sin prune de caché/base. |
| Pruebas previas | Verificado | Antecedentes: 617 automáticas J, 24 visuales J y nueve focalizadas K; no repetidas en esta actividad. |
| Respaldo DPAPI restaurable | Verificado | I: respaldos históricos cifrados y restaurados. No se descifraron ni modificaron durante el ensayo final. |
| Mecanismo portable sintético | Verificado | AES-256-GCM/scrypt, Windows→Linux, SQL restaurado con checksum de 43 tablas, clave incorrecta/tamper rechazados; paquete complementario SQL+evidencia recuperado. |
| Recuperación en otro equipo físico | Pendiente | Docker Linux y otro proceso no sustituyen el simulacro completo fuera del equipo con custodia y acceso reales autorizados. |
| Custodia, retención y acceso a claves | Requiere autorización | La organización debe designar custodios, canal separado, almacenamiento y recuperación ante pérdida; no copiar DPAPI real por iniciativa. |
| Procedimientos de operación y soporte | Verificado | Inicio/cierre, comprobador sin escrituras, diagnóstico, mantenimiento, incidentes y recuperación en las guías. |
| Canal, guardia y tiempos operativos | Requiere autorización | Designar responsables y comunicaciones; no inventar turnos o contactos. |
| Aprovisionamiento inicial real | Requiere autorización | El baseline no crea cuentas ni asignaciones; seguir definiciones aprobadas y procedimiento autorizado de la organización. |
| Autoridades institucionales aún pendientes | Requiere autorización | Conservar bloqueos hasta designación válida; no reabrir roles/permisos ya aprobados. |
| Entorno de producción | Requiere autorización | Destino, secretos, HTTPS, persistencia de sesiones, cuenta MySQL y composición productiva deben definirse sin alterar el entorno actual. |
| Validación técnica de ese entorno | Pendiente | Probar configuración, actualización/recuperación, observabilidad y recorridos en el destino autorizado; no extrapolar el ensayo local. |
| Versión y paquete formal de entrega | Requiere autorización | Seleccionar revisión y artefactos aprobados, registrar digest/lockfiles; no se ejecutaron commit, push, merge o despliegue. |
| Aceptación institucional | Requiere autorización | Responsables de la organización deben aceptar operación, restricciones y evidencia; la validación técnica no los sustituye. |

Desarrollo/administración principal: Erick Anderson Gómez Acosta y
Juan Esteban Dueñas Lozano. Esto no asigna automáticamente soporte operativo.

Guías: [instalación/Docker](GUIA_INSTALACION.md),
[operación/respaldo/recuperación](OPERACION_Y_RECUPERACION.md).
Evidencia nueva: `test-db/docker-final.tmp/result-202e2c4678.json`, log de build
y resultados del paquete portable sintético. Repetición acotada:
`node test-db/verify-docker.mjs --isolated-docker`, solo para validar otra revisión
en recursos nuevos. No conectar a la base persistente ni reutilizar cuentas reales.

Siguiente paso: acordar las condiciones organizacionales de entrega y ejecutar
el simulacro externo y validación del destino autorizado. No iniciar otro ciclo
de funcionalidades para sustituir esas decisiones.

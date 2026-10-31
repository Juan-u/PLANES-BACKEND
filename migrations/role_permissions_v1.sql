-- BORRADOR DE MIGRACION ADITIVA. NO EJECUTAR SIN VALIDAR EL DDL DEL ENTORNO OBJETIVO.
-- Contiene exclusivamente definiciones CREATE TABLE; no modifica tablas ni datos existentes.
-- Las comprobaciones que dependen de otras filas (clasificacion/requiere_ambito,
-- ambito activo, aprobacion privilegiada, identidad de solicitante/decisor y
-- solapamientos) son obligatorias en el repositorio dentro de transactions.run.
-- MariaDB CHECK/FK no sustituyen esas validaciones entre tablas.
-- El adaptador debe adquirir bloqueos en orden global: rol -> solicitud ->
-- asignacion -> auditoria. UUID v4 debe generarlo y validarlo ids.next(); los
-- CHECK de abajo son defensa de persistencia, no implementan el generador.
-- En revocaciones se persiste solo id_asignacion_objetivo; el repositorio
-- debe hidratar usuario/rol/ambito desde esa asignacion y validar que siga
-- revocable. En asignaciones privilegiadas, approvalRequestId se registra en
-- rol_solicitud.id_asignacion_resultado; approvedBy se registra como
-- rol_decision.id_usuario_decisor, no como prueba duplicada en la asignacion.
-- La asignacion, el cambio de estado/decision y la auditoria deben compartir
-- una transaccion. La consulta de permisos debe exigir solicitud aprobada y
-- decision aprobatoria para clasificacion privileged.
-- ref_hash se deriva de kind + ':' + valor; verificar soporte operativo de
-- SHA2 en la compilacion MariaDB objetivo antes de insertar referencias.

CREATE TABLE `rol_configuracion` (
  `id_rol` int(11) NOT NULL,
  `clasificacion_privilegio` varchar(20) NOT NULL,
  `permite_vigencia_indefinida` tinyint(1) NOT NULL,
  `requiere_ambito` tinyint(1) NOT NULL,
  PRIMARY KEY (`id_rol`),
  CONSTRAINT `chk_rol_configuracion_clasificacion` CHECK (`clasificacion_privilegio` IN ('ordinary', 'privileged')),
  CONSTRAINT `chk_rol_configuracion_vigencia` CHECK (`permite_vigencia_indefinida` IN (0, 1)),
  CONSTRAINT `chk_rol_configuracion_ambito` CHECK (`requiere_ambito` IN (0, 1)),
  CONSTRAINT `fk_rol_configuracion_rol` FOREIGN KEY (`id_rol`)
    REFERENCES `rol` (`id_rol`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `permiso` (
  `id_permiso` int(11) NOT NULL AUTO_INCREMENT,
  `codigo` varchar(100) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL,
  PRIMARY KEY (`id_permiso`),
  UNIQUE KEY `uq_permiso_codigo` (`codigo`),
  CONSTRAINT `chk_permiso_activo` CHECK (`activo` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_permiso` (
  `id_rol` int(11) NOT NULL,
  `id_permiso` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  `creado_por` int(11) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `modificado_en` datetime(3) DEFAULT NULL,
  `modificado_por` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_rol`, `id_permiso`),
  KEY `idx_rol_permiso_permiso` (`id_permiso`),
  KEY `idx_rol_permiso_creado_por` (`creado_por`),
  KEY `idx_rol_permiso_modificado_por` (`modificado_por`),
  CONSTRAINT `chk_rol_permiso_activo` CHECK (`activo` IN (0, 1)),
  CONSTRAINT `chk_rol_permiso_modificacion` CHECK ((`modificado_en` IS NULL AND `modificado_por` IS NULL) OR (`modificado_en` IS NOT NULL AND `modificado_por` IS NOT NULL)),
  CONSTRAINT `fk_rol_permiso_rol` FOREIGN KEY (`id_rol`)
    REFERENCES `rol` (`id_rol`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_permiso_permiso` FOREIGN KEY (`id_permiso`)
    REFERENCES `permiso` (`id_permiso`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_permiso_usuario` FOREIGN KEY (`creado_por`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_permiso_modificado_por` FOREIGN KEY (`modificado_por`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_scope_ref` (
  `id_scope_ref` int(11) NOT NULL AUTO_INCREMENT,
  `ref_kind` varchar(6) NOT NULL,
  `ref_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ref_hash` binary(32) GENERATED ALWAYS AS (UNHEX(SHA2(CONCAT(`ref_kind`, ':', `ref_value`), 256))) PERSISTENT,
  `activo` tinyint(1) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  `creado_por` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_scope_ref`),
  UNIQUE KEY `uq_rol_scope_ref_hash` (`ref_hash`),
  KEY `idx_rol_scope_ref_creado_por` (`creado_por`),
  CONSTRAINT `chk_rol_scope_ref_kind` CHECK (`ref_kind` IN ('string', 'number')),
  CONSTRAINT `chk_rol_scope_ref_activo` CHECK (`activo` IN (0, 1)),
  CONSTRAINT `chk_rol_scope_ref_hash` CHECK (`ref_hash` IS NOT NULL),
  CONSTRAINT `fk_rol_scope_ref_usuario` FOREIGN KEY (`creado_por`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_scope_permitido` (
  `id_rol` int(11) NOT NULL,
  `id_scope_ref` int(11) NOT NULL,
  PRIMARY KEY (`id_rol`, `id_scope_ref`),
  KEY `idx_rol_scope_permitido_scope` (`id_scope_ref`),
  CONSTRAINT `fk_rol_scope_permitido_rol` FOREIGN KEY (`id_rol`)
    REFERENCES `rol` (`id_rol`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_scope_permitido_scope_ref` FOREIGN KEY (`id_scope_ref`)
    REFERENCES `rol_scope_ref` (`id_scope_ref`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_asignacion` (
  `id_asignacion` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `id_usuario` int(11) NOT NULL,
  `id_rol` int(11) NOT NULL,
  `id_scope_ref` int(11) DEFAULT NULL,
  `vigente_desde` datetime(3) NOT NULL,
  `vigente_hasta` datetime(3) DEFAULT NULL,
  `estado` varchar(12) NOT NULL,
  `creado_por` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  `motivo` text NOT NULL,
  `revocado_por` int(11) DEFAULT NULL,
  `revocado_en` datetime(3) DEFAULT NULL,
  `motivo_revocacion` text DEFAULT NULL,
  PRIMARY KEY (`id_asignacion`),
  KEY `idx_rol_asignacion_solapamiento` (`id_usuario`, `id_rol`, `id_scope_ref`, `estado`, `vigente_desde`, `vigente_hasta`),
  KEY `idx_rol_asignacion_creado_por` (`creado_por`),
  KEY `idx_rol_asignacion_revocado_por` (`revocado_por`),
  CONSTRAINT `chk_rol_asignacion_id_uuid_v4` CHECK (`id_asignacion` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_rol_asignacion_estado` CHECK (`estado` IN ('active', 'scheduled', 'revoked')),
  CONSTRAINT `chk_rol_asignacion_vigencia` CHECK (`vigente_hasta` IS NULL OR `vigente_hasta` > `vigente_desde`),
  CONSTRAINT `chk_rol_asignacion_revocacion` CHECK (
    (`estado` = 'revoked' AND `revocado_por` IS NOT NULL AND `revocado_en` IS NOT NULL AND `motivo_revocacion` IS NOT NULL)
    OR
    (`estado` IN ('active', 'scheduled') AND `revocado_por` IS NULL AND `revocado_en` IS NULL AND `motivo_revocacion` IS NULL)
  ),
  CONSTRAINT `fk_rol_asignacion_usuario` FOREIGN KEY (`id_usuario`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_asignacion_rol` FOREIGN KEY (`id_rol`)
    REFERENCES `rol` (`id_rol`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_asignacion_rol_scope_permitido` FOREIGN KEY (`id_rol`, `id_scope_ref`)
    REFERENCES `rol_scope_permitido` (`id_rol`, `id_scope_ref`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_asignacion_creado_por` FOREIGN KEY (`creado_por`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_asignacion_revocado_por` FOREIGN KEY (`revocado_por`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_solicitud` (
  `id_solicitud` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_accion` varchar(10) NOT NULL,
  `id_usuario_solicitante` int(11) NOT NULL,
  `id_usuario_objetivo` int(11) DEFAULT NULL,
  `id_rol` int(11) DEFAULT NULL,
  `id_scope_ref` int(11) DEFAULT NULL,
  `id_asignacion_objetivo` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `id_asignacion_resultado` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `vigente_desde` datetime(3) DEFAULT NULL,
  `vigente_hasta` datetime(3) DEFAULT NULL,
  `estado` varchar(20) NOT NULL,
  `motivo` text NOT NULL,
  `solicitada_en` datetime(3) NOT NULL,
  `vence_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_solicitud`),
  UNIQUE KEY `uq_rol_solicitud_asignacion_resultado` (`id_asignacion_resultado`),
  KEY `idx_rol_solicitud_pendientes` (`estado`, `id_rol`, `id_usuario_objetivo`, `id_scope_ref`, `tipo_accion`, `id_asignacion_objetivo`),
  KEY `idx_rol_solicitud_vence` (`estado`, `vence_en`),
  KEY `idx_rol_solicitud_solicitante` (`id_usuario_solicitante`),
  KEY `idx_rol_solicitud_scope_ref` (`id_scope_ref`),
  KEY `idx_rol_solicitud_asignacion_objetivo` (`id_asignacion_objetivo`),
  KEY `idx_rol_solicitud_asignacion_resultado` (`id_asignacion_resultado`),
  CONSTRAINT `chk_rol_solicitud_id_uuid_v4` CHECK (`id_solicitud` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_rol_solicitud_accion` CHECK (`tipo_accion` IN ('assign', 'revoke')),
  CONSTRAINT `chk_rol_solicitud_estado` CHECK (`estado` IN ('pending_approval', 'approved', 'rejected', 'expired')),
  CONSTRAINT `chk_rol_solicitud_campos_accion` CHECK (
    (`tipo_accion` = 'assign' AND `id_usuario_objetivo` IS NOT NULL AND `id_rol` IS NOT NULL AND `id_asignacion_objetivo` IS NULL AND `vigente_desde` IS NOT NULL AND (`vigente_hasta` IS NULL OR `vigente_hasta` > `vigente_desde`))
    OR
    (`tipo_accion` = 'revoke' AND `id_usuario_objetivo` IS NULL AND `id_rol` IS NULL AND `id_scope_ref` IS NULL AND `id_asignacion_objetivo` IS NOT NULL AND `id_asignacion_resultado` IS NULL AND `vigente_desde` IS NULL AND `vigente_hasta` IS NULL)
  ),
  CONSTRAINT `chk_rol_solicitud_resultado` CHECK (`id_asignacion_resultado` IS NULL OR `tipo_accion` = 'assign'),
  CONSTRAINT `chk_rol_solicitud_vence_despues` CHECK (`vence_en` > `solicitada_en`),
  CONSTRAINT `chk_rol_solicitud_aprobada_asignacion` CHECK (`estado` <> 'approved' OR `tipo_accion` <> 'assign' OR `id_asignacion_resultado` IS NOT NULL),
  CONSTRAINT `fk_rol_solicitud_solicitante` FOREIGN KEY (`id_usuario_solicitante`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_solicitud_objetivo` FOREIGN KEY (`id_usuario_objetivo`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_solicitud_rol` FOREIGN KEY (`id_rol`)
    REFERENCES `rol` (`id_rol`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_solicitud_rol_scope_permitido` FOREIGN KEY (`id_rol`, `id_scope_ref`)
    REFERENCES `rol_scope_permitido` (`id_rol`, `id_scope_ref`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_solicitud_asignacion_objetivo` FOREIGN KEY (`id_asignacion_objetivo`)
    REFERENCES `rol_asignacion` (`id_asignacion`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_solicitud_asignacion_resultado` FOREIGN KEY (`id_asignacion_resultado`)
    REFERENCES `rol_asignacion` (`id_asignacion`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_decision` (
  `id_decision` int(11) NOT NULL AUTO_INCREMENT,
  `id_solicitud` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_actor` varchar(8) NOT NULL,
  `id_usuario_decisor` int(11) DEFAULT NULL,
  `resultado` varchar(10) NOT NULL,
  `decidida_en` datetime(3) NOT NULL,
  `motivo` text NOT NULL,
  PRIMARY KEY (`id_decision`),
  UNIQUE KEY `uq_rol_decision_solicitud` (`id_solicitud`),
  KEY `idx_rol_decision_usuario` (`id_usuario_decisor`),
  UNIQUE KEY `uq_rol_decision_solicitud_decision` (`id_solicitud`, `id_decision`),
  CONSTRAINT `chk_rol_decision_tipo_actor` CHECK (
    (`tipo_actor` = 'system' AND `id_usuario_decisor` IS NULL AND `resultado` = 'expired')
    OR
    (`tipo_actor` = 'user' AND `id_usuario_decisor` IS NOT NULL AND `resultado` IN ('approved', 'rejected'))
  ),
  CONSTRAINT `fk_rol_decision_solicitud` FOREIGN KEY (`id_solicitud`)
    REFERENCES `rol_solicitud` (`id_solicitud`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_decision_usuario` FOREIGN KEY (`id_usuario_decisor`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_delegacion` (
  `id_delegacion` int(11) NOT NULL AUTO_INCREMENT,
  `id_usuario_delegante` int(11) NOT NULL,
  `id_usuario_delegado` int(11) NOT NULL,
  `id_permiso` int(11) NOT NULL,
  `id_scope_ref` int(11) DEFAULT NULL,
  `vigente_desde` datetime(3) NOT NULL,
  `vigente_hasta` datetime(3) NOT NULL,
  `autorizacion_referencia` text NOT NULL,
  `motivo` text NOT NULL,
  `estado` varchar(12) NOT NULL,
  `creado_por` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  `revocado_por` int(11) DEFAULT NULL,
  `revocado_en` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id_delegacion`),
  KEY `idx_rol_delegacion_delegante` (`id_usuario_delegante`),
  KEY `idx_rol_delegacion_delegado` (`id_usuario_delegado`),
  KEY `idx_rol_delegacion_permiso_ambito_vigencia` (`id_permiso`, `id_scope_ref`, `estado`, `vigente_desde`, `vigente_hasta`),
  KEY `idx_rol_delegacion_creado_por` (`creado_por`),
  KEY `idx_rol_delegacion_revocado_por` (`revocado_por`),
  CONSTRAINT `chk_rol_delegacion_distintos` CHECK (`id_usuario_delegante` <> `id_usuario_delegado`),
  CONSTRAINT `chk_rol_delegacion_vigencia` CHECK (`vigente_hasta` > `vigente_desde`),
  CONSTRAINT `chk_rol_delegacion_estado` CHECK (`estado` IN ('active', 'revoked')),
  CONSTRAINT `chk_rol_delegacion_revocacion` CHECK (
    (`estado` = 'revoked' AND `revocado_por` IS NOT NULL AND `revocado_en` IS NOT NULL)
    OR
    (`estado` = 'active' AND `revocado_por` IS NULL AND `revocado_en` IS NULL)
  ),
  CONSTRAINT `fk_rol_delegacion_delegante` FOREIGN KEY (`id_usuario_delegante`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_delegacion_delegado` FOREIGN KEY (`id_usuario_delegado`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_delegacion_permiso` FOREIGN KEY (`id_permiso`)
    REFERENCES `permiso` (`id_permiso`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_delegacion_scope_ref` FOREIGN KEY (`id_scope_ref`)
    REFERENCES `rol_scope_ref` (`id_scope_ref`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_delegacion_creado_por` FOREIGN KEY (`creado_por`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_delegacion_revocado_por` FOREIGN KEY (`revocado_por`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_auditoria` (
  `id_evento` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_actor` varchar(8) NOT NULL,
  `id_usuario_actor` int(11) DEFAULT NULL,
  `accion` varchar(64) NOT NULL,
  `resultado` varchar(20) DEFAULT NULL,
  `ocurrida_en` datetime(3) NOT NULL,
  `motivo` text NOT NULL,
  `referencia_autorizacion` text DEFAULT NULL,
  `id_usuario_objetivo` int(11) DEFAULT NULL,
  `id_rol` int(11) DEFAULT NULL,
  `id_scope_ref` int(11) DEFAULT NULL,
  `id_solicitud` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `id_decision` int(11) DEFAULT NULL,
  `id_asignacion` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `id_delegacion` int(11) DEFAULT NULL,
  `id_permiso` int(11) DEFAULT NULL,
  `antes` longtext DEFAULT NULL,
  `despues` longtext DEFAULT NULL,
  PRIMARY KEY (`id_evento`),
  KEY `idx_rol_auditoria_actor_fecha` (`id_usuario_actor`, `ocurrida_en`),
  KEY `idx_rol_auditoria_objetivo_fecha` (`id_usuario_objetivo`, `ocurrida_en`),
  KEY `idx_rol_auditoria_rol_fecha` (`id_rol`, `ocurrida_en`),
  KEY `idx_rol_auditoria_scope_fecha` (`id_scope_ref`, `ocurrida_en`),
  KEY `idx_rol_auditoria_solicitud_fecha` (`id_solicitud`, `ocurrida_en`),
  KEY `idx_rol_auditoria_decision` (`id_decision`),
  KEY `idx_rol_auditoria_asignacion_fecha` (`id_asignacion`, `ocurrida_en`),
  KEY `idx_rol_auditoria_delegacion_fecha` (`id_delegacion`, `ocurrida_en`),
  KEY `idx_rol_auditoria_permiso_fecha` (`id_permiso`, `ocurrida_en`),
  CONSTRAINT `chk_rol_auditoria_id_uuid_v4` CHECK (`id_evento` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_rol_auditoria_decision_solicitud` CHECK (`id_decision` IS NULL OR `id_solicitud` IS NOT NULL),
  CONSTRAINT `chk_rol_auditoria_actor` CHECK (
    (`tipo_actor` = 'system' AND `id_usuario_actor` IS NULL)
    OR
    (`tipo_actor` = 'user' AND `id_usuario_actor` IS NOT NULL)
  ),
  CONSTRAINT `fk_rol_auditoria_actor` FOREIGN KEY (`id_usuario_actor`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_objetivo` FOREIGN KEY (`id_usuario_objetivo`)
    REFERENCES `usuario` (`id_usuario`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_rol` FOREIGN KEY (`id_rol`)
    REFERENCES `rol` (`id_rol`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_scope_ref` FOREIGN KEY (`id_scope_ref`)
    REFERENCES `rol_scope_ref` (`id_scope_ref`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_solicitud` FOREIGN KEY (`id_solicitud`)
    REFERENCES `rol_solicitud` (`id_solicitud`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_decision_solicitud` FOREIGN KEY (`id_solicitud`, `id_decision`)
    REFERENCES `rol_decision` (`id_solicitud`, `id_decision`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_asignacion` FOREIGN KEY (`id_asignacion`)
    REFERENCES `rol_asignacion` (`id_asignacion`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_delegacion` FOREIGN KEY (`id_delegacion`)
    REFERENCES `rol_delegacion` (`id_delegacion`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_rol_auditoria_permiso` FOREIGN KEY (`id_permiso`)
    REFERENCES `permiso` (`id_permiso`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Mutex persistente global: la fila 1 debe existir antes de habilitar cualquier
-- operación del módulo. El bloqueo se mantiene dentro de la transacción del servicio.
CREATE TABLE `rol_autorizacion_mutex` (
  `mutex_id` tinyint unsigned NOT NULL,
  PRIMARY KEY (`mutex_id`),
  CONSTRAINT `chk_rol_autorizacion_mutex_singleton` CHECK (`mutex_id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Única fila singleton requerida por authorization-mutex.repository.js.
INSERT INTO `rol_autorizacion_mutex` (`mutex_id`) VALUES (1);

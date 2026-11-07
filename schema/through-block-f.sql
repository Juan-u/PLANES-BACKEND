-- Current schema through Block F. EMPTY NEW DATABASES ONLY. No data, users, grants or secrets.
-- Do not apply to planes_accion_test or rerun historical migrations after this baseline.
CREATE TABLE `permiso` (
  `id_permiso` int(11) NOT NULL AUTO_INCREMENT,
  `codigo` varchar(100) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL,
  PRIMARY KEY (`id_permiso`),
  UNIQUE KEY `uq_permiso_codigo` (`codigo`),
  CONSTRAINT `chk_permiso_activo` CHECK (`activo` in (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `proceso_institucional` (
  `id_proceso` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id_proceso`),
  UNIQUE KEY `nombre` (`nombre`),
  CONSTRAINT `chk_proceso_institucional_activo` CHECK (`activo` in (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol` (
  `id_rol` int(11) NOT NULL AUTO_INCREMENT,
  `nombre_rol` varchar(100) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id_rol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_autorizacion_mutex` (
  `mutex_id` tinyint(3) unsigned NOT NULL,
  PRIMARY KEY (`mutex_id`),
  CONSTRAINT `chk_rol_autorizacion_mutex_singleton` CHECK (`mutex_id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_configuracion` (
  `id_rol` int(11) NOT NULL,
  `clasificacion_privilegio` varchar(20) NOT NULL,
  `permite_vigencia_indefinida` tinyint(1) NOT NULL,
  `requiere_ambito` tinyint(1) NOT NULL,
  PRIMARY KEY (`id_rol`),
  CONSTRAINT `fk_rol_configuracion_rol` FOREIGN KEY (`id_rol`) REFERENCES `rol` (`id_rol`),
  CONSTRAINT `chk_rol_configuracion_clasificacion` CHECK (`clasificacion_privilegio` in ('ordinary','privileged')),
  CONSTRAINT `chk_rol_configuracion_vigencia` CHECK (`permite_vigencia_indefinida` in (0,1)),
  CONSTRAINT `chk_rol_configuracion_ambito` CHECK (`requiere_ambito` in (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `usuario` (
  `id_usuario` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `correo` varchar(150) NOT NULL,
  `contraseña` varchar(255) NOT NULL,
  `estado` varchar(50) DEFAULT NULL,
  `id_rol` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_usuario`),
  UNIQUE KEY `correo` (`correo`),
  KEY `id_rol` (`id_rol`),
  CONSTRAINT `usuario_ibfk_1` FOREIGN KEY (`id_rol`) REFERENCES `rol` (`id_rol`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `historico` (
  `id_historico` int(11) NOT NULL AUTO_INCREMENT,
  `accion` text DEFAULT NULL,
  `fecha` date DEFAULT NULL,
  `id_usuario` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_historico`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `historico_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id_usuario`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `informe_generacion` (
  `id_informe` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_id` int(11) NOT NULL,
  `formato` varchar(10) NOT NULL,
  `caracter` varchar(12) NOT NULL,
  `filtros` longtext NOT NULL,
  `contenido_sha256` char(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_informe`),
  KEY `fk_ig_actor` (`actor_id`),
  CONSTRAINT `fk_ig_actor` FOREIGN KEY (`actor_id`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_ig_formato` CHECK (`formato` in ('csv','print')),
  CONSTRAINT `chk_ig_caracter` CHECK (`caracter` = 'analitico')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `notificacion` (
  `id_notificacion` int(11) NOT NULL AUTO_INCREMENT,
  `mensaje` text DEFAULT NULL,
  `fecha_envio` date DEFAULT NULL,
  `tipo` varchar(50) DEFAULT NULL,
  `id_usuario` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_notificacion`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `notificacion_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id_usuario`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `periodo_seguimiento` (
  `id_periodo` int(11) NOT NULL AUTO_INCREMENT,
  `anio` smallint(5) unsigned NOT NULL,
  `trimestre` tinyint(3) unsigned NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `estado` varchar(16) NOT NULL DEFAULT 'open',
  `creado_por` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id_periodo`),
  UNIQUE KEY `uq_periodo_anio_trimestre` (`anio`,`trimestre`),
  KEY `ix_periodo_fechas_estado` (`fecha_inicio`,`fecha_fin`,`estado`),
  KEY `fk_periodo_creador` (`creado_por`),
  CONSTRAINT `fk_periodo_creador` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_periodo_trimestre` CHECK (`trimestre` between 1 and 4),
  CONSTRAINT `chk_periodo_fechas` CHECK (`fecha_inicio` <= `fecha_fin`),
  CONSTRAINT `chk_periodo_estado` CHECK (`estado` in ('open','closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `plan_accion` (
  `id_plan` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `fecha_creacion` date DEFAULT NULL,
  `estado` varchar(50) DEFAULT NULL,
  `id_usuario` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_plan`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `plan_accion_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id_usuario`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `registro_cambio_institucional` (
  `id_cambio` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entidad` varchar(10) NOT NULL,
  `id_registro` int(11) NOT NULL,
  `actor_id` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `antes` longtext DEFAULT NULL,
  `despues` longtext NOT NULL,
  PRIMARY KEY (`id_cambio`),
  KEY `fk_rci_actor` (`actor_id`),
  CONSTRAINT `fk_rci_actor` FOREIGN KEY (`actor_id`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_rci_entidad` CHECK (`entidad` in ('plan','actividad'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_permiso` (
  `id_rol` int(11) NOT NULL,
  `id_permiso` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  `creado_por` int(11) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `modificado_en` datetime(3) DEFAULT NULL,
  `modificado_por` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_rol`,`id_permiso`),
  KEY `idx_rol_permiso_permiso` (`id_permiso`),
  KEY `idx_rol_permiso_creado_por` (`creado_por`),
  KEY `idx_rol_permiso_modificado_por` (`modificado_por`),
  CONSTRAINT `fk_rol_permiso_modificado_por` FOREIGN KEY (`modificado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_permiso_permiso` FOREIGN KEY (`id_permiso`) REFERENCES `permiso` (`id_permiso`),
  CONSTRAINT `fk_rol_permiso_rol` FOREIGN KEY (`id_rol`) REFERENCES `rol` (`id_rol`),
  CONSTRAINT `fk_rol_permiso_usuario` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_rol_permiso_activo` CHECK (`activo` in (0,1)),
  CONSTRAINT `chk_rol_permiso_modificacion` CHECK (`modificado_en` is null and `modificado_por` is null or `modificado_en` is not null and `modificado_por` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_scope_ref` (
  `id_scope_ref` int(11) NOT NULL AUTO_INCREMENT,
  `ref_kind` varchar(6) NOT NULL,
  `ref_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ref_hash` binary(32) GENERATED ALWAYS AS (unhex(sha2(concat(`ref_kind`,':',`ref_value`),256))) STORED,
  `activo` tinyint(1) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  `creado_por` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_scope_ref`),
  UNIQUE KEY `uq_rol_scope_ref_hash` (`ref_hash`),
  KEY `idx_rol_scope_ref_creado_por` (`creado_por`),
  CONSTRAINT `fk_rol_scope_ref_usuario` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_rol_scope_ref_kind` CHECK (`ref_kind` in ('string','number')),
  CONSTRAINT `chk_rol_scope_ref_activo` CHECK (`activo` in (0,1)),
  CONSTRAINT `chk_rol_scope_ref_hash` CHECK (`ref_hash` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `actividad` (
  `id_actividad` int(11) NOT NULL AUTO_INCREMENT,
  `descripcion` text DEFAULT NULL,
  `responsable` varchar(100) DEFAULT NULL,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `estado` varchar(50) DEFAULT NULL,
  `id_plan` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_actividad`),
  UNIQUE KEY `uq_actividad_plan_institucional` (`id_actividad`,`id_plan`),
  KEY `id_plan` (`id_plan`),
  CONSTRAINT `actividad_ibfk_1` FOREIGN KEY (`id_plan`) REFERENCES `plan_accion` (`id_plan`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `calificacion` (
  `id_calificacion` int(11) NOT NULL AUTO_INCREMENT,
  `trimestre` int(11) DEFAULT NULL,
  `puntaje` float DEFAULT NULL,
  `observaciones_planeacion` text DEFAULT NULL,
  `id_plan` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_calificacion`),
  KEY `id_plan` (`id_plan`),
  CONSTRAINT `calificacion_ibfk_1` FOREIGN KEY (`id_plan`) REFERENCES `plan_accion` (`id_plan`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `periodo_reapertura_solicitud` (
  `id_solicitud` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_periodo` int(11) NOT NULL,
  `solicitado_por` int(11) NOT NULL,
  `motivo` text NOT NULL,
  `client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `solicitado_en` datetime(3) NOT NULL,
  `estado` varchar(16) NOT NULL DEFAULT 'pending',
  PRIMARY KEY (`id_solicitud`),
  UNIQUE KEY `uq_prs_client` (`id_periodo`,`solicitado_por`,`client_id`),
  UNIQUE KEY `uq_prs_periodo` (`id_solicitud`,`id_periodo`),
  KEY `fk_prs_actor` (`solicitado_por`),
  CONSTRAINT `fk_prs_actor` FOREIGN KEY (`solicitado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_prs_periodo` FOREIGN KEY (`id_periodo`) REFERENCES `periodo_seguimiento` (`id_periodo`),
  CONSTRAINT `chk_prs_estado` CHECK (`estado` = 'pending')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `periodo_resultado_version` (
  `id_version` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_periodo` int(11) NOT NULL,
  `registrado_por` int(11) NOT NULL,
  `registrado_en` datetime(3) NOT NULL,
  `instantanea` longtext NOT NULL,
  PRIMARY KEY (`id_version`),
  KEY `fk_prv_periodo` (`id_periodo`),
  KEY `fk_prv_actor` (`registrado_por`),
  CONSTRAINT `fk_prv_actor` FOREIGN KEY (`registrado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_prv_periodo` FOREIGN KEY (`id_periodo`) REFERENCES `periodo_seguimiento` (`id_periodo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `plan_flujo` (
  `id_plan` int(11) NOT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'borrador',
  `revision` int(10) unsigned NOT NULL DEFAULT 0,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `responsable_propuesto_id` int(11) DEFAULT NULL,
  `actualizado_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id_plan`),
  KEY `fk_pf_responsable` (`responsable_propuesto_id`),
  CONSTRAINT `fk_pf_plan` FOREIGN KEY (`id_plan`) REFERENCES `plan_accion` (`id_plan`),
  CONSTRAINT `fk_pf_responsable` FOREIGN KEY (`responsable_propuesto_id`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_pf_estado` CHECK (`estado` in ('borrador','presentado','en_revision','devuelto','aprobado')),
  CONSTRAINT `chk_pf_fechas` CHECK (`fecha_inicio` is null or `fecha_fin` is null or `fecha_inicio` <= `fecha_fin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `plan_indicador` (
  `id_indicador` int(11) NOT NULL AUTO_INCREMENT,
  `id_plan` int(11) NOT NULL,
  `nombre` varchar(150) DEFAULT NULL,
  `descripcion` text DEFAULT NULL,
  `formula` text DEFAULT NULL,
  `unidad` varchar(100) DEFAULT NULL,
  `fuente` text DEFAULT NULL,
  PRIMARY KEY (`id_indicador`),
  UNIQUE KEY `id_plan` (`id_plan`),
  UNIQUE KEY `uq_indicador_plan` (`id_indicador`,`id_plan`),
  CONSTRAINT `fk_pind_plan` FOREIGN KEY (`id_plan`) REFERENCES `plan_accion` (`id_plan`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `plan_institucional` (
  `id_plan` int(11) NOT NULL,
  `id_proceso` int(11) DEFAULT NULL,
  `problema` text DEFAULT NULL,
  `causas` text DEFAULT NULL,
  `consecuencias` text DEFAULT NULL,
  `objetivo_general` text DEFAULT NULL,
  `meta_descripcion` text DEFAULT NULL,
  `meta_valor` decimal(18,4) DEFAULT NULL,
  `meta_unidad` varchar(100) DEFAULT NULL,
  `responsable_principal` varchar(150) DEFAULT NULL,
  `revision` int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id_plan`),
  KEY `fk_pi_proceso` (`id_proceso`),
  CONSTRAINT `fk_pi_plan` FOREIGN KEY (`id_plan`) REFERENCES `plan_accion` (`id_plan`),
  CONSTRAINT `fk_pi_proceso` FOREIGN KEY (`id_proceso`) REFERENCES `proceso_institucional` (`id_proceso`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `plan_objetivo` (
  `id_objetivo` int(11) NOT NULL AUTO_INCREMENT,
  `id_plan` int(11) NOT NULL,
  `descripcion` text NOT NULL,
  `orden` int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id_objetivo`),
  UNIQUE KEY `uq_objetivo_plan` (`id_objetivo`,`id_plan`),
  KEY `fk_po_plan` (`id_plan`),
  CONSTRAINT `fk_po_plan` FOREIGN KEY (`id_plan`) REFERENCES `plan_accion` (`id_plan`)
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
  KEY `idx_rol_delegacion_permiso_ambito_vigencia` (`id_permiso`,`id_scope_ref`,`estado`,`vigente_desde`,`vigente_hasta`),
  KEY `idx_rol_delegacion_creado_por` (`creado_por`),
  KEY `idx_rol_delegacion_revocado_por` (`revocado_por`),
  KEY `fk_rol_delegacion_scope_ref` (`id_scope_ref`),
  CONSTRAINT `fk_rol_delegacion_creado_por` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_delegacion_delegado` FOREIGN KEY (`id_usuario_delegado`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_delegacion_delegante` FOREIGN KEY (`id_usuario_delegante`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_delegacion_permiso` FOREIGN KEY (`id_permiso`) REFERENCES `permiso` (`id_permiso`),
  CONSTRAINT `fk_rol_delegacion_revocado_por` FOREIGN KEY (`revocado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_delegacion_scope_ref` FOREIGN KEY (`id_scope_ref`) REFERENCES `rol_scope_ref` (`id_scope_ref`),
  CONSTRAINT `chk_rol_delegacion_distintos` CHECK (`id_usuario_delegante` <> `id_usuario_delegado`),
  CONSTRAINT `chk_rol_delegacion_vigencia` CHECK (`vigente_hasta` > `vigente_desde`),
  CONSTRAINT `chk_rol_delegacion_estado` CHECK (`estado` in ('active','revoked')),
  CONSTRAINT `chk_rol_delegacion_revocacion` CHECK (`estado` = 'revoked' and `revocado_por` is not null and `revocado_en` is not null or `estado` = 'active' and `revocado_por` is null and `revocado_en` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `rol_scope_permitido` (
  `id_rol` int(11) NOT NULL,
  `id_scope_ref` int(11) NOT NULL,
  PRIMARY KEY (`id_rol`,`id_scope_ref`),
  KEY `idx_rol_scope_permitido_scope` (`id_scope_ref`),
  CONSTRAINT `fk_rol_scope_permitido_rol` FOREIGN KEY (`id_rol`) REFERENCES `rol` (`id_rol`),
  CONSTRAINT `fk_rol_scope_permitido_scope_ref` FOREIGN KEY (`id_scope_ref`) REFERENCES `rol_scope_ref` (`id_scope_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `actividad_institucional` (
  `id_actividad` int(11) NOT NULL,
  `id_plan` int(11) NOT NULL,
  `nombre` varchar(150) DEFAULT NULL,
  `resultado_esperado` text DEFAULT NULL,
  `id_objetivo` int(11) DEFAULT NULL,
  `id_indicador` int(11) DEFAULT NULL,
  `metodo_verificacion` text DEFAULT NULL,
  `prioridad` varchar(5) DEFAULT NULL,
  `evidencias_esperadas` text DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `instrucciones` text DEFAULT NULL,
  `revision` int(10) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id_actividad`),
  KEY `fk_ai_actividad` (`id_actividad`,`id_plan`),
  KEY `fk_ai_objetivo` (`id_objetivo`,`id_plan`),
  KEY `fk_ai_indicador` (`id_indicador`,`id_plan`),
  CONSTRAINT `fk_ai_actividad` FOREIGN KEY (`id_actividad`, `id_plan`) REFERENCES `actividad` (`id_actividad`, `id_plan`),
  CONSTRAINT `fk_ai_indicador` FOREIGN KEY (`id_indicador`, `id_plan`) REFERENCES `plan_indicador` (`id_indicador`, `id_plan`),
  CONSTRAINT `fk_ai_objetivo` FOREIGN KEY (`id_objetivo`, `id_plan`) REFERENCES `plan_objetivo` (`id_objetivo`, `id_plan`),
  CONSTRAINT `chk_ai_prioridad` CHECK (`prioridad` is null or `prioridad` in ('alta','media','baja'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `actividad_recurso` (
  `id_recurso` int(11) NOT NULL AUTO_INCREMENT,
  `id_actividad` int(11) NOT NULL,
  `descripcion` varchar(255) NOT NULL,
  `cantidad` decimal(18,4) DEFAULT NULL,
  `costo_estimado` decimal(18,2) DEFAULT NULL,
  PRIMARY KEY (`id_recurso`),
  KEY `fk_ar_actividad` (`id_actividad`),
  CONSTRAINT `fk_ar_actividad` FOREIGN KEY (`id_actividad`) REFERENCES `actividad` (`id_actividad`),
  CONSTRAINT `chk_ar_cantidad` CHECK (`cantidad` is null or `cantidad` >= 0),
  CONSTRAINT `chk_ar_costo` CHECK (`costo_estimado` is null or `costo_estimado` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `control_hallazgo` (
  `id_hallazgo` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_plan` int(11) NOT NULL,
  `id_actividad` int(11) DEFAULT NULL,
  `titulo` varchar(200) NOT NULL,
  `descripcion` text NOT NULL,
  `observaciones` text DEFAULT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'registrado',
  `revision` int(10) unsigned NOT NULL DEFAULT 1,
  `creado_por` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_hallazgo`),
  KEY `fk_ch_plan` (`id_plan`),
  KEY `fk_ch_actividad` (`id_actividad`,`id_plan`),
  KEY `fk_ch_actor` (`creado_por`),
  CONSTRAINT `fk_ch_actividad` FOREIGN KEY (`id_actividad`, `id_plan`) REFERENCES `actividad` (`id_actividad`, `id_plan`),
  CONSTRAINT `fk_ch_actor` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_ch_plan` FOREIGN KEY (`id_plan`) REFERENCES `plan_accion` (`id_plan`),
  CONSTRAINT `chk_ch_estado` CHECK (`estado` in ('registrado','en_atencion','atendido'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `evidencia` (
  `id_evidencia` int(11) NOT NULL AUTO_INCREMENT,
  `archivo` varchar(255) DEFAULT NULL,
  `fecha_subida` date DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `id_actividad` int(11) DEFAULT NULL,
  PRIMARY KEY (`id_evidencia`),
  UNIQUE KEY `uq_evidencia_actividad` (`id_evidencia`,`id_actividad`),
  KEY `id_actividad` (`id_actividad`),
  CONSTRAINT `evidencia_ibfk_1` FOREIGN KEY (`id_actividad`) REFERENCES `actividad` (`id_actividad`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `periodo_actuacion` (
  `id_actuacion` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_periodo` int(11) NOT NULL,
  `id_solicitud` bigint(20) unsigned DEFAULT NULL,
  `accion` varchar(24) NOT NULL,
  `actor_id` int(11) NOT NULL,
  `estado_anterior` varchar(16) NOT NULL,
  `estado_nuevo` varchar(16) NOT NULL,
  `motivo` text DEFAULT NULL,
  `autoridad_referencia` varchar(200) DEFAULT NULL,
  `creado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_actuacion`),
  UNIQUE KEY `uq_pa_solicitud_accion` (`id_solicitud`,`accion`),
  KEY `fk_pa_periodo` (`id_periodo`),
  KEY `fk_pa_solicitud` (`id_solicitud`,`id_periodo`),
  KEY `fk_pa_actor` (`actor_id`),
  CONSTRAINT `fk_pa_actor` FOREIGN KEY (`actor_id`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_pa_periodo` FOREIGN KEY (`id_periodo`) REFERENCES `periodo_seguimiento` (`id_periodo`),
  CONSTRAINT `fk_pa_solicitud` FOREIGN KEY (`id_solicitud`, `id_periodo`) REFERENCES `periodo_reapertura_solicitud` (`id_solicitud`, `id_periodo`),
  CONSTRAINT `chk_pa_accion` CHECK (`accion` in ('opened','closed','reopened','reopen_requested'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `plan_flujo_evento` (
  `id_evento` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_plan` int(11) NOT NULL,
  `revision` int(10) unsigned NOT NULL,
  `accion` varchar(24) NOT NULL,
  `actor_id` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `estado_anterior` varchar(20) NOT NULL,
  `estado_nuevo` varchar(20) NOT NULL,
  `observacion` text DEFAULT NULL,
  `autoridad_referencia` varchar(200) DEFAULT NULL,
  `instantanea` longtext NOT NULL,
  `instantanea_sha256` char(64) NOT NULL,
  PRIMARY KEY (`id_evento`),
  UNIQUE KEY `uq_pfe_revision` (`id_plan`,`revision`),
  KEY `ix_pfe_historial` (`id_plan`,`id_evento`),
  KEY `fk_pfe_actor` (`actor_id`),
  CONSTRAINT `fk_pfe_actor` FOREIGN KEY (`actor_id`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_pfe_plan` FOREIGN KEY (`id_plan`) REFERENCES `plan_flujo` (`id_plan`),
  CONSTRAINT `chk_pfe_accion` CHECK (`accion` in ('ficha_actualizada','presentar','recibir','observar','devolver','aprobar')),
  CONSTRAINT `chk_pfe_anterior` CHECK (`estado_anterior` in ('borrador','presentado','en_revision','devuelto','aprobado')),
  CONSTRAINT `chk_pfe_nuevo` CHECK (`estado_nuevo` in ('borrador','presentado','en_revision','devuelto','aprobado'))
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
  KEY `idx_rol_asignacion_solapamiento` (`id_usuario`,`id_rol`,`id_scope_ref`,`estado`,`vigente_desde`,`vigente_hasta`),
  KEY `idx_rol_asignacion_creado_por` (`creado_por`),
  KEY `idx_rol_asignacion_revocado_por` (`revocado_por`),
  KEY `fk_rol_asignacion_rol_scope_permitido` (`id_rol`,`id_scope_ref`),
  CONSTRAINT `fk_rol_asignacion_creado_por` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_asignacion_revocado_por` FOREIGN KEY (`revocado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_asignacion_rol` FOREIGN KEY (`id_rol`) REFERENCES `rol` (`id_rol`),
  CONSTRAINT `fk_rol_asignacion_rol_scope_permitido` FOREIGN KEY (`id_rol`, `id_scope_ref`) REFERENCES `rol_scope_permitido` (`id_rol`, `id_scope_ref`),
  CONSTRAINT `fk_rol_asignacion_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_rol_asignacion_id_uuid_v4` CHECK (`id_asignacion` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_rol_asignacion_estado` CHECK (`estado` in ('active','scheduled','revoked')),
  CONSTRAINT `chk_rol_asignacion_vigencia` CHECK (`vigente_hasta` is null or `vigente_hasta` > `vigente_desde`),
  CONSTRAINT `chk_rol_asignacion_revocacion` CHECK (`estado` = 'revoked' and `revocado_por` is not null and `revocado_en` is not null and `motivo_revocacion` is not null or `estado` in ('active','scheduled') and `revocado_por` is null and `revocado_en` is null and `motivo_revocacion` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `seguimiento_actividad` (
  `id_seguimiento` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_actividad` int(11) NOT NULL,
  `id_periodo` int(11) NOT NULL,
  `porcentaje` decimal(5,2) NOT NULL,
  `observaciones` text DEFAULT NULL,
  `estado` varchar(16) NOT NULL DEFAULT 'pending',
  `creado_por` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id_seguimiento`),
  UNIQUE KEY `uq_seguimiento_actividad_contexto` (`id_seguimiento`,`id_actividad`),
  KEY `ix_seguimiento_actividad_periodo` (`id_actividad`,`id_periodo`,`creado_en`),
  KEY `ix_seguimiento_periodo_estado` (`id_periodo`,`estado`,`id_actividad`),
  KEY `fk_seguimiento_creador` (`creado_por`),
  CONSTRAINT `fk_seguimiento_actividad` FOREIGN KEY (`id_actividad`) REFERENCES `actividad` (`id_actividad`),
  CONSTRAINT `fk_seguimiento_creador` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_seguimiento_periodo` FOREIGN KEY (`id_periodo`) REFERENCES `periodo_seguimiento` (`id_periodo`),
  CONSTRAINT `chk_seguimiento_porcentaje` CHECK (`porcentaje` between 0 and 100),
  CONSTRAINT `chk_seguimiento_estado` CHECK (`estado` in ('pending','approved','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `control_evento` (
  `id_evento` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_hallazgo` bigint(20) unsigned NOT NULL,
  `actor_id` int(11) NOT NULL,
  `accion` varchar(40) NOT NULL,
  `detalle` longtext NOT NULL,
  `autoridad_referencia` varchar(200) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_evento`),
  KEY `fk_ce_hallazgo` (`id_hallazgo`),
  KEY `fk_ce_actor` (`actor_id`),
  CONSTRAINT `fk_ce_actor` FOREIGN KEY (`actor_id`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_ce_hallazgo` FOREIGN KEY (`id_hallazgo`) REFERENCES `control_hallazgo` (`id_hallazgo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `control_recomendacion` (
  `id_recomendacion` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_hallazgo` bigint(20) unsigned NOT NULL,
  `descripcion` text NOT NULL,
  `respuesta` text DEFAULT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'pendiente',
  `revision` int(10) unsigned NOT NULL DEFAULT 1,
  `creado_por` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_recomendacion`),
  KEY `fk_cr_hallazgo` (`id_hallazgo`),
  KEY `fk_cr_actor` (`creado_por`),
  CONSTRAINT `fk_cr_actor` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_cr_hallazgo` FOREIGN KEY (`id_hallazgo`) REFERENCES `control_hallazgo` (`id_hallazgo`),
  CONSTRAINT `chk_cr_estado` CHECK (`estado` in ('pendiente','en_atencion','atendida'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `evidencia_archivo_meta` (
  `id_evidencia` int(11) NOT NULL,
  `storage_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nombre_original` varchar(255) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `bytes` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id_evidencia`),
  UNIQUE KEY `uq_evidencia_storage_key` (`storage_key`),
  CONSTRAINT `fk_evidencia_archivo_meta` FOREIGN KEY (`id_evidencia`) REFERENCES `evidencia` (`id_evidencia`),
  CONSTRAINT `chk_evidencia_archivo_mime` CHECK (`mime_type` in ('application/pdf','image/png','image/jpeg','text/plain')),
  CONSTRAINT `chk_evidencia_archivo_bytes` CHECK (`bytes` between 1 and 10485760)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `evidencia_carga` (
  `id_evidencia` int(11) NOT NULL,
  `id_actividad` int(11) NOT NULL,
  `creado_por` int(11) NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_evidencia`),
  KEY `fk_ec_evidencia` (`id_evidencia`,`id_actividad`),
  KEY `fk_ec_actor` (`creado_por`),
  CONSTRAINT `fk_ec_actor` FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_ec_evidencia` FOREIGN KEY (`id_evidencia`, `id_actividad`) REFERENCES `evidencia` (`id_evidencia`, `id_actividad`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `evidencia_decision_institucional` (
  `id_evidencia` int(11) NOT NULL,
  `resultado` varchar(16) NOT NULL,
  `motivo` text NOT NULL,
  `decidido_por` int(11) NOT NULL,
  `decidido_en` datetime(3) NOT NULL,
  `autoridad_referencia` varchar(200) NOT NULL,
  PRIMARY KEY (`id_evidencia`),
  KEY `fk_edi_actor` (`decidido_por`),
  CONSTRAINT `fk_edi_actor` FOREIGN KEY (`decidido_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_edi_evidencia` FOREIGN KEY (`id_evidencia`) REFERENCES `evidencia` (`id_evidencia`),
  CONSTRAINT `chk_edi_resultado` CHECK (`resultado` in ('approved','rejected'))
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
  KEY `idx_rol_solicitud_pendientes` (`estado`,`id_rol`,`id_usuario_objetivo`,`id_scope_ref`,`tipo_accion`,`id_asignacion_objetivo`),
  KEY `idx_rol_solicitud_vence` (`estado`,`vence_en`),
  KEY `idx_rol_solicitud_solicitante` (`id_usuario_solicitante`),
  KEY `idx_rol_solicitud_scope_ref` (`id_scope_ref`),
  KEY `idx_rol_solicitud_asignacion_objetivo` (`id_asignacion_objetivo`),
  KEY `idx_rol_solicitud_asignacion_resultado` (`id_asignacion_resultado`),
  KEY `fk_rol_solicitud_objetivo` (`id_usuario_objetivo`),
  KEY `fk_rol_solicitud_rol_scope_permitido` (`id_rol`,`id_scope_ref`),
  CONSTRAINT `fk_rol_solicitud_asignacion_objetivo` FOREIGN KEY (`id_asignacion_objetivo`) REFERENCES `rol_asignacion` (`id_asignacion`),
  CONSTRAINT `fk_rol_solicitud_asignacion_resultado` FOREIGN KEY (`id_asignacion_resultado`) REFERENCES `rol_asignacion` (`id_asignacion`),
  CONSTRAINT `fk_rol_solicitud_objetivo` FOREIGN KEY (`id_usuario_objetivo`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_solicitud_rol` FOREIGN KEY (`id_rol`) REFERENCES `rol` (`id_rol`),
  CONSTRAINT `fk_rol_solicitud_rol_scope_permitido` FOREIGN KEY (`id_rol`, `id_scope_ref`) REFERENCES `rol_scope_permitido` (`id_rol`, `id_scope_ref`),
  CONSTRAINT `fk_rol_solicitud_solicitante` FOREIGN KEY (`id_usuario_solicitante`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_rol_solicitud_id_uuid_v4` CHECK (`id_solicitud` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_rol_solicitud_accion` CHECK (`tipo_accion` in ('assign','revoke')),
  CONSTRAINT `chk_rol_solicitud_estado` CHECK (`estado` in ('pending_approval','approved','rejected','expired')),
  CONSTRAINT `chk_rol_solicitud_campos_accion` CHECK (`tipo_accion` = 'assign' and `id_usuario_objetivo` is not null and `id_rol` is not null and `id_asignacion_objetivo` is null and `vigente_desde` is not null and (`vigente_hasta` is null or `vigente_hasta` > `vigente_desde`) or `tipo_accion` = 'revoke' and `id_usuario_objetivo` is null and `id_rol` is null and `id_scope_ref` is null and `id_asignacion_objetivo` is not null and `id_asignacion_resultado` is null and `vigente_desde` is null and `vigente_hasta` is null),
  CONSTRAINT `chk_rol_solicitud_resultado` CHECK (`id_asignacion_resultado` is null or `tipo_accion` = 'assign'),
  CONSTRAINT `chk_rol_solicitud_vence_despues` CHECK (`vence_en` > `solicitada_en`),
  CONSTRAINT `chk_rol_solicitud_aprobada_asignacion` CHECK (`estado` <> 'approved' or `tipo_accion` <> 'assign' or `id_asignacion_resultado` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `seguimiento_decision` (
  `id_decision` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `id_seguimiento` bigint(20) unsigned NOT NULL,
  `resultado` varchar(16) NOT NULL,
  `motivo` text NOT NULL,
  `decidido_por` int(11) NOT NULL,
  `decidido_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id_decision`),
  UNIQUE KEY `uq_seguimiento_decision` (`id_seguimiento`),
  KEY `ix_seguimiento_decisor_fecha` (`decidido_por`,`decidido_en`),
  CONSTRAINT `fk_decision_seguimiento` FOREIGN KEY (`id_seguimiento`) REFERENCES `seguimiento_actividad` (`id_seguimiento`),
  CONSTRAINT `fk_decision_usuario` FOREIGN KEY (`decidido_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_seguimiento_resultado` CHECK (`resultado` in ('approved','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `seguimiento_evidencia` (
  `id_seguimiento` bigint(20) unsigned NOT NULL,
  `id_evidencia` int(11) NOT NULL,
  `id_actividad` int(11) NOT NULL,
  `vinculado_por` int(11) NOT NULL,
  `vinculado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_seguimiento`,`id_evidencia`),
  KEY `fk_se_seguimiento` (`id_seguimiento`,`id_actividad`),
  KEY `fk_se_evidencia` (`id_evidencia`,`id_actividad`),
  KEY `fk_se_actor` (`vinculado_por`),
  CONSTRAINT `fk_se_actor` FOREIGN KEY (`vinculado_por`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_se_evidencia` FOREIGN KEY (`id_evidencia`, `id_actividad`) REFERENCES `evidencia` (`id_evidencia`, `id_actividad`),
  CONSTRAINT `fk_se_seguimiento` FOREIGN KEY (`id_seguimiento`, `id_actividad`) REFERENCES `seguimiento_actividad` (`id_seguimiento`, `id_actividad`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `seguimiento_formulacion` (
  `id_seguimiento` bigint(20) unsigned NOT NULL,
  `id_actividad` int(11) NOT NULL,
  `instantanea` longtext NOT NULL,
  `creado_en` datetime(3) NOT NULL,
  PRIMARY KEY (`id_seguimiento`),
  KEY `fk_sf_seguimiento` (`id_seguimiento`,`id_actividad`),
  CONSTRAINT `fk_sf_seguimiento` FOREIGN KEY (`id_seguimiento`, `id_actividad`) REFERENCES `seguimiento_actividad` (`id_seguimiento`, `id_actividad`)
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
  UNIQUE KEY `uq_rol_decision_solicitud_decision` (`id_solicitud`,`id_decision`),
  KEY `idx_rol_decision_usuario` (`id_usuario_decisor`),
  CONSTRAINT `fk_rol_decision_solicitud` FOREIGN KEY (`id_solicitud`) REFERENCES `rol_solicitud` (`id_solicitud`),
  CONSTRAINT `fk_rol_decision_usuario` FOREIGN KEY (`id_usuario_decisor`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_rol_decision_tipo_actor` CHECK (`tipo_actor` = 'system' and `id_usuario_decisor` is null and `resultado` = 'expired' or `tipo_actor` = 'user' and `id_usuario_decisor` is not null and `resultado` in ('approved','rejected'))
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
  KEY `idx_rol_auditoria_actor_fecha` (`id_usuario_actor`,`ocurrida_en`),
  KEY `idx_rol_auditoria_objetivo_fecha` (`id_usuario_objetivo`,`ocurrida_en`),
  KEY `idx_rol_auditoria_rol_fecha` (`id_rol`,`ocurrida_en`),
  KEY `idx_rol_auditoria_scope_fecha` (`id_scope_ref`,`ocurrida_en`),
  KEY `idx_rol_auditoria_solicitud_fecha` (`id_solicitud`,`ocurrida_en`),
  KEY `idx_rol_auditoria_decision` (`id_decision`),
  KEY `idx_rol_auditoria_asignacion_fecha` (`id_asignacion`,`ocurrida_en`),
  KEY `idx_rol_auditoria_delegacion_fecha` (`id_delegacion`,`ocurrida_en`),
  KEY `idx_rol_auditoria_permiso_fecha` (`id_permiso`,`ocurrida_en`),
  KEY `fk_rol_auditoria_decision_solicitud` (`id_solicitud`,`id_decision`),
  CONSTRAINT `fk_rol_auditoria_actor` FOREIGN KEY (`id_usuario_actor`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_auditoria_asignacion` FOREIGN KEY (`id_asignacion`) REFERENCES `rol_asignacion` (`id_asignacion`),
  CONSTRAINT `fk_rol_auditoria_decision_solicitud` FOREIGN KEY (`id_solicitud`, `id_decision`) REFERENCES `rol_decision` (`id_solicitud`, `id_decision`),
  CONSTRAINT `fk_rol_auditoria_delegacion` FOREIGN KEY (`id_delegacion`) REFERENCES `rol_delegacion` (`id_delegacion`),
  CONSTRAINT `fk_rol_auditoria_objetivo` FOREIGN KEY (`id_usuario_objetivo`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `fk_rol_auditoria_permiso` FOREIGN KEY (`id_permiso`) REFERENCES `permiso` (`id_permiso`),
  CONSTRAINT `fk_rol_auditoria_rol` FOREIGN KEY (`id_rol`) REFERENCES `rol` (`id_rol`),
  CONSTRAINT `fk_rol_auditoria_scope_ref` FOREIGN KEY (`id_scope_ref`) REFERENCES `rol_scope_ref` (`id_scope_ref`),
  CONSTRAINT `fk_rol_auditoria_solicitud` FOREIGN KEY (`id_solicitud`) REFERENCES `rol_solicitud` (`id_solicitud`),
  CONSTRAINT `chk_rol_auditoria_id_uuid_v4` CHECK (`id_evento` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_rol_auditoria_decision_solicitud` CHECK (`id_decision` is null or `id_solicitud` is not null),
  CONSTRAINT `chk_rol_auditoria_actor` CHECK (`tipo_actor` = 'system' and `id_usuario_actor` is null or `tipo_actor` = 'user' and `id_usuario_actor` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TRIGGER `ce_no_delete` BEFORE DELETE ON `control_evento` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Control history is append-only';

CREATE TRIGGER `ce_no_update` BEFORE UPDATE ON `control_evento` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Control history is append-only';

CREATE TRIGGER `ec_no_delete` BEFORE DELETE ON `evidencia_carga` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Upload attribution is append-only';

CREATE TRIGGER `ec_no_update` BEFORE UPDATE ON `evidencia_carga` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Upload attribution is append-only';

CREATE TRIGGER `edi_no_delete` BEFORE DELETE ON `evidencia_decision_institucional` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence decisions are append-only';

CREATE TRIGGER `edi_no_update` BEFORE UPDATE ON `evidencia_decision_institucional` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence decisions are append-only';

CREATE TRIGGER `ig_no_delete` BEFORE DELETE ON `informe_generacion` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Report history is append-only';

CREATE TRIGGER `ig_no_update` BEFORE UPDATE ON `informe_generacion` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Report history is append-only';

CREATE TRIGGER `pa_no_delete` BEFORE DELETE ON `periodo_actuacion` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Period history is append-only';

CREATE TRIGGER `pa_no_update` BEFORE UPDATE ON `periodo_actuacion` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Period history is append-only';

CREATE TRIGGER `plan_flujo_evento_no_delete` BEFORE DELETE ON `plan_flujo_evento` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Workflow history is append-only';

CREATE TRIGGER `plan_flujo_evento_no_update` BEFORE UPDATE ON `plan_flujo_evento` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Workflow history is append-only';

CREATE TRIGGER `prs_no_delete` BEFORE DELETE ON `periodo_reapertura_solicitud` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Requests are append-only';

CREATE TRIGGER `prs_no_update` BEFORE UPDATE ON `periodo_reapertura_solicitud` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Requests are append-only';

CREATE TRIGGER `prv_no_delete` BEFORE DELETE ON `periodo_resultado_version` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Closed results are append-only';

CREATE TRIGGER `prv_no_update` BEFORE UPDATE ON `periodo_resultado_version` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Closed results are append-only';

CREATE TRIGGER `se_no_delete` BEFORE DELETE ON `seguimiento_evidencia` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence links are append-only';

CREATE TRIGGER `se_no_update` BEFORE UPDATE ON `seguimiento_evidencia` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence links are append-only';

CREATE TRIGGER `sf_no_delete` BEFORE DELETE ON `seguimiento_formulacion` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Context is append-only';

CREATE TRIGGER `sf_no_update` BEFORE UPDATE ON `seguimiento_formulacion` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Context is append-only';

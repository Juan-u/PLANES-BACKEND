-- Block E: additive context/history; no existing percentage or decision is updated.
ALTER TABLE evidencia_archivo_meta DROP CONSTRAINT chk_evidencia_archivo_bytes, ADD CONSTRAINT chk_evidencia_archivo_bytes CHECK (bytes BETWEEN 1 AND 10485760);
ALTER TABLE evidencia ADD UNIQUE KEY uq_evidencia_actividad (id_evidencia,id_actividad);
ALTER TABLE seguimiento_actividad ADD UNIQUE KEY uq_seguimiento_actividad_contexto (id_seguimiento,id_actividad);
CREATE TABLE seguimiento_formulacion (
 id_seguimiento BIGINT UNSIGNED NOT NULL PRIMARY KEY, id_actividad INT NOT NULL,
 instantanea LONGTEXT NOT NULL, creado_en DATETIME(3) NOT NULL,
 CONSTRAINT fk_sf_seguimiento FOREIGN KEY (id_seguimiento,id_actividad) REFERENCES seguimiento_actividad(id_seguimiento,id_actividad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE evidencia_carga (
 id_evidencia INT NOT NULL PRIMARY KEY, id_actividad INT NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME(3) NOT NULL,
 CONSTRAINT fk_ec_evidencia FOREIGN KEY (id_evidencia,id_actividad) REFERENCES evidencia(id_evidencia,id_actividad),
 CONSTRAINT fk_ec_actor FOREIGN KEY (creado_por) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE seguimiento_evidencia (
 id_seguimiento BIGINT UNSIGNED NOT NULL, id_evidencia INT NOT NULL, id_actividad INT NOT NULL,
 vinculado_por INT NOT NULL, vinculado_en DATETIME(3) NOT NULL,
 PRIMARY KEY (id_seguimiento,id_evidencia),
 CONSTRAINT fk_se_seguimiento FOREIGN KEY (id_seguimiento,id_actividad) REFERENCES seguimiento_actividad(id_seguimiento,id_actividad),
 CONSTRAINT fk_se_evidencia FOREIGN KEY (id_evidencia,id_actividad) REFERENCES evidencia(id_evidencia,id_actividad),
 CONSTRAINT fk_se_actor FOREIGN KEY (vinculado_por) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE evidencia_decision_institucional (
 id_evidencia INT NOT NULL PRIMARY KEY, resultado VARCHAR(16) NOT NULL,
 motivo TEXT NOT NULL, decidido_por INT NOT NULL, decidido_en DATETIME(3) NOT NULL,
 autoridad_referencia VARCHAR(200) NOT NULL,
 CONSTRAINT chk_edi_resultado CHECK (resultado IN ('approved','rejected')),
 CONSTRAINT fk_edi_evidencia FOREIGN KEY (id_evidencia) REFERENCES evidencia(id_evidencia),
 CONSTRAINT fk_edi_actor FOREIGN KEY (decidido_por) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE periodo_reapertura_solicitud (
 id_solicitud BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_periodo INT NOT NULL, solicitado_por INT NOT NULL, motivo TEXT NOT NULL,
 client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 solicitado_en DATETIME(3) NOT NULL, estado VARCHAR(16) NOT NULL DEFAULT 'pending',
 UNIQUE KEY uq_prs_client (id_periodo,solicitado_por,client_id),
 UNIQUE KEY uq_prs_periodo (id_solicitud,id_periodo),
 CONSTRAINT chk_prs_estado CHECK (estado='pending'),
 CONSTRAINT fk_prs_periodo FOREIGN KEY (id_periodo) REFERENCES periodo_seguimiento(id_periodo),
 CONSTRAINT fk_prs_actor FOREIGN KEY (solicitado_por) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE periodo_actuacion (
 id_actuacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_periodo INT NOT NULL, id_solicitud BIGINT UNSIGNED NULL, accion VARCHAR(24) NOT NULL, actor_id INT NOT NULL,
 estado_anterior VARCHAR(16) NOT NULL, estado_nuevo VARCHAR(16) NOT NULL,
 motivo TEXT NULL, autoridad_referencia VARCHAR(200) NULL, creado_en DATETIME(3) NOT NULL,
 UNIQUE KEY uq_pa_solicitud_accion (id_solicitud,accion),
 CONSTRAINT chk_pa_accion CHECK (accion IN ('opened','closed','reopened','reopen_requested')),
 CONSTRAINT fk_pa_periodo FOREIGN KEY (id_periodo) REFERENCES periodo_seguimiento(id_periodo),
 CONSTRAINT fk_pa_solicitud FOREIGN KEY (id_solicitud,id_periodo) REFERENCES periodo_reapertura_solicitud(id_solicitud,id_periodo),
 CONSTRAINT fk_pa_actor FOREIGN KEY (actor_id) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE periodo_resultado_version (
 id_version BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_periodo INT NOT NULL, registrado_por INT NOT NULL, registrado_en DATETIME(3) NOT NULL,
 instantanea LONGTEXT NOT NULL,
 CONSTRAINT fk_prv_periodo FOREIGN KEY (id_periodo) REFERENCES periodo_seguimiento(id_periodo),
 CONSTRAINT fk_prv_actor FOREIGN KEY (registrado_por) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TRIGGER sf_no_update BEFORE UPDATE ON seguimiento_formulacion FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Context is append-only';
CREATE TRIGGER sf_no_delete BEFORE DELETE ON seguimiento_formulacion FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Context is append-only';
CREATE TRIGGER se_no_update BEFORE UPDATE ON seguimiento_evidencia FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence links are append-only';
CREATE TRIGGER se_no_delete BEFORE DELETE ON seguimiento_evidencia FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence links are append-only';
CREATE TRIGGER edi_no_update BEFORE UPDATE ON evidencia_decision_institucional FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence decisions are append-only';
CREATE TRIGGER edi_no_delete BEFORE DELETE ON evidencia_decision_institucional FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidence decisions are append-only';
CREATE TRIGGER pa_no_update BEFORE UPDATE ON periodo_actuacion FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Period history is append-only';
CREATE TRIGGER pa_no_delete BEFORE DELETE ON periodo_actuacion FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Period history is append-only';
CREATE TRIGGER prv_no_update BEFORE UPDATE ON periodo_resultado_version FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Closed results are append-only';
CREATE TRIGGER prv_no_delete BEFORE DELETE ON periodo_resultado_version FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Closed results are append-only';
CREATE TRIGGER prs_no_update BEFORE UPDATE ON periodo_reapertura_solicitud FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Requests are append-only';
CREATE TRIGGER prs_no_delete BEFORE DELETE ON periodo_reapertura_solicitud FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Requests are append-only';
CREATE TRIGGER ec_no_update BEFORE UPDATE ON evidencia_carga FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Upload attribution is append-only';
CREATE TRIGGER ec_no_delete BEFORE DELETE ON evidencia_carga FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Upload attribution is append-only';

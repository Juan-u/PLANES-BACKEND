-- Block F: additive only. No permission, role or legacy data changes.
CREATE TABLE control_hallazgo (
 id_hallazgo BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_plan INT NOT NULL, id_actividad INT NULL,
 titulo VARCHAR(200) NOT NULL, descripcion TEXT NOT NULL,
 observaciones TEXT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'registrado',
 revision INT UNSIGNED NOT NULL DEFAULT 1, creado_por INT NOT NULL,
 creado_en DATETIME(3) NOT NULL,
 CONSTRAINT fk_ch_plan FOREIGN KEY (id_plan) REFERENCES plan_accion(id_plan),
 CONSTRAINT fk_ch_actividad FOREIGN KEY (id_actividad,id_plan) REFERENCES actividad(id_actividad,id_plan),
 CONSTRAINT fk_ch_actor FOREIGN KEY (creado_por) REFERENCES usuario(id_usuario),
 CONSTRAINT chk_ch_estado CHECK (estado IN ('registrado','en_atencion','atendido'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE control_recomendacion (
 id_recomendacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_hallazgo BIGINT UNSIGNED NOT NULL, descripcion TEXT NOT NULL,
 respuesta TEXT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
 revision INT UNSIGNED NOT NULL DEFAULT 1, creado_por INT NOT NULL, creado_en DATETIME(3) NOT NULL,
 CONSTRAINT fk_cr_hallazgo FOREIGN KEY (id_hallazgo) REFERENCES control_hallazgo(id_hallazgo),
 CONSTRAINT fk_cr_actor FOREIGN KEY (creado_por) REFERENCES usuario(id_usuario),
 CONSTRAINT chk_cr_estado CHECK (estado IN ('pendiente','en_atencion','atendida'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE control_evento (
 id_evento BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_hallazgo BIGINT UNSIGNED NOT NULL, actor_id INT NOT NULL,
 accion VARCHAR(40) NOT NULL, detalle LONGTEXT NOT NULL,
 autoridad_referencia VARCHAR(200) NOT NULL, creado_en DATETIME(3) NOT NULL,
 CONSTRAINT fk_ce_hallazgo FOREIGN KEY (id_hallazgo) REFERENCES control_hallazgo(id_hallazgo),
 CONSTRAINT fk_ce_actor FOREIGN KEY (actor_id) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE informe_generacion (
 id_informe CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 actor_id INT NOT NULL, formato VARCHAR(10) NOT NULL, caracter VARCHAR(12) NOT NULL,
 filtros LONGTEXT NOT NULL, contenido_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
 creado_en DATETIME(3) NOT NULL,
 CONSTRAINT fk_ig_actor FOREIGN KEY (actor_id) REFERENCES usuario(id_usuario),
 CONSTRAINT chk_ig_formato CHECK (formato IN ('csv','print')),
 CONSTRAINT chk_ig_caracter CHECK (caracter='analitico')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TRIGGER ce_no_update BEFORE UPDATE ON control_evento FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Control history is append-only';
CREATE TRIGGER ce_no_delete BEFORE DELETE ON control_evento FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Control history is append-only';
CREATE TRIGGER ig_no_update BEFORE UPDATE ON informe_generacion FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Report history is append-only';
CREATE TRIGGER ig_no_delete BEFORE DELETE ON informe_generacion FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Report history is append-only';

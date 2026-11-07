-- Block D: additive, independent from activity/period/follow-up state.
-- No existing records are enrolled or transitioned by this migration.
CREATE TABLE plan_flujo (
 id_plan INT NOT NULL PRIMARY KEY,
 estado VARCHAR(20) NOT NULL DEFAULT 'borrador',
 revision INT UNSIGNED NOT NULL DEFAULT 0,
 fecha_inicio DATE NULL, fecha_fin DATE NULL,
 responsable_propuesto_id INT NULL,
 actualizado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_pf_plan FOREIGN KEY (id_plan) REFERENCES plan_accion(id_plan),
 CONSTRAINT fk_pf_responsable FOREIGN KEY (responsable_propuesto_id) REFERENCES usuario(id_usuario),
 CONSTRAINT chk_pf_estado CHECK (estado IN ('borrador','presentado','en_revision','devuelto','aprobado')),
 CONSTRAINT chk_pf_fechas CHECK (fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_inicio <= fecha_fin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE plan_flujo_evento (
 id_evento BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 id_plan INT NOT NULL, revision INT UNSIGNED NOT NULL,
 accion VARCHAR(24) NOT NULL, actor_id INT NOT NULL,
 creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 estado_anterior VARCHAR(20) NOT NULL, estado_nuevo VARCHAR(20) NOT NULL,
 observacion TEXT NULL, autoridad_referencia VARCHAR(200) NULL,
 instantanea LONGTEXT NOT NULL, instantanea_sha256 CHAR(64) NOT NULL,
 UNIQUE KEY uq_pfe_revision (id_plan,revision),
 KEY ix_pfe_historial (id_plan,id_evento),
 CONSTRAINT fk_pfe_plan FOREIGN KEY (id_plan) REFERENCES plan_flujo(id_plan),
 CONSTRAINT fk_pfe_actor FOREIGN KEY (actor_id) REFERENCES usuario(id_usuario),
 CONSTRAINT chk_pfe_accion CHECK (accion IN ('ficha_actualizada','presentar','recibir','observar','devolver','aprobar')),
 CONSTRAINT chk_pfe_anterior CHECK (estado_anterior IN ('borrador','presentado','en_revision','devuelto','aprobado')),
 CONSTRAINT chk_pfe_nuevo CHECK (estado_nuevo IN ('borrador','presentado','en_revision','devuelto','aprobado'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TRIGGER plan_flujo_evento_no_update BEFORE UPDATE ON plan_flujo_evento FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Workflow history is append-only';
CREATE TRIGGER plan_flujo_evento_no_delete BEFORE DELETE ON plan_flujo_evento FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Workflow history is append-only';

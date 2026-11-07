-- Bloque C: additive institutional drafts. Does not update legacy rows or permissions.
CREATE TABLE proceso_institucional (
 id_proceso INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 nombre VARCHAR(150) NOT NULL UNIQUE,
 activo TINYINT NOT NULL DEFAULT 1,
 CONSTRAINT chk_proceso_institucional_activo CHECK (activo IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE plan_institucional (
 id_plan INT NOT NULL PRIMARY KEY,
 id_proceso INT NULL,
 problema TEXT NULL, causas TEXT NULL, consecuencias TEXT NULL, objetivo_general TEXT NULL,
 meta_descripcion TEXT NULL, meta_valor DECIMAL(18,4) NULL, meta_unidad VARCHAR(100) NULL,
 responsable_principal VARCHAR(150) NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 CONSTRAINT fk_pi_plan FOREIGN KEY (id_plan) REFERENCES plan_accion(id_plan),
 CONSTRAINT fk_pi_proceso FOREIGN KEY (id_proceso) REFERENCES proceso_institucional(id_proceso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE plan_objetivo (
 id_objetivo INT NOT NULL AUTO_INCREMENT PRIMARY KEY, id_plan INT NOT NULL,
 descripcion TEXT NOT NULL, orden INT UNSIGNED NOT NULL DEFAULT 0,
 UNIQUE KEY uq_objetivo_plan (id_objetivo,id_plan),
 CONSTRAINT fk_po_plan FOREIGN KEY (id_plan) REFERENCES plan_accion(id_plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE plan_indicador (
 id_indicador INT NOT NULL AUTO_INCREMENT PRIMARY KEY, id_plan INT NOT NULL UNIQUE,
 nombre VARCHAR(150) NULL, descripcion TEXT NULL, formula TEXT NULL, unidad VARCHAR(100) NULL, fuente TEXT NULL,
 UNIQUE KEY uq_indicador_plan (id_indicador,id_plan),
 CONSTRAINT fk_pind_plan FOREIGN KEY (id_plan) REFERENCES plan_accion(id_plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE actividad ADD UNIQUE KEY uq_actividad_plan_institucional (id_actividad,id_plan);
CREATE TABLE actividad_institucional (
 id_actividad INT NOT NULL PRIMARY KEY, id_plan INT NOT NULL,
 nombre VARCHAR(150) NULL, resultado_esperado TEXT NULL,
 id_objetivo INT NULL, id_indicador INT NULL,
 metodo_verificacion TEXT NULL, prioridad VARCHAR(5) NULL,
 evidencias_esperadas TEXT NULL, observaciones TEXT NULL, instrucciones TEXT NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 CONSTRAINT fk_ai_actividad FOREIGN KEY (id_actividad,id_plan) REFERENCES actividad(id_actividad,id_plan),
 CONSTRAINT fk_ai_objetivo FOREIGN KEY (id_objetivo,id_plan) REFERENCES plan_objetivo(id_objetivo,id_plan),
 CONSTRAINT fk_ai_indicador FOREIGN KEY (id_indicador,id_plan) REFERENCES plan_indicador(id_indicador,id_plan),
 CONSTRAINT chk_ai_prioridad CHECK (prioridad IS NULL OR prioridad IN ('alta','media','baja'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE actividad_recurso (
 id_recurso INT NOT NULL AUTO_INCREMENT PRIMARY KEY, id_actividad INT NOT NULL,
 descripcion VARCHAR(255) NOT NULL, cantidad DECIMAL(18,4) NULL, costo_estimado DECIMAL(18,2) NULL,
 CONSTRAINT fk_ar_actividad FOREIGN KEY (id_actividad) REFERENCES actividad(id_actividad),
 CONSTRAINT chk_ar_cantidad CHECK (cantidad IS NULL OR cantidad >= 0),
 CONSTRAINT chk_ar_costo CHECK (costo_estimado IS NULL OR costo_estimado >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE registro_cambio_institucional (
 id_cambio BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 entidad VARCHAR(10) NOT NULL, id_registro INT NOT NULL, actor_id INT NOT NULL,
 creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 antes LONGTEXT NULL, despues LONGTEXT NOT NULL,
 CONSTRAINT chk_rci_entidad CHECK (entidad IN ('plan','actividad')),
 CONSTRAINT fk_rci_actor FOREIGN KEY (actor_id) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

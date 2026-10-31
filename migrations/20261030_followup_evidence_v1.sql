-- Borrador aditivo para seguimiento por actividad y almacenamiento de evidencias.
-- No ejecutar contra la base comercial. Requiere comparar tipos y motores con el entorno aislado.
CREATE TABLE periodo_seguimiento (
  id_periodo INT NOT NULL AUTO_INCREMENT,
  anio SMALLINT UNSIGNED NOT NULL,
  trimestre TINYINT UNSIGNED NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(16) NOT NULL DEFAULT 'open',
  creado_por INT(11) NOT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id_periodo),
  UNIQUE KEY uq_periodo_anio_trimestre (anio, trimestre),
  KEY ix_periodo_fechas_estado (fecha_inicio, fecha_fin, estado),
  CONSTRAINT chk_periodo_trimestre CHECK (trimestre BETWEEN 1 AND 4),
  CONSTRAINT chk_periodo_fechas CHECK (fecha_inicio <= fecha_fin),
  CONSTRAINT chk_periodo_estado CHECK (estado IN ('open', 'closed')),
  CONSTRAINT fk_periodo_creador FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE seguimiento_actividad (
  id_seguimiento BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_actividad INT(11) NOT NULL,
  id_periodo INT NOT NULL,
  porcentaje DECIMAL(5,2) NOT NULL,
  observaciones TEXT DEFAULT NULL,
  estado VARCHAR(16) NOT NULL DEFAULT 'pending',
  creado_por INT(11) NOT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id_seguimiento),
  KEY ix_seguimiento_actividad_periodo (id_actividad, id_periodo, creado_en),
  KEY ix_seguimiento_periodo_estado (id_periodo, estado, id_actividad),
  CONSTRAINT chk_seguimiento_porcentaje CHECK (porcentaje BETWEEN 0 AND 100),
  CONSTRAINT chk_seguimiento_estado CHECK (estado IN ('pending', 'approved', 'rejected')),
  CONSTRAINT fk_seguimiento_actividad FOREIGN KEY (id_actividad) REFERENCES actividad (id_actividad) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_seguimiento_periodo FOREIGN KEY (id_periodo) REFERENCES periodo_seguimiento (id_periodo) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_seguimiento_creador FOREIGN KEY (creado_por) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE seguimiento_decision (
  id_decision BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_seguimiento BIGINT UNSIGNED NOT NULL,
  resultado VARCHAR(16) NOT NULL,
  motivo TEXT NOT NULL,
  decidido_por INT(11) NOT NULL,
  decidido_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id_decision),
  UNIQUE KEY uq_seguimiento_decision (id_seguimiento),
  KEY ix_seguimiento_decisor_fecha (decidido_por, decidido_en),
  CONSTRAINT chk_seguimiento_resultado CHECK (resultado IN ('approved', 'rejected')),
  CONSTRAINT fk_decision_seguimiento FOREIGN KEY (id_seguimiento) REFERENCES seguimiento_actividad (id_seguimiento) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_decision_usuario FOREIGN KEY (decidido_por) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE evidencia_archivo_meta (
  id_evidencia INT(11) NOT NULL,
  storage_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bytes INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_evidencia),
  UNIQUE KEY uq_evidencia_storage_key (storage_key),
  CONSTRAINT chk_evidencia_archivo_bytes CHECK (bytes BETWEEN 1 AND 65536),
  CONSTRAINT chk_evidencia_archivo_mime CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  CONSTRAINT fk_evidencia_archivo_meta FOREIGN KEY (id_evidencia) REFERENCES evidencia (id_evidencia) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

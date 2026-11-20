-- Módulos adicionales del entregable: evidencias, revisión, auditoría y notificaciones.
CREATE TABLE IF NOT EXISTS evidencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  calificacion_id INT NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NULL,
  tamano_bytes BIGINT NOT NULL DEFAULT 0,
  cargado_por INT NULL,
  fecha_carga DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_evidencias_calificacion FOREIGN KEY (calificacion_id) REFERENCES calificacion(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_evidencias_usuario FOREIGN KEY (cargado_por) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS revisiones_calificacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  calificacion_id INT NOT NULL UNIQUE,
  estado ENUM('Pendiente','Aprobada','Observada') NOT NULL DEFAULT 'Pendiente',
  observacion TEXT NULL,
  revisado_por INT NULL,
  fecha_revision DATETIME NULL,
  CONSTRAINT fk_revision_calificacion FOREIGN KEY (calificacion_id) REFERENCES calificacion(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_revision_usuario FOREIGN KEY (revisado_por) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS logs_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  accion VARCHAR(100) NOT NULL,
  entidad VARCHAR(100) NOT NULL,
  entidad_id VARCHAR(100) NULL,
  detalle TEXT NULL,
  ip VARCHAR(64) NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_fecha (fecha),
  INDEX idx_logs_usuario (usuario_id),
  CONSTRAINT fk_logs_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS notificaciones (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  titulo VARCHAR(180) NOT NULL,
  mensaje TEXT NOT NULL,
  tipo VARCHAR(50) NOT NULL DEFAULT 'info',
  leida TINYINT(1) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notificaciones_usuario (usuario_id, leida),
  CONSTRAINT fk_notificaciones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE
);

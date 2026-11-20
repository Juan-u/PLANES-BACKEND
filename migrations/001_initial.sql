-- Esquema local para el Sistema de Planes de Acción.
-- Ejecutar en una base de datos de pruebas vacía.
CREATE TABLE IF NOT EXISTS areas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  correo VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  estado ENUM('Activo','Inactivo') NOT NULL DEFAULT 'Activo',
  area_id INT NULL,
  rol_id INT NOT NULL,
  CONSTRAINT fk_usuarios_area FOREIGN KEY (area_id) REFERENCES areas(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS periodos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado ENUM('Cerrado','Abierto') NOT NULL DEFAULT 'Cerrado'
);

-- Planes y actividades usados por las pantallas actuales.
CREATE TABLE IF NOT EXISTS plan_accion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT NULL,
  fecha_creacion DATE NOT NULL,
  estado ENUM('Activo','Inactivo') NOT NULL DEFAULT 'Activo'
);

CREATE TABLE IF NOT EXISTS actividad (
  id_actividad INT AUTO_INCREMENT PRIMARY KEY,
  descripcion TEXT NOT NULL,
  responsable VARCHAR(150) NULL,
  fecha_inicio DATE NULL,
  fecha_fin DATE NULL,
  estado ENUM('Pendiente','En progreso','Completada') NOT NULL DEFAULT 'Pendiente',
  id_plan INT NOT NULL,
  CONSTRAINT fk_actividad_plan FOREIGN KEY (id_plan) REFERENCES plan_accion(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Planeación por área y periodo, usada por el módulo de calificaciones.
CREATE TABLE IF NOT EXISTS planeacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actividad TEXT NOT NULL,
  area_id INT NOT NULL,
  periodo_id INT NOT NULL,
  CONSTRAINT fk_planeacion_area FOREIGN KEY (area_id) REFERENCES areas(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_planeacion_periodo FOREIGN KEY (periodo_id) REFERENCES periodos(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS calificacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  planeacion_id INT NOT NULL,
  periodo_id INT NOT NULL,
  resultado_obtenido DECIMAL(10,2) NULL,
  observacion TEXT NULL,
  fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_calificacion_planeacion FOREIGN KEY (planeacion_id) REFERENCES planeacion(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_calificacion_periodo FOREIGN KEY (periodo_id) REFERENCES periodos(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uk_calificacion_periodo UNIQUE (planeacion_id, periodo_id)
);

INSERT IGNORE INTO roles (id, nombre) VALUES (1, 'Administrador'), (2, 'Coordinador'), (3, 'Funcionario');
INSERT IGNORE INTO areas (nombre) VALUES ('Planeación'), ('Administración'), ('Talento Humano');

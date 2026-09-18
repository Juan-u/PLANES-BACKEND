-- ============================================
-- BASE DE DATOS: SISTEMA PLANES DE ACCIÓN
-- MIGRACIÓN 001
-- ============================================

-- ============================================
-- TABLA: areas
-- ============================================

CREATE TABLE IF NOT EXISTS areas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL UNIQUE
);


-- ============================================
-- TABLA: usuarios
-- ============================================

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    correo VARCHAR(150) NOT NULL UNIQUE,
    contraseña VARCHAR(255) NOT NULL,
    estado ENUM('Activo', 'Inactivo') NOT NULL DEFAULT 'Activo',
    area_id INT NULL,

    CONSTRAINT fk_usuarios_area
        FOREIGN KEY (area_id)
        REFERENCES areas(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);


-- ============================================
-- TABLA: periodos
-- ============================================

CREATE TABLE IF NOT EXISTS periodos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL
);


-- ============================================
-- TABLA: planeacion
-- ============================================

CREATE TABLE IF NOT EXISTS planeacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actividad TEXT NOT NULL,
    area_id INT NOT NULL,
    periodo_id INT NOT NULL,

    CONSTRAINT fk_planeacion_area
        FOREIGN KEY (area_id)
        REFERENCES areas(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_planeacion_periodo
        FOREIGN KEY (periodo_id)
        REFERENCES periodos(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);


-- ============================================
-- TABLA: calificacion
-- ============================================

CREATE TABLE IF NOT EXISTS calificacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    planeacion_id INT NOT NULL,
    resultado_obtenido DECIMAL(10,2) NULL,

    CONSTRAINT fk_calificacion_planeacion
        FOREIGN KEY (planeacion_id)
        REFERENCES planeacion(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

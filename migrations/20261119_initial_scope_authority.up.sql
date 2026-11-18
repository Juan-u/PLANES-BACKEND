-- Adds an explicit, one-time, two-person process for establishing initial
-- institutional scope authority. It does not assign the role to any user.
CREATE TABLE rol_scope_authority_request (
  id_solicitud CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id_usuario_objetivo INT NOT NULL,
  id_plan INT NOT NULL,
  referencia_institucional VARCHAR(255) NOT NULL,
  motivo TEXT NOT NULL,
  vigente_desde DATETIME(3) NOT NULL,
  vigente_hasta DATETIME(3) NOT NULL,
  id_usuario_solicitante INT NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'pending',
  id_usuario_decisor INT NULL,
  referencia_decision VARCHAR(255) NULL,
  motivo_decision TEXT NULL,
  decidida_en DATETIME(3) NULL,
  id_scope_ref INT NULL,
  id_asignacion CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  solicitada_en DATETIME(3) NOT NULL,
  PRIMARY KEY (id_solicitud),
  KEY ix_scope_authority_plan_state (id_plan, estado),
  KEY ix_scope_authority_target (id_usuario_objetivo, solicitada_en),
  UNIQUE KEY uq_scope_authority_assignment (id_asignacion),
  CONSTRAINT fk_scope_authority_target FOREIGN KEY (id_usuario_objetivo) REFERENCES usuario (id_usuario),
  CONSTRAINT fk_scope_authority_plan FOREIGN KEY (id_plan) REFERENCES plan_accion (id_plan),
  CONSTRAINT fk_scope_authority_requester FOREIGN KEY (id_usuario_solicitante) REFERENCES usuario (id_usuario),
  CONSTRAINT fk_scope_authority_decider FOREIGN KEY (id_usuario_decisor) REFERENCES usuario (id_usuario),
  CONSTRAINT fk_scope_authority_scope FOREIGN KEY (id_scope_ref) REFERENCES rol_scope_ref (id_scope_ref),
  CONSTRAINT fk_scope_authority_assignment FOREIGN KEY (id_asignacion) REFERENCES rol_asignacion (id_asignacion),
  CONSTRAINT chk_scope_authority_request_uuid CHECK (
    id_solicitud REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT chk_scope_authority_assignment_uuid CHECK (
    id_asignacion IS NULL OR id_asignacion REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT chk_scope_authority_state CHECK (estado IN ('pending', 'approved', 'rejected')),
  CONSTRAINT chk_scope_authority_validity CHECK (vigente_hasta > vigente_desde),
  CONSTRAINT chk_scope_authority_decision CHECK (
    (estado = 'pending' AND id_usuario_decisor IS NULL AND referencia_decision IS NULL
      AND motivo_decision IS NULL AND decidida_en IS NULL AND id_scope_ref IS NULL AND id_asignacion IS NULL)
    OR
    (estado IN ('approved', 'rejected') AND id_usuario_decisor IS NOT NULL
      AND referencia_decision IS NOT NULL AND motivo_decision IS NOT NULL AND decidida_en IS NOT NULL
      AND ((estado = 'approved' AND id_scope_ref IS NOT NULL AND id_asignacion IS NOT NULL)
        OR (estado = 'rejected' AND id_scope_ref IS NULL AND id_asignacion IS NULL))
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO rol (nombre_rol, descripcion)
SELECT 'scope_authority_manager',
       'Gestión institucional de roles dentro de un ámbito autorizado'
 WHERE NOT EXISTS (
   SELECT 1 FROM rol WHERE BINARY nombre_rol = BINARY 'scope_authority_manager'
 );

INSERT INTO rol_configuracion
  (id_rol, clasificacion_privilegio, permite_vigencia_indefinida, requiere_ambito)
SELECT id_rol, 'ordinary', 0, 1
  FROM rol AS r
 WHERE BINARY r.nombre_rol = BINARY 'scope_authority_manager'
   AND NOT EXISTS (
     SELECT 1 FROM rol_configuracion AS config WHERE config.id_rol = r.id_rol
   );

INSERT INTO permiso (codigo, descripcion, activo)
SELECT 'M01.roles.manage_scope',
       'Autoridad institucional de gestión de roles dentro del ámbito asignado',
       1
 WHERE NOT EXISTS (
   SELECT 1 FROM permiso WHERE BINARY codigo = BINARY 'M01.roles.manage_scope'
 );

INSERT INTO permiso (codigo, descripcion, activo)
SELECT operation.codigo, 'Operación de administración de asignaciones de roles', 1
  FROM (
    SELECT 'assign-role' AS codigo
    UNION ALL SELECT 'revoke-role'
    UNION ALL SELECT 'approve-role-change'
  ) AS operation
 WHERE NOT EXISTS (
   SELECT 1 FROM permiso WHERE BINARY permiso.codigo = BINARY operation.codigo
 );

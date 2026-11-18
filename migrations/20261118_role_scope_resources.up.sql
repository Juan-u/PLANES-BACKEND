-- Typed, explicit links from authorization scopes to institutional resources.
-- Existing rol_scope_ref rows are intentionally left unassociated.
CREATE TABLE rol_scope_recurso (
  id_scope_ref INT NOT NULL PRIMARY KEY,
  tipo_recurso VARCHAR(12) NOT NULL,
  id_plan INT NOT NULL,
  id_actividad INT NULL,
  UNIQUE KEY uq_scope_recurso_plan (tipo_recurso, id_plan),
  UNIQUE KEY uq_scope_recurso_actividad (tipo_recurso, id_actividad),
  KEY ix_scope_recurso_actividad_plan (id_actividad, id_plan),
  CONSTRAINT fk_scope_recurso_scope
    FOREIGN KEY (id_scope_ref) REFERENCES rol_scope_ref (id_scope_ref),
  CONSTRAINT fk_scope_recurso_plan
    FOREIGN KEY (id_plan) REFERENCES plan_accion (id_plan),
  CONSTRAINT fk_scope_recurso_actividad_plan
    FOREIGN KEY (id_actividad, id_plan) REFERENCES actividad (id_actividad, id_plan),
  CONSTRAINT chk_scope_recurso_tipo
    CHECK (
      (tipo_recurso = 'plan' AND id_actividad IS NULL)
      OR       (tipo_recurso = 'activity' AND id_actividad IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

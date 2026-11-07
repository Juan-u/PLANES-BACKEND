-- Destructive rollback of NEW institutional information only. Export it first.
-- No legacy plan/activity/user rows are deleted or altered by this rollback.
DROP TABLE registro_cambio_institucional;
DROP TABLE actividad_recurso;
DROP TABLE actividad_institucional;
ALTER TABLE actividad DROP INDEX uq_actividad_plan_institucional;
DROP TABLE plan_indicador;
DROP TABLE plan_objetivo;
DROP TABLE plan_institucional;
DROP TABLE proceso_institucional;

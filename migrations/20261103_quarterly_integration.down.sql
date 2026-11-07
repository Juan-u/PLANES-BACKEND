-- Manual authorized rollback only. Export context/history and files >64 KiB first.
-- Never run automatically. Restoring the old size constraint fails if larger files remain.
ALTER TABLE evidencia_archivo_meta DROP CONSTRAINT chk_evidencia_archivo_bytes, ADD CONSTRAINT chk_evidencia_archivo_bytes CHECK (bytes BETWEEN 1 AND 65536);
DROP TRIGGER ec_no_delete;
DROP TRIGGER ec_no_update;
DROP TRIGGER prs_no_delete;
DROP TRIGGER prs_no_update;
DROP TRIGGER prv_no_delete;
DROP TRIGGER prv_no_update;
DROP TRIGGER pa_no_delete;
DROP TRIGGER pa_no_update;
DROP TRIGGER edi_no_delete;
DROP TRIGGER edi_no_update;
DROP TRIGGER se_no_delete;
DROP TRIGGER se_no_update;
DROP TRIGGER sf_no_delete;
DROP TRIGGER sf_no_update;
DROP TABLE periodo_resultado_version;
DROP TABLE periodo_actuacion;
DROP TABLE periodo_reapertura_solicitud;
DROP TABLE evidencia_decision_institucional;
DROP TABLE seguimiento_evidencia;
DROP TABLE evidencia_carga;
DROP TABLE seguimiento_formulacion;
ALTER TABLE seguimiento_actividad DROP INDEX uq_seguimiento_actividad_contexto;
ALTER TABLE evidencia DROP INDEX uq_evidencia_actividad;

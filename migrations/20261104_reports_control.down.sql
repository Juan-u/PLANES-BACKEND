-- Manual recovery only, after verified backup/export of all F records.
DROP TRIGGER ig_no_delete;
DROP TRIGGER ig_no_update;
DROP TRIGGER ce_no_delete;
DROP TRIGGER ce_no_update;
DROP TABLE informe_generacion;
DROP TABLE control_evento;
DROP TABLE control_recomendacion;
DROP TABLE control_hallazgo;

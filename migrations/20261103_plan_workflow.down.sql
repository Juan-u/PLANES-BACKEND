-- Manual recovery only. Export workflow information before any authorized rollback.
-- Never executed automatically, including by the integration harness.
DROP TRIGGER plan_flujo_evento_no_delete;
DROP TRIGGER plan_flujo_evento_no_update;
DROP TABLE plan_flujo_evento;
DROP TABLE plan_flujo;

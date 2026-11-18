-- Manual rollback only. This removes typed resource links added after the up migration.
-- It does not delete legacy rol_scope_ref rows or role assignments.
-- Before running, separately review and deactivate any assignments using these scopes;
-- otherwise their references remain active but lose their verifiable resource mapping.
DROP TABLE rol_scope_recurso;

-- Only the NEW empty cloud test schema. Never planes_accion_test.
CREATE TABLE web_sessions (
  session_id varchar(128) COLLATE utf8mb4_bin NOT NULL,
  expires int unsigned NOT NULL,
  data mediumtext COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id),
  KEY ix_web_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

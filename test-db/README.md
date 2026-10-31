# Local isolated MariaDB integration-test environment

This Compose project is separate from the application `.env` and the commercial database. It starts a fresh MariaDB 10.4.32 container, binds only to loopback port 3307, and does not reuse a host data volume.

It mounts the reference SQL dump read-only. Inspection confirmed that the dump contains structure and indexes/foreign keys but no INSERT statements or plan rows. The additive role migration inserts only its required mutex singleton. Follow-up/evidence migration is mounted after it. All initialization is confined to a new, empty container.

Docker Desktop must be running. Create a local env file from the blank example and provide two new throwaway values. Do not copy credentials from `.env` or any commercial environment. The actual `.env.test` is ignored by Git if created locally; do not commit it.

```powershell
Copy-Item test-db/.env.test.example test-db/.env.test
# Fill TEST_DB_PASSWORD and TEST_DB_ROOT_PASSWORD in that local-only file.
docker compose --env-file test-db/.env.test -f test-db/compose.yml up -d --wait
```

The database user is `planes_test`, the database is `planes_accion_test`, and its port is 3307 on localhost. The mounted migration SQL runs only when MariaDB initializes its fresh data directory. Do not point application `.env` at this test port unless performing explicitly isolated integration tests.

The base export does not seed users, plans, or activities. Integration tests must insert synthetic fixtures into this container only. Never copy the three commercial plan records.

Stop and discard the disposable test container after validation:

```powershell
docker compose --env-file test-db/.env.test -f test-db/compose.yml down
```

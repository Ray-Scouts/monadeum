#!/usr/bin/env bash
# Runs once, as the Postgres superuser, when the official image initializes an empty data directory. Creates the
# owning role the migration step connects as: LOGIN and CREATEROLE (migration 0004 creates the group roles, and the
# migration step creates the per-process login roles), not a superuser, and the owner of the database and its public
# schema. No service connects as this role after the migration step.
set -euo pipefail

if [[ -z "${DB_OWNER_PASSWORD:-}" ]]; then
  echo "DB_OWNER_PASSWORD is not set" >&2
  exit 1
fi

# \getenv reads the password from the environment, so it is never on a command line.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv owner_password DB_OWNER_PASSWORD
CREATE ROLE monadeum_owner WITH LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION PASSWORD :'owner_password';
ALTER DATABASE monadeum OWNER TO monadeum_owner;
ALTER SCHEMA public OWNER TO monadeum_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL

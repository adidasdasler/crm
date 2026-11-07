#!/bin/sh
# Выполняется ОДИН раз при первой инициализации тома PostgreSQL.
# Создаёт роль приложения: не суперпользователь, без BYPASSRLS → RLS действует всегда.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_app') THEN
      CREATE ROLE salon_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END \$\$;
SQL

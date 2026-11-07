#!/bin/sh
# Выполняется ОДИН раз при первой инициализации тома PostgreSQL.
#
# Три роли — принцип наименьших привилегий:
#   postgres    (POSTGRES_USER)  суперпользователь: только бэкапы и обслуживание, приложение его не использует;
#   salon_owner владелец базы и таблиц: миграции и «системные» запросы (вход, вебхуки, воркер).
#               НЕ суперпользователь — не может читать файлы сервера, запускать программы и т. п.
#               BYPASSRLS — потому что системным запросам нужны данные разных салонов;
#   salon_app   приложение: не владелец, без BYPASSRLS → изоляция салонов (RLS) действует всегда.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_owner') THEN
      CREATE ROLE salon_owner LOGIN PASSWORD '${OWNER_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_app') THEN
      CREATE ROLE salon_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END \$\$;
  ALTER DATABASE "${POSTGRES_DB}" OWNER TO salon_owner;
  ALTER SCHEMA public OWNER TO salon_owner;
  -- Посторонним ролям нельзя ничего создавать в схеме
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL

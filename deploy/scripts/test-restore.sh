#!/usr/bin/env bash
# Проверка, что последний бэкап расшифровывается и восстанавливается (раз в месяц).
# Поднимает временный PostgreSQL в Docker, рабочую базу не трогает.
set -euo pipefail
cd "$(dirname "$0")/../.."
PASS=$({ grep -E '^BACKUP_PASSPHRASE=' .env || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
LATEST=$(ls -t ./backups/mioflow-*.sql.gz.gpg 2>/dev/null | head -1 || true)
[ -n "$LATEST" ] || { echo "Бэкапов нет"; exit 1; }
NAME=mioflow-restore-test-$$
echo "→ Восстанавливаю $LATEST во временный контейнер"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null' EXIT
# Ждём окончательный сервер: при первом старте образ поднимает временный сервер только на сокете
# (для инициализации) и перезапускается. Сетевой порт слушает лишь окончательный — проверяем по нему.
READY=false
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then READY=true; break; fi
  sleep 1
done
$READY || { echo "Временный PostgreSQL не запустился"; exit 1; }
# Как на рабочем сервере (deploy/postgres/init.sh): роли владельца и приложения, база принадлежит salon_owner.
# Без них не применятся права и правила изоляции салонов (RLS) — проверка была бы неполной.
docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
CREATE ROLE salon_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE salon_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE restore_test OWNER salon_owner;
SQL
docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U postgres -d restore_test -c 'ALTER SCHEMA public OWNER TO salon_owner; REVOKE CREATE ON SCHEMA public FROM PUBLIC;' >/dev/null
# ON_ERROR_STOP: любая ошибка — проверка провалена (так же загружает restore.sh)
if ! gpg --batch --quiet --decrypt --passphrase-fd 3 "$LATEST" 3<<<"$PASS" | gunzip \
  | docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U postgres -d restore_test -c 'SET ROLE salon_owner' -f - >/dev/null; then
  echo "✗ Бэкап загрузился с ошибкой (см. выше). Рабочую базу это не затронуло"
  exit 1
fi
q() { docker exec "$NAME" psql -tA -U postgres -d restore_test -c "$1"; }
echo "✓ Бэкап восстанавливается без ошибок"
echo "  салонов: $(q 'SELECT count(*) FROM "Tenant" WHERE "deletedAt" IS NULL')"
echo "  пользователей: $(q 'SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL')"
echo "  клиентов: $(q 'SELECT count(*) FROM "Customer" WHERE "deletedAt" IS NULL')"
echo "  записей: $(q 'SELECT count(*) FROM "Booking"')"
echo "  правил изоляции салонов (RLS): $(q 'SELECT count(*) FROM pg_policies')"
echo "  последняя миграция: $(q 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1')"

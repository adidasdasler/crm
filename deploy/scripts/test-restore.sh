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
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
gpg --batch --quiet --decrypt --passphrase-fd 3 "$LATEST" 3<<<"$PASS" | gunzip | docker exec -i "$NAME" psql -q -U postgres -d postgres >/dev/null
N=$(docker exec "$NAME" psql -tA -U postgres -d postgres -c 'SELECT count(*) FROM "Tenant"')
echo "✓ Бэкап восстанавливается. Салонов в нём: $N"

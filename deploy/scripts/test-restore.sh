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
gpg --batch --quiet --decrypt --passphrase-fd 3 "$LATEST" 3<<<"$PASS" | gunzip | docker exec -i "$NAME" psql -q -U postgres -d postgres >/dev/null
N=$(docker exec "$NAME" psql -tA -U postgres -d postgres -c 'SELECT count(*) FROM "Tenant"')
echo "✓ Бэкап восстанавливается. Салонов в нём: $N"

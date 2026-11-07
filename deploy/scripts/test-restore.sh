#!/usr/bin/env bash
# Проверка, что последний бэкап восстанавливается (раз в месяц). Поднимает временный PostgreSQL.
set -euo pipefail
cd "$(dirname "$0")/../.."
LATEST=$(ls -t ./backups/salon-*.sql.gz* 2>/dev/null | head -1)
[ -n "$LATEST" ] || { echo "Бэкапов нет"; exit 1; }
echo "→ Восстанавливаю $LATEST во временный контейнер"
docker run -d --name salon-restore-test -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
trap 'docker rm -f salon-restore-test >/dev/null' EXIT
sleep 6
if [[ "$LATEST" == *.gpg ]]; then CAT="gpg --batch --decrypt $LATEST"; else CAT="cat $LATEST"; fi
$CAT | gunzip | docker exec -i salon-restore-test psql -q -U postgres -d postgres >/dev/null
N=$(docker exec salon-restore-test psql -tA -U postgres -d postgres -c 'SELECT count(*) FROM "Tenant"')
echo "✓ Восстановлено, салонов в бэкапе: $N"

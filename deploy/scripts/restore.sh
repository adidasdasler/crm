#!/usr/bin/env bash
# Восстановление MioFlow из зашифрованного бэкапа (база + фото дизайнов).
#   sudo bash deploy/scripts/restore.sh                      — последний бэкап из ./backups
#   sudo bash deploy/scripts/restore.sh backups/mioflow-20261112-031500.sql.gz.gpg
# Перед восстановлением делается свежий бэкап текущего состояния — откатить можно тем же скриптом.
# Нужен BACKUP_PASSPHRASE в .env (тот же, что был при создании бэкапа).
set -euo pipefail
cd "$(dirname "$0")/../.."
env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
PASS=$(env_get BACKUP_PASSPHRASE)
DB=$(env_get POSTGRES_DB); DB=${DB:-mioflow}
DIR=$(env_get BACKUP_DIR); DIR=${DIR:-./backups}
[ -n "$PASS" ] || { echo "✗ В .env нет BACKUP_PASSPHRASE"; exit 1; }

FILE=${1:-$(ls -t "$DIR"/mioflow-2*.sql.gz.gpg 2>/dev/null | head -1 || true)}
[ -f "$FILE" ] || { echo "✗ Файл бэкапа не найден: ${FILE:-нет бэкапов в $DIR}"; exit 1; }
STAMP=$(basename "$FILE" | sed -E 's/^mioflow-([0-9]{8}-[0-9]{6}).*/\1/')
UPL="$DIR/mioflow-uploads-$STAMP.tar.gz.gpg"
[ -f "$UPL" ] || UPL=""

echo "Будет восстановлено:"
echo "  база:  $FILE"
echo "  фото:  ${UPL:-(архива фото за это время нет — фото не трогаем)}"
echo "Текущие данные будут ЗАМЕНЕНЫ. Перед этим сделаю бэкап текущего состояния."
read -r -p "Напишите ВОССТАНОВИТЬ для продолжения: " ANSWER
[ "$ANSWER" = "ВОССТАНОВИТЬ" ] || { echo "Отменено"; exit 1; }

echo "→ Проверяю, что бэкап расшифровывается"
gpg --batch --quiet --decrypt --passphrase-fd 3 "$FILE" 3<<<"$PASS" | gunzip -t

echo "→ Бэкап текущего состояния (на случай отката)"
bash deploy/scripts/backup.sh || echo "  (не получилось — база могла быть недоступна, продолжаю)"

echo "→ Останавливаю api и worker (сайт покажет ошибку на пару минут)"
docker compose stop api worker

echo "→ Пересоздаю базу $DB"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
DROP DATABASE IF EXISTS "$DB" WITH (FORCE);
CREATE DATABASE "$DB" OWNER salon_owner;
SQL
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c 'ALTER SCHEMA public OWNER TO salon_owner; REVOKE CREATE ON SCHEMA public FROM PUBLIC;'

echo "→ Загружаю данные"
gpg --batch --quiet --decrypt --passphrase-fd 3 "$FILE" 3<<<"$PASS" | gunzip \
  | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c 'SET ROLE salon_owner' -f - >/dev/null

if [ -n "$UPL" ]; then
  echo "→ Восстанавливаю фото дизайнов"
  gpg --batch --quiet --decrypt --passphrase-fd 3 "$UPL" 3<<<"$PASS" | gunzip \
    | docker compose run --rm --no-deps -T --entrypoint sh api -c 'find /data/uploads -mindepth 1 -delete && tar -C /data/uploads -xf -'
fi

echo "→ Запускаю api и worker"
docker compose up -d api worker
PORT=$(env_get SITE_PORT); PORT=${PORT:-8080}
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then
    N=$(docker compose exec -T postgres psql -tA -U postgres -d "$DB" -c 'SELECT count(*) FROM "Tenant" WHERE "deletedAt" IS NULL')
    echo "✓ Восстановлено. Салонов: $N"
    exit 0
  fi
  sleep 3
done
echo "✗ API не поднялся. Логи: sudo docker compose logs --tail=100 api"
exit 1

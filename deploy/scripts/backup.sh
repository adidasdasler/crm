#!/usr/bin/env bash
# Бэкап PostgreSQL: pg_dump → gzip → (опционально) шифрование GPG → хранение 30 дней.
# Cron (ежедневно в 03:15):  15 3 * * * cd /opt/salon && bash deploy/scripts/backup.sh >> /var/log/salon-backup.log 2>&1
# Копию в облако (152-ФЗ — хранилище в РФ, например Yandex Object Storage) отправляйте rclone:
#   rclone copy /opt/salon/backups yandex:salon-backups --max-age 25h
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

DIR=${BACKUP_DIR:-./backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
mkdir -p "$DIR"
chmod 700 "$DIR"
FILE="$DIR/salon-$(date +%Y%m%d-%H%M%S).sql.gz"

docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-salon}" -d "${POSTGRES_DB:-salon}" --no-owner --format=plain | gzip -9 > "$FILE"

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" "$FILE"
  shred -u "$FILE"
  FILE="$FILE.gpg"
fi

chmod 600 "$FILE"
find "$DIR" -name 'salon-*.sql.gz*' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) ✓ $FILE ($(du -h "$FILE" | cut -f1))"

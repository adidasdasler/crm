#!/usr/bin/env bash
# Бэкап базы MioFlow: pg_dump → gzip → шифрование AES-256 (GPG, пароль BACKUP_PASSPHRASE из .env)
# → хранение 30 дней на сервере → (опционально) копия во внешнее хранилище в РФ через rclone.
#
# Запускается ежедневно из /etc/cron.d/mioflow-backup (создаёт deploy/install.sh).
# ВАЖНО: сохраните BACKUP_PASSPHRASE вне сервера (менеджер паролей). Без него бэкап не расшифровать.
set -euo pipefail
cd "$(dirname "$0")/../.."

env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
DB=$(env_get POSTGRES_DB); DB=${DB:-mioflow}
PASS=$(env_get BACKUP_PASSPHRASE)
REMOTE=$(env_get BACKUP_RCLONE_REMOTE)
DIR=${BACKUP_DIR:-./backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}

[ -n "$PASS" ] || { echo "$(date -Is) ✗ В .env нет BACKUP_PASSPHRASE — бэкап без шифрования не делаем"; exit 1; }
command -v gpg >/dev/null || { echo "$(date -Is) ✗ Не установлен gpg: sudo apt-get install -y gnupg"; exit 1; }

mkdir -p "$DIR"
chmod 700 "$DIR"
FILE="$DIR/mioflow-$(date +%Y%m%d-%H%M%S).sql.gz.gpg"

# Незашифрованные данные не касаются диска: дамп сразу сжимается и шифруется в потоке.
docker compose exec -T postgres pg_dump -U postgres -d "$DB" --no-owner --format=plain \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o "$FILE" 3<<<"$PASS"
chmod 600 "$FILE"

# Проверка: файл не пустой, расшифровывается и архив целый (полная проверка, без обрыва потока)
SIZE=$(stat -c %s "$FILE")
[ "$SIZE" -gt 1000 ] || { echo "$(date -Is) ✗ Подозрительно маленький бэкап ($SIZE байт)"; exit 1; }
gpg --batch --quiet --decrypt --passphrase-fd 3 "$FILE" 3<<<"$PASS" | gunzip -t

find "$DIR" -name 'mioflow-*.sql.gz.gpg' -mtime +"$KEEP_DAYS" -delete

# Копия вне сервера (Yandex Object Storage, Selectel S3 и т. п.), если настроен rclone
if [ -n "$REMOTE" ]; then
  if command -v rclone >/dev/null; then
    rclone copy "$FILE" "$REMOTE" --quiet && echo "$(date -Is) ↑ скопировано в $REMOTE"
  else
    echo "$(date -Is) ! BACKUP_RCLONE_REMOTE задан, но rclone не установлен — копия вне сервера не сделана"
  fi
fi
echo "$(date -Is) ✓ $FILE ($(du -h "$FILE" | cut -f1))"

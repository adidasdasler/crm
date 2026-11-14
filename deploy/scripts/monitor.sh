#!/usr/bin/env bash
# Мониторинг MioFlow: раз в 5 минут из cron (/etc/cron.d/mioflow-monitor).
# Проверяет: сайт и API отвечают, воркер жив, свежий бэкап есть, на диске есть место.
# Тревога — в Telegram (ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID в .env) и/или в лог.
# В сообщениях нет персональных данных — только состояние сервера.
# Повторно об одной и той же проблеме пишет не чаще раза в час; когда всё починилось — «✅ снова в порядке».
set -uo pipefail
cd "$(dirname "$0")/../.."
env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }

URL=$(env_get PUBLIC_WEB_URL); URL=${URL:-http://127.0.0.1:8080}
TOKEN=$(env_get ALERT_TELEGRAM_BOT_TOKEN); CHAT=$(env_get ALERT_TELEGRAM_CHAT_ID)
BACKUP_DIR=$(env_get BACKUP_DIR); BACKUP_DIR=${BACKUP_DIR:-./backups}
STATE=/var/tmp/mioflow-monitor.state
problems=()

# 1. Сайт и API (через внешний адрес — так проверяется и Nginx, и сертификат)
HEALTH=$(curl -fsS -m 15 "$URL/v1/health" 2>/dev/null) || problems+=("API не отвечает: $URL/v1/health")
if [ -n "${HEALTH:-}" ] && ! grep -q '"worker":"ok"' <<<"$HEALTH"; then problems+=("Воркер не отмечался больше 5 минут — напоминания не уходят"); fi
curl -fsS -m 15 -o /dev/null "$URL/" 2>/dev/null || problems+=("Сайт не открывается: $URL")

# 2. Сертификат: меньше 14 дней до окончания
HOST=$(sed -E 's#^https?://([^/:]+).*#\1#' <<<"$URL")
if [[ "$URL" == https://* ]]; then
  END=$(echo | openssl s_client -servername "$HOST" -connect "$HOST:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$END" ] && [ $(( ($(date -d "$END" +%s) - $(date +%s)) / 86400 )) -lt 14 ]; then problems+=("HTTPS-сертификат истекает $END"); fi
fi

# 3. Бэкап: последний не старше 26 часов
LAST=$(ls -t "$BACKUP_DIR"/mioflow-*.sql.gz.gpg 2>/dev/null | head -1)
if [ -z "$LAST" ]; then problems+=("Нет ни одного бэкапа в $BACKUP_DIR")
elif [ $(( ($(date +%s) - $(stat -c %Y "$LAST")) / 3600 )) -ge 26 ]; then problems+=("Последний бэкап старше суток: $(basename "$LAST")"); fi

# 4. Диск: свободно меньше 10%
USE=$(df -P . | awk 'NR==2 {gsub("%","",$5); print $5}')
[ "${USE:-0}" -ge 90 ] && problems+=("Диск заполнен на ${USE}%")

# 5. Контейнеры
for s in postgres api worker nginx; do
  docker compose ps "$s" --status running -q 2>/dev/null | grep -q . || problems+=("Контейнер $s не запущен")
done

send() {
  echo "$(date -Is) $1"
  [ -n "$TOKEN" ] && [ -n "$CHAT" ] && curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot$TOKEN/sendMessage" \
    --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$1" || true
}

if [ ${#problems[@]} -gt 0 ]; then
  MSG="⚠️ MioFlow: $(printf '%s; ' "${problems[@]}")"
  # Та же проблема — не чаще раза в час
  if [ ! -f "$STATE" ] || [ "$(cat "$STATE")" != "$MSG" ] || [ $(( $(date +%s) - $(stat -c %Y "$STATE") )) -ge 3600 ]; then
    send "$MSG"; echo "$MSG" > "$STATE"
  fi
  exit 1
elif [ -f "$STATE" ]; then
  send "✅ MioFlow снова в порядке"; rm -f "$STATE"
fi

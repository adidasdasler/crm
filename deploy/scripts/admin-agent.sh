#!/usr/bin/env bash
# Исполнитель задач из панели владельца (mioflow.ru/admin → «Сервер»). Запускается cron раз в минуту.
# Панель только кладёт задачу в таблицу AdminTask; этот скрипт на самом сервере забирает её и выполняет
# ТОЛЬКО команды из списка ниже. Наружу ничего не открыто, других ботов и сайтов скрипт не касается.
set -uo pipefail
cd "$(dirname "$0")/../.."
exec 9>/var/lock/mioflow-admin-agent.lock
flock -n 9 || exit 0   # предыдущая задача ещё выполняется

env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
DB=$(env_get POSTGRES_DB); DB=${DB:-mioflow}
sql() { docker compose exec -T postgres psql -qtA -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }

# База недоступна — сообщить о себе не можем; мониторинг об этом напишет
sql -c "INSERT INTO \"Heartbeat\"(name, at) VALUES ('admin-agent', now()) ON CONFLICT (name) DO UPDATE SET at = now()" >/dev/null 2>&1 || exit 0
# Задачи, «зависшие» больше 30 минут (сервер перезагружали посреди задачи)
sql -c "UPDATE \"AdminTask\" SET status='FAILED', output=coalesce(output,'') || E'\nПрервано: задача не завершилась за 30 минут', \"finishedAt\"=now() WHERE status='RUNNING' AND \"startedAt\" < now() - interval '30 minutes'" >/dev/null

TASK=$(sql -F' ' -c "UPDATE \"AdminTask\" SET status='RUNNING', \"startedAt\"=now() WHERE id = (SELECT id FROM \"AdminTask\" WHERE status='PENDING' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, kind")
[ -n "$TASK" ] || exit 0
ID=${TASK%% *}; KIND=${TASK#* }

run() {
  case "$KIND" in
    status)       docker compose ps; echo; df -h /; echo; docker system df; echo; curl -s -m 10 "http://127.0.0.1:$(env_get SITE_PORT | grep . || echo 8080)/v1/health"; echo ;;
    logs_api)     docker compose logs --no-color --tail=300 api ;;
    logs_worker)  docker compose logs --no-color --tail=300 worker ;;
    restart)      docker compose restart api worker && sleep 15 && docker compose ps api worker ;;
    backup)       bash deploy/scripts/backup.sh ;;
    test_restore) bash deploy/scripts/test-restore.sh ;;
    deploy)       timeout 1500 bash deploy/scripts/deploy.sh ;;
    *)            echo "Неизвестная задача: $KIND"; return 2 ;;
  esac
}

OUT=$(run 2>&1); CODE=$?
STATUS=$([ $CODE -eq 0 ] && echo DONE || echo FAILED)
# Без цветовых кодов, только последние 400 строк и не больше 30 000 символов
OUT=$(printf '%s' "$OUT" | sed 's/\x1b\[[0-9;]*m//g' | tail -n 400 | tail -c 30000)
printf 'UPDATE "AdminTask" SET status = :%s, output = :%s, "finishedAt" = now() WHERE id = :id;\n' "'st'" "'out'" \
  | sql -v st="$STATUS" -v out="$OUT" -v id="$ID" >/dev/null
echo "$(date -Is) задача $ID $KIND → $STATUS"

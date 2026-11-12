#!/usr/bin/env bash
# Обновление MioFlow: бэкап → свежий код (конфиги, миграции) → свежие образы → перезапуск.
# Другие программы на сервере не затрагиваются.
#   sudo bash deploy/scripts/deploy.sh           # готовые образы из GitHub (по умолчанию)
#   sudo bash deploy/scripts/deploy.sh --build   # собрать на сервере
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo "Нет .env — сначала запустите deploy/install.sh"; exit 1; }
SITE_PORT=$({ grep -E '^SITE_PORT=' .env || true; } | cut -d= -f2); SITE_PORT=${SITE_PORT:-8080}

echo "→ Бэкап перед обновлением"
if docker compose ps postgres --status running -q | grep -q .; then
  bash deploy/scripts/backup.sh
fi

echo "→ Обновление кода"
git pull --ff-only

if [ "${1:-}" = "--build" ]; then
  echo "→ Сборка образов (пониженный приоритет)"
  nice -n 19 ionice -c3 docker compose build
else
  echo "→ Загрузка образов"
  docker compose pull
fi

echo "→ Перезапуск (миграции применяются при старте api)"
docker compose up -d --no-build --remove-orphans

echo "→ Проверка"
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$SITE_PORT/v1/health" >/dev/null; then
    echo "✓ MioFlow работает"
    # Мониторинг (для серверов, установленных до его появления): включаем один раз
    if [ "$(id -u)" = 0 ] && [ ! -f /etc/cron.d/mioflow-monitor ]; then
      echo "*/5 * * * * root cd $(pwd) && bash deploy/scripts/monitor.sh >> /var/log/mioflow-monitor.log 2>&1" > /etc/cron.d/mioflow-monitor
      chmod 644 /etc/cron.d/mioflow-monitor
      echo "✓ Включён мониторинг каждые 5 минут: deploy/scripts/monitor.sh"
    fi
    # Исполнитель задач панели владельца (mioflow.ru/admin → «Сервер»)
    if [ "$(id -u)" = 0 ] && [ ! -f /etc/cron.d/mioflow-admin-agent ]; then
      echo "* * * * * root cd $(pwd) && bash deploy/scripts/admin-agent.sh >> /var/log/mioflow-admin-agent.log 2>&1" > /etc/cron.d/mioflow-admin-agent
      chmod 644 /etc/cron.d/mioflow-admin-agent
      echo "✓ Включён исполнитель задач панели владельца"
    fi
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 3
done
echo "✗ API не отвечает. Логи: docker compose logs --tail=100 api"
exit 1

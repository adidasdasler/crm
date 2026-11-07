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
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 3
done
echo "✗ API не отвечает. Логи: docker compose logs --tail=100 api"
exit 1

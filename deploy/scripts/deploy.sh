#!/usr/bin/env bash
# Деплой на VPS: обновить код, пересобрать образы, перезапустить без простоя БД.
# Запуск из корня проекта: bash deploy/scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

[ -f .env ] || { echo "Нет .env — скопируйте .env.example и заполните"; exit 1; }
set -a; . ./.env; set +a

echo "→ Бэкап перед деплоем"
if docker compose ps postgres --status running -q | grep -q .; then
  bash deploy/scripts/backup.sh
fi

echo "→ Обновление кода"
git pull --ff-only

echo "→ Сборка образов"
docker compose build

echo "→ Запуск (миграции применяются при старте api)"
docker compose up -d --remove-orphans

echo "→ Проверка здоровья"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${SITE_PORT:-8080}/v1/health" >/dev/null; then
    echo "✓ Salon работает"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done
echo "✗ API не отвечает. Логи: docker compose logs --tail=100 api"
exit 1

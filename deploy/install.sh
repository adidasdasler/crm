#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Установка «Пора» на VPS одной командой — временный запуск по IP, без домена.
#
#   sudo bash deploy/install.sh            # чистая установка
#   sudo bash deploy/install.sh --demo     # + демо-салон для показа (demo@salon.local / demo12345)
#   sudo bash deploy/install.sh --ip 1.2.3.4   # если IP не определился сам
#
# Что делает: ставит Docker (если нет), создаёт .env со случайными секретами,
# собирает и запускает всё в Docker, открывает порты, включает ежедневный бэкап.
# Сайт и онлайн-запись: http://IP:8080   Приложение (веб-CRM): http://IP:8081
#
# ВНИМАНИЕ: без домена нет HTTPS — пароли и данные идут незашифрованными.
# Это режим для проверки и показа, не для реальных клиентов. Как подключить
# домен и сертификат — docs/DEPLOY.md, раздел «Переход на домен».
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

DEMO=false
IP=""
SITE_PORT=8080
APP_PORT=8081
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO=true ;;
    --ip) IP="${2:-}"; shift ;;
    *) echo "Неизвестный параметр: $1"; exit 1 ;;
  esac
  shift
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите с sudo: sudo bash deploy/install.sh"; exit 1; }

step "1/7 Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  # Пакеты из репозитория Ubuntu — не зависят от доступа к download.docker.com
  apt-get install -y docker.io docker-compose-v2 || curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
fi
# Зеркало Docker Hub: Docker Hub бывает недоступен или ограничивает скачивания.
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  echo '{ "registry-mirrors": ["https://mirror.gcr.io"] }' > /etc/docker/daemon.json
  systemctl restart docker || true
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version

step "2/7 Память"
# Сборка веб-версии приложения требует ~2 ГБ памяти — на небольших VPS добавим swap.
MEM_MB=$(free -m | awk '/Mem:/{print $2}')
if [ "$(swapon --show | wc -l)" = "0" ] && [ "$MEM_MB" -lt 6000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Добавлен swap 2 ГБ"
else
  echo "Память: ${MEM_MB} МБ, swap не нужен или уже есть"
fi

step "3/7 IP-адрес сервера"
if [ -z "$IP" ]; then
  IP=$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || curl -fsS -m 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
fi
[ -n "$IP" ] || { echo "Не удалось определить IP. Укажите: --ip 1.2.3.4"; exit 1; }
echo "IP: $IP"

for p in $SITE_PORT $APP_PORT; do
  if ss -ltn "( sport = :$p )" | grep -q LISTEN && ! docker compose ps --status running -q 2>/dev/null | grep -q .; then
    echo "Порт $p уже занят другой программой. Освободите его или измените SITE_PORT/APP_PORT в .env"; exit 1
  fi
done

step "4/7 Настройки (.env)"
secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
if [ -f .env ]; then
  echo ".env уже существует — оставляю без изменений"
else
  cat > .env <<EOF
# Создано deploy/install.sh $(date -Iseconds). Режим: по IP, без домена.
POSTGRES_USER=salon
POSTGRES_DB=salon
POSTGRES_PASSWORD=$(secret)
APP_DB_PASSWORD=$(secret)
JWT_SECRET=$(secret)$(secret)
TELEGRAM_WEBHOOK_SECRET=$(secret)

# Адреса без домена
PUBLIC_WEB_URL=http://$IP:$SITE_PORT
APP_URL=http://$IP:$APP_PORT
NGINX_BIND=0.0.0.0
SITE_PORT=$SITE_PORT
APP_PORT=$APP_PORT
# Без HTTPS браузер не сохранит secure-cookie — временно отключено. С доменом: true.
COOKIE_SECURE=false
CORS_ORIGIN=
COOKIE_DOMAIN=

# Демо-салон для показа
SEED_DEMO=$DEMO

# Подключите позже (docs/DEPLOY.md, раздел 4). Telegram-бот требует HTTPS — только с доменом.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
SMS_RU_API_KEY=
SMS_SENDER=
PAYMENT_PROVIDER=yookassa
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
SMTP_URL=
MAIL_FROM="Пора <no-reply@mioflow.ru>"
PUSH_ENABLED=false
BACKUP_GPG_RECIPIENT=
EOF
  chmod 600 .env
  echo "Создан .env со случайными паролями (chmod 600)"
fi

step "5/7 Сборка и запуск — первый раз 5–15 минут"
docker compose build
docker compose up -d --remove-orphans

echo -n "Ждём, пока сервис поднимется"
for i in $(seq 1 90); do
  if curl -fsS -m 3 "http://127.0.0.1:$SITE_PORT/v1/health" >/dev/null 2>&1; then echo " — готово"; break; fi
  echo -n "."; sleep 3
  if [ "$i" = 90 ]; then echo; echo "Сервис не ответил. Логи: docker compose logs --tail=100 api"; exit 1; fi
done

step "6/7 Брандмауэр"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$SITE_PORT/tcp" >/dev/null && ufw allow "$APP_PORT/tcp" >/dev/null
  echo "Открыты порты $SITE_PORT и $APP_PORT в ufw"
else
  echo "ufw не активен — если у провайдера VPS есть свой файрвол, откройте там порты $SITE_PORT и $APP_PORT"
fi

step "7/7 Ежедневный бэкап базы (03:15)"
DIR=$(pwd)
echo "15 3 * * * root cd $DIR && bash deploy/scripts/backup.sh >> /var/log/pora-backup.log 2>&1" > /etc/cron.d/pora-backup
chmod 644 /etc/cron.d/pora-backup
echo "Бэкапы: $DIR/backups (хранятся 30 дней)"

cat <<EOF

────────────────────────────────────────────────────────────
  «Пора» запущена

  Сайт и онлайн-запись:  http://$IP:$SITE_PORT
  Приложение (CRM):      http://$IP:$APP_PORT
$( [ "$DEMO" = true ] && echo "  Демо-вход:             demo@salon.local / demo12345
  Запись как клиент:     http://$IP:$SITE_PORT/b/demo" )

  Обновить версию:       sudo bash deploy/scripts/deploy.sh
  Логи:                  docker compose logs -f api worker

  Без домена нет HTTPS — используйте для проверки и показа,
  не для реальных клиентов.
────────────────────────────────────────────────────────────
EOF

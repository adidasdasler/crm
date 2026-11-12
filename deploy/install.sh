#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Установка MioFlow на VPS, где уже работают другие программы (например, боты-службы).
#
#   sudo bash deploy/install.sh --ghcr-user ЛОГИН [--demo]   # токен спросит скрыто
#   sudo bash deploy/install.sh --build [--demo]       # без готовых образов: сборка на сервере
#
# Параметры:
#   --demo                демо-салон для показа (demo@salon.local / demo12345)
#   --ip 1.2.3.4          если IP не определился сам
#   --site-port 8080      порт сайта (по умолчанию 8080)
#   --app-port 8081       порт приложения (по умолчанию 8081)
#   --ghcr-user ЛОГИН     доступ к готовым образам в GitHub Container Registry (рекомендуется);
#                         токен (read:packages) скрипт спросит без отображения на экране
#   --build               собрать образы на этом сервере (долго, нужна ~2 ГБ памяти)
#
# ЧТО СКРИПТ НЕ ДЕЛАЕТ (чтобы не задеть ваши службы):
#   - не обновляет системные пакеты (никакого apt upgrade);
#   - не перезапускает и не перенастраивает уже установленный Docker;
#   - не трогает systemd-службы, хостовый Nginx, другие сайты и cron-задачи;
#   - не включает файрвол (только добавляет правило, если ufw уже включён);
#   - не занимает чужие порты — если порт занят, останавливается.
# В конце показывает, что список работающих служб не изменился.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)

DEMO=false; IP=""; SITE_PORT=8080; APP_PORT=8081; GHCR_USER=""; GHCR_TOKEN=""; BUILD=false
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO=true ;;
    --ip) IP="${2:-}"; shift ;;
    --site-port) SITE_PORT="${2:-}"; shift ;;
    --app-port) APP_PORT="${2:-}"; shift ;;
    --ghcr-user) GHCR_USER="${2:-}"; shift ;;
    --build) BUILD=true ;;
    *) echo "Неизвестный параметр: $1"; exit 1 ;;
  esac
  shift
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || fail "Запустите с sudo: sudo bash deploy/install.sh ..."
if [ "$BUILD" = false ]; then
  [ -n "$GHCR_USER" ] || fail "Укажите --ghcr-user ЛОГИН_GITHUB (готовые образы) или --build (сборка на сервере). См. docs/DEPLOY.md"
  # Токен не передаём аргументом: он попал бы в историю команд и список процессов
  GHCR_TOKEN=${GHCR_TOKEN:-}
  if [ -z "$GHCR_TOKEN" ]; then
    read -rsp "Токен GitHub с правом read:packages (ввод не отображается): " GHCR_TOKEN; echo
  fi
  [ -n "$GHCR_TOKEN" ] || fail "Токен не введён"
fi

SNAP_BEFORE=$(mktemp)
systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}' | sort > "$SNAP_BEFORE" || true

step "1/8 Проверка сервера"
. /etc/os-release 2>/dev/null || true
echo "ОС: ${PRETTY_NAME:-неизвестно}"
MEM_MB=$(free -m | awk '/Mem:/{print $2}')
DISK_GB=$(df -BG --output=avail "$ROOT_DIR" | tail -1 | tr -dc '0-9')
echo "Память: ${MEM_MB} МБ, свободно на диске: ${DISK_GB} ГБ"
[ "${DISK_GB:-0}" -ge 5 ] || fail "Нужно хотя бы 5 ГБ свободного места на диске"
echo "Работающих служб сейчас: $(wc -l < "$SNAP_BEFORE") (список сохранён для сравнения в конце)"
for p in "$SITE_PORT" "$APP_PORT"; do
  if ss -ltnH "( sport = :$p )" | grep -q .; then
    if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q "mioflow.*:$p->"; then
      echo "Порт $p занят MioFlow (повторная установка) — ок"
    else
      fail "Порт $p уже занят другой программой ($(ss -ltnpH "( sport = :$p )" | sed 's/.*users:((\"\([^\"]*\).*/\1/' | head -1)). Выберите другой: --site-port / --app-port"
    fi
  fi
done
ok "Порты $SITE_PORT и $APP_PORT свободны"

step "2/8 Docker"
if command -v docker >/dev/null 2>&1; then
  ok "Docker уже установлен ($(docker --version | cut -d, -f1)) — не трогаю его настройки"
else
  echo "Docker не найден — устанавливаю из репозитория Ubuntu (без обновления других пакетов)"
  apt-get update -y -qq
  apt-get install -y -qq --no-upgrade docker.io docker-compose-v2 || { curl -fsSL https://get.docker.com | sh; }
  # Зеркало Docker Hub ставим только на свежий Docker — существующий не перезапускаем
  if [ ! -f /etc/docker/daemon.json ]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://mirror.gcr.io"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
    systemctl restart docker
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -qq --no-upgrade docker-compose-v2 || apt-get install -y -qq --no-upgrade docker-compose-plugin
command -v gpg >/dev/null || apt-get install -y -qq --no-upgrade gnupg
ok "$(docker compose version)"

step "3/8 Память"
if [ "$BUILD" = true ] && [ "$(swapon --noheadings | wc -l)" = "0" ] && [ "$MEM_MB" -lt 6000 ] && [ ! -e /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Добавлен swap 2 ГБ (для сборки)"
else
  ok "Изменения не нужны"
fi

step "4/8 IP-адрес"
if [ -z "$IP" ]; then
  IP=$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || curl -fsS -m 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
fi
[ -n "$IP" ] || fail "Не удалось определить IP — укажите --ip 1.2.3.4"
ok "IP: $IP"

step "5/8 Настройки (.env)"
secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
if [ -f .env ]; then
  ok ".env уже есть — не изменяю (пароли сохраняются)"
else
  BACKUP_PASSPHRASE=$(secret)
  cat > .env <<EOF
# Создано deploy/install.sh $(date -Iseconds). Режим: по IP, без домена.
POSTGRES_DB=mioflow
POSTGRES_PASSWORD=$(secret)
OWNER_DB_PASSWORD=$(secret)
APP_DB_PASSWORD=$(secret)
JWT_SECRET=$(secret)$(secret)
TELEGRAM_WEBHOOK_SECRET=$(secret)
MAX_WEBHOOK_SECRET=$(secret)
VK_SECRET=$(secret)
# Пароль шифрования бэкапов. СОХРАНИТЕ ЕГО ВНЕ СЕРВЕРА — без него бэкап не расшифровать.
BACKUP_PASSPHRASE=$BACKUP_PASSPHRASE
# Копия бэкапов во внешнее хранилище (rclone), например: yandex:mioflow-backups
BACKUP_RCLONE_REMOTE=

# Образы
IMAGE_PREFIX=ghcr.io/adidasdasler/mioflow
IMAGE_TAG=latest

# Адреса без домена
PUBLIC_WEB_URL=http://$IP:$SITE_PORT
APP_URL=http://$IP:$APP_PORT
NGINX_BIND=0.0.0.0
SITE_PORT=$SITE_PORT
APP_PORT=$APP_PORT
# Без HTTPS браузер не сохранит secure-cookie — временно false. С доменом: true.
COOKIE_SECURE=false
CORS_ORIGIN=
COOKIE_DOMAIN=
SEED_DEMO=$DEMO

# Подключить позже (docs/DEPLOY.md). Telegram и ЮKassa требуют домен с HTTPS.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
MAX_BOT_TOKEN=
MAX_BOT_USERNAME=
VK_GROUP_TOKEN=
VK_GROUP_SCREEN_NAME=
VK_CONFIRMATION_CODE=
PAYMENT_PROVIDER=yookassa
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
SMTP_URL=
MAIL_FROM="MioFlow <no-reply@mioflow.ru>"
PUSH_ENABLED=false
EOF
  chmod 600 .env
  ok "Создан .env со случайными паролями (доступ только root)"
  NEW_PASSPHRASE=$BACKUP_PASSPHRASE
fi

step "6/8 Образы и запуск"
if [ "$BUILD" = true ]; then
  echo "Сборка на сервере с пониженным приоритетом, чтобы не мешать другим программам (10–20 минут)…"
  nice -n 19 ionice -c3 docker compose build
else
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  docker compose pull
  ok "Готовые образы скачаны"
fi
docker compose up -d --no-build --remove-orphans
echo -n "Ждём запуска"
for i in $(seq 1 100); do
  if curl -fsS -m 3 "http://127.0.0.1:$SITE_PORT/v1/health" >/dev/null 2>&1; then echo; ok "MioFlow отвечает"; break; fi
  echo -n "."; sleep 3
  [ "$i" = 100 ] && { echo; fail "Сервис не ответил. Логи: cd $ROOT_DIR && docker compose logs --tail=100 api"; }
done

step "7/8 Порты и бэкапы"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$SITE_PORT/tcp" >/dev/null && ufw allow "$APP_PORT/tcp" >/dev/null
  ok "Открыты порты $SITE_PORT и $APP_PORT в ufw (остальные правила не тронуты)"
else
  echo "ufw не включён — не включаю его (иначе можно потерять SSH). Если у провайдера есть файрвол в панели, откройте там $SITE_PORT и $APP_PORT"
fi
echo "15 3 * * * root cd $ROOT_DIR && bash deploy/scripts/backup.sh >> /var/log/mioflow-backup.log 2>&1" > /etc/cron.d/mioflow-backup
chmod 644 /etc/cron.d/mioflow-backup
ok "Ежедневный зашифрованный бэкап в 03:15 → $ROOT_DIR/backups"
echo "*/5 * * * * root cd $ROOT_DIR && bash deploy/scripts/monitor.sh >> /var/log/mioflow-monitor.log 2>&1" > /etc/cron.d/mioflow-monitor
chmod 644 /etc/cron.d/mioflow-monitor
ok "Мониторинг каждые 5 минут (тревоги в Telegram — см. ALERT_TELEGRAM_* в .env)"

step "8/8 Проверка, что другие службы не затронуты"
SNAP_AFTER=$(mktemp)
systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}' | sort > "$SNAP_AFTER" || true
GONE=$(comm -23 "$SNAP_BEFORE" "$SNAP_AFTER" || true)
ADDED=$(comm -13 "$SNAP_BEFORE" "$SNAP_AFTER" | tr '\n' ' ' || true)
if [ -z "$GONE" ]; then
  ok "Все службы, которые работали до установки, работают и сейчас"
else
  echo "⚠ Перестали работать службы: $GONE — проверьте: systemctl status <служба>"
fi
[ -n "$ADDED" ] && echo "Новые службы: $ADDED(ожидаемо: docker, containerd)"
rm -f "$SNAP_BEFORE" "$SNAP_AFTER"

cat <<EOF

────────────────────────────────────────────────────────────
  MioFlow запущен

  Сайт и онлайн-запись:  http://$IP:$SITE_PORT
  Приложение (CRM):      http://$IP:$APP_PORT
$( [ "$DEMO" = true ] && printf '  Демо-вход:             demo@salon.local / demo12345\n  Запись как клиент:     http://%s:%s/b/demo\n' "$IP" "$SITE_PORT" )
  Обновить:   cd $ROOT_DIR && sudo bash deploy/scripts/deploy.sh
  Логи:       cd $ROOT_DIR && sudo docker compose logs -f api worker
  Остановить: cd $ROOT_DIR && sudo docker compose down   (данные сохранятся)

  Без домена нет HTTPS — только для проверки и показа,
  не для реальных клиентов.
────────────────────────────────────────────────────────────
EOF
if [ -n "${NEW_PASSPHRASE:-}" ]; then
  printf '\n\033[1;33m!!! Сохраните пароль бэкапов в менеджер паролей (вне сервера):\n    %s\033[0m\n' "$NEW_PASSPHRASE"
fi

#!/usr/bin/env bash
# Подключение домена к MioFlow: HTTPS-сертификат Let's Encrypt + хостовый Nginx + новые адреса в .env.
#
#   sudo bash deploy/scripts/enable-domain.sh mioflow.ru --email you@example.ru
#
# Что делает (и чего НЕ делает):
#  - проверяет, что mioflow.ru, www и app уже указывают на этот сервер;
#  - если порты 80/443 занимает не Nginx (Apache, Caddy, бот) — останавливается, ничего не меняя;
#  - ставит nginx и certbot, только если их нет (без обновления других пакетов);
#  - добавляет ОДИН файл /etc/nginx/sites-available/mioflow.conf. Чужие сайты и конфиги не трогает;
#  - перед каждым reload проверяет конфиг (nginx -t), при ошибке возвращает как было;
#  - reload Nginx не обрывает соединения других сайтов и ботов;
#  - сертификат продлевается сам (таймер certbot), после продления Nginx перечитывает его.
set -euo pipefail
cd "$(dirname "$0")/../.."

say() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

DOMAIN="${1:-}"; shift || true
EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
  shift
done

[ "$(id -u)" = 0 ] || die "Запустите через sudo"
[[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "Укажите домен: sudo bash deploy/scripts/enable-domain.sh mioflow.ru --email you@example.ru"
[ -f .env ] || die "Нет .env — сначала установите MioFlow (deploy/install.sh)"

env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
env_set() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
SITE_PORT=$(env_get SITE_PORT); SITE_PORT=${SITE_PORT:-8080}
APP_PORT=$(env_get APP_PORT); APP_PORT=${APP_PORT:-8081}
HOSTS=("$DOMAIN" "www.$DOMAIN" "app.$DOMAIN")

# ─── 1. DNS ───
say "Проверяю DNS"
MY_IP=$(curl -4 -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
for h in "${HOSTS[@]}"; do
  got=$(getent ahostsv4 "$h" | awk '{print $1; exit}' || true)
  [ -n "$got" ] || die "$h пока не находится в DNS. Проверьте A-запись у регистратора и подождите 15–60 минут"
  [ "$got" = "$MY_IP" ] || die "$h указывает на $got, а IP этого сервера $MY_IP. Исправьте A-запись и подождите обновления DNS"
done
ok "Все три адреса указывают на $MY_IP"

# ─── 2. Кто слушает 80/443 ───
say "Проверяю порты 80 и 443"
for p in 80 443; do
  owner=$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*' | cut -d'"' -f2 | sort -u | tr '\n' ' ' || true)
  if [ -n "$owner" ] && ! echo "$owner" | grep -qw nginx; then
    die "Порт $p занят программой: $owner. Скрипт ничего не менял. Пришлите это сообщение — подскажу, как совместить"
  fi
done
ok "Порты свободны или заняты Nginx"

# ─── 3. Nginx и certbot ───
NEED=()
command -v nginx >/dev/null || NEED+=(nginx)
command -v certbot >/dev/null || NEED+=(certbot)
if [ ${#NEED[@]} -gt 0 ]; then
  say "Устанавливаю ${NEED[*]} (другие пакеты не обновляются)"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-upgrade "${NEED[@]}"
fi
[ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ] || die "Нестандартная установка Nginx (нет sites-available). Пришлите вывод: nginx -V"
grep -rqs "sites-enabled" /etc/nginx/nginx.conf || die "nginx.conf не подключает sites-enabled. Пришлите вывод: cat /etc/nginx/nginx.conf"
systemctl is-active --quiet nginx || systemctl enable --now nginx
mkdir -p /var/www/certbot

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  ok "В ufw открыты 80 и 443 (остальные правила не тронуты)"
fi

CONF=/etc/nginx/sites-available/mioflow.conf
LINK=/etc/nginx/sites-enabled/mioflow.conf
BACKUP=""
[ -f "$CONF" ] && { BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"; cp "$CONF" "$BACKUP"; }
IPV6=true; [ -f /proc/net/if_inet6 ] || IPV6=false

apply() {
  ln -sf "$CONF" "$LINK"
  if nginx -t 2>/tmp/mioflow-nginx-test.log; then
    systemctl reload nginx
  else
    cat /tmp/mioflow-nginx-test.log >&2
    if [ -n "$BACKUP" ]; then cp "$BACKUP" "$CONF"; else rm -f "$CONF" "$LINK"; fi
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
    die "Конфиг Nginx не прошёл проверку — вернул как было. Пришлите текст ошибки выше"
  fi
}

# ─── 4. Временный конфиг только на 80 — для выдачи сертификата ───
say "Подключаю домен в Nginx (только HTTP, для получения сертификата)"
cat > "$CONF" <<EOF
# MioFlow, временный конфиг до получения сертификата (enable-domain.sh)
server {
    listen 80;
$( $IPV6 && echo '    listen [::]:80;' )
    server_name ${HOSTS[*]};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:$SITE_PORT; proxy_set_header Host \$host; }
}
EOF
apply

# ─── 5. Сертификат ───
say "Получаю сертификат Let's Encrypt"
MAIL_ARGS=(--register-unsafely-without-email)
[ -n "$EMAIL" ] && MAIL_ARGS=(-m "$EMAIL")
certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" -d "app.$DOMAIN" --cert-name "$DOMAIN" \
  --non-interactive --agree-tos --keep-until-expiring "${MAIL_ARGS[@]}" \
  --deploy-hook "systemctl reload nginx" \
  || die "Сертификат не выдан. Частые причины: DNS ещё не обновился у всех, порт 80 закрыт файрволом в панели хостинга"
ok "Сертификат получен, продлевается автоматически"

# ─── 6. Полный конфиг с HTTPS ───
say "Включаю HTTPS"
cp "$CONF" "$CONF.http-only"; BACKUP="$CONF.http-only"   # при ошибке вернёмся к рабочему HTTP-конфигу
# Директива «http2 on» есть с Nginx 1.25.1; в старых версиях (Ubuntu 22.04/24.04) — «listen 443 ssl http2»
NGX=$(nginx -v 2>&1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*' | head -1)
OLD_NGX=false; [ "$(printf '%s\n1.25.1\n' "$NGX" | sort -V | head -1)" = "1.25.1" ] || OLD_NGX=true
sed -e "s/mioflow\.ru/$DOMAIN/g" -e "s/127\.0\.0\.1:8080/127.0.0.1:$SITE_PORT/g" deploy/nginx/host-mioflow.conf \
  | { if $OLD_NGX; then sed -e '/http2 on;/d' -e 's/listen 443 ssl;/listen 443 ssl http2;/' -e 's/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/'; else cat; fi; } \
  | { if $IPV6; then cat; else grep -v 'listen \[::\]'; fi; } > "$CONF"
apply
ok "Nginx обслуживает https://$DOMAIN и https://app.$DOMAIN"

# ─── 7. Новые адреса в .env и перезапуск MioFlow ───
say "Обновляю адреса в .env (копия: .env.bak-*)"
cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
env_set PUBLIC_WEB_URL "https://$DOMAIN"
env_set APP_URL "https://app.$DOMAIN"
env_set NGINX_BIND 127.0.0.1
env_set COOKIE_SECURE true
chmod 600 .env
docker compose up -d

say "Проверяю"
for _ in $(seq 1 30); do
  curl -fsS -m 5 "https://$DOMAIN/v1/health" >/dev/null 2>&1 && break
  sleep 3
done
curl -fsS -m 5 "https://$DOMAIN/v1/health" >/dev/null || die "https://$DOMAIN не отвечает. Логи: docker compose logs --tail=100 api"
curl -fsS -m 5 "https://app.$DOMAIN/config.js" | grep -q "app.$DOMAIN" || die "Приложение на app.$DOMAIN получило старые адреса. Выполните: docker compose up -d --force-recreate nginx"
ok "MioFlow работает по HTTPS"

# Прямой доступ по IP:порт больше не нужен — порты слушают только 127.0.0.1
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw delete allow "$SITE_PORT/tcp" >/dev/null 2>&1 || true
  ufw delete allow "$APP_PORT/tcp" >/dev/null 2>&1 || true
fi

cat <<EOF

  Сайт и онлайн-запись:  https://$DOMAIN
  Приложение (CRM):      https://app.$DOMAIN
  Пример записи:         https://$DOMAIN/b/demo

  Адреса http://IP:$SITE_PORT и :$APP_PORT больше не открываются снаружи — так и должно быть.
EOF

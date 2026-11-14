#!/bin/sh
# Запускается официальным образом nginx при старте контейнера (/docker-entrypoint.d).
# Подставляет адреса сайта и приложения из переменных окружения в /config.js,
# поэтому один и тот же образ работает и по IP, и на домене.
set -eu

# Разрешаем только символы URL — защита от внедрения кода через переменные
clean() { printf '%s' "$1" | tr -cd 'A-Za-z0-9:/._-'; }
SITE=$(clean "${PUBLIC_WEB_URL:-}")
APP=$(clean "${APP_URL:-}")
# Номер счётчика Яндекс Метрики — только цифры; пусто — счётчик выключен
YM=$(printf '%s' "${YANDEX_METRIKA_ID:-}" | tr -cd '0-9')

for root in /srv/site /srv/app; do
  printf 'window.__MIOFLOW__={"PUBLIC_WEB_URL":"%s","APP_URL":"%s","YM_ID":"%s"};\n' "$SITE" "$APP" "$YM" > "$root/config.js"
  # Подключаем config.js первым скриптом страницы (один раз)
  if ! grep -q '/config.js' "$root/index.html"; then
    sed -i 's#<head>#<head><script src="/config.js"></script>#' "$root/index.html"
  fi
done
echo "MioFlow: сайт ${SITE:-?}, приложение ${APP:-?}, Метрика ${YM:-выключена}"

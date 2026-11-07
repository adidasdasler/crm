# Публикация MioFlow на VPS

MioFlow работает **целиком в Docker** и изолирован от остального сервера. Ваши боты-службы (systemd), их файлы, порты и настройки не затрагиваются:

| Чего MioFlow НЕ делает | Почему это важно для ботов |
|---|---|
| Не обновляет системные пакеты (`apt upgrade`) | Версии Python/Node и библиотек у ботов не меняются |
| Не перезапускает уже установленный Docker | Если у вас есть контейнеры, они не перезапустятся |
| Не трогает systemd-службы, cron других программ, хостовый Nginx | Боты продолжают работать как раньше |
| Не включает файрвол | Нельзя случайно потерять SSH или закрыть порты ботов |
| Не занимает занятые порты — останавливается с понятной ошибкой | Нет конфликтов с вебхуками ботов |
| Не собирает образы на сервере (скачивает готовые из GitHub) | Сборке нужно ~2 ГБ памяти — на сервере она могла бы «выдавить» ботов |
| Ограничен по памяти: база 768 МБ, API 512 МБ, воркер 256 МБ, Nginx 128 МБ | Даже под нагрузкой MioFlow не займёт всю память |
| Логи ограничены (10 МБ × 5 на контейнер) | Диск не переполнится |

В конце установки скрипт сравнивает список работающих служб до и после и показывает, что ничего не остановилось.

> ⚠️ Одно изменение на уровне системы, если Docker ещё не установлен: Docker добавляет свои правила iptables и включает пересылку пакетов только для своих контейнеров. На обычных ботов это не влияет. Если на сервере есть VPN (WireGuard/OpenVPN) с маршрутизацией — скажите, проверим заранее.

## Что понадобится

- VPS в России: Ubuntu 22.04 или 24.04, свободно ≥1,5 ГБ памяти и ≥5 ГБ диска, доступ по SSH с `sudo`.
- Аккаунт GitHub `adidasdasler` — для двух токенов (ниже).

---

## Шаг 1. Проверить, что сборка в GitHub прошла

Откройте https://github.com/adidasdasler/crm/actions. У последнего запуска **Docker images** должна стоять зелёная галочка. Этот запуск собрал образы и поднял весь сервис в тестовом окружении: проверил сайт, приложение, вход, роли базы, бэкап и восстановление.

## Шаг 2. Создать два токена GitHub

Оба токена — **только на чтение**. Срок — 90 дней, потом их можно перевыпустить.

1. **Для скачивания кода.** GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token. Repository access → Only select repositories → `crm`. Permissions → Contents: **Read-only**.
2. **Для скачивания образов.** Там же → **Tokens (classic)** → Generate new token (classic). Отметьте только **read:packages**.

Сохраните оба токена в менеджер паролей. В чат их не присылайте.

## Шаг 3. Посмотреть, что уже работает на сервере

Подключитесь по SSH. Эти команды ничего не меняют, только показывают состояние:

```bash
systemctl list-units --type=service --state=running --no-pager | grep -v systemd
```

```bash
sudo ss -ltnp | grep -E ':(8080|8081|80|443)\b' || echo "порты 8080/8081 свободны"
```

```bash
free -h && df -h /
```

Если порты 8080 или 8081 заняты ботом, на шаге 5 укажите другие: `--site-port 8090 --app-port 8091`.

## Шаг 4. Скачать код

Код кладётся в отдельную папку `/opt/mioflow`, файлы ботов не затрагиваются. На запрос «Username» введите `adidasdasler`, на «Password» вставьте **первый** токен (код):

```bash
sudo git clone -b claude/zen-hawking-ibm979 https://github.com/adidasdasler/crm.git /opt/mioflow
```

## Шаг 5. Установить

```bash
cd /opt/mioflow && sudo bash deploy/install.sh --ghcr-user adidasdasler --demo
```

Скрипт попросит **второй** токен (образы). При вводе символы не отображаются, так и должно быть. Установка занимает 3–5 минут.

- `--demo` создаёт демо-салон для показа. Уберите флаг, если показывать не нужно.
- Если на шаге 3 порты оказались заняты, добавьте `--site-port 8090 --app-port 8091`.

В конце скрипт покажет:

- адреса: сайт `http://IP:8080`, приложение `http://IP:8081`;
- строку «Все службы, которые работали до установки, работают и сейчас»;
- **пароль шифрования бэкапов** — сразу сохраните его в менеджер паролей.

Если у провайдера VPS есть свой файрвол в панели управления, откройте в нём порты 8080 и 8081.

## Шаг 6. Убедиться, что боты в порядке

Подставьте название службы своего бота:

```bash
systemctl status ИМЯ_СЛУЖБЫ_БОТА --no-pager
```

---

## Без домена: что важно знать

- **Нет HTTPS** — пароли и данные идут незашифрованными. Это режим для проверки и показа, не для реальных клиентов.
- **Telegram-бот MioFlow и оплата через ЮKassa** требуют HTTPS, то есть заработают после подключения домена. Не путайте с вашими ботами: их это никак не касается.

## Подключение домена mioflow.ru (для реальных клиентов)

1. Купите `mioflow.ru`. У регистратора создайте A-записи: `mioflow.ru`, `www`, `app` → IP сервера.
2. В `/opt/mioflow/.env` замените строки:

   ```
   PUBLIC_WEB_URL=https://mioflow.ru
   APP_URL=https://app.mioflow.ru
   NGINX_BIND=127.0.0.1
   COOKIE_SECURE=true
   ```

3. **Если хостовый Nginx уже стоит** (например, для вебхуков ботов) — добавляется ещё один сайт, существующие конфиги не меняются:

   ```bash
   sudo cp /opt/mioflow/deploy/nginx/host-mioflow.conf /etc/nginx/sites-available/mioflow.conf
   ```

   ```bash
   sudo ln -s /etc/nginx/sites-available/mioflow.conf /etc/nginx/sites-enabled/ && sudo mkdir -p /var/www/certbot
   ```

   Если Nginx нет, установите его: `sudo apt-get install -y --no-upgrade nginx certbot`.

4. Временно закомментируйте в `mioflow.conf` блок `server { listen 443 ... }`. Проверьте конфиг и перезагрузите Nginx. `reload` не обрывает соединения других сайтов:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. Получите сертификат:

   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot -d mioflow.ru -d www.mioflow.ru -d app.mioflow.ru
   ```

6. Раскомментируйте блок 443 и снова выполните `sudo nginx -t && sudo systemctl reload nginx`.
7. Примените новые адреса:

   ```bash
   cd /opt/mioflow && sudo docker compose up -d
   ```

8. Если открывали порты 8080/8081 в ufw, закройте их:

   ```bash
   sudo ufw delete allow 8080/tcp; sudo ufw delete allow 8081/tcp
   ```

---

## Обновление, логи, остановка

Команды выполняются в `/opt/mioflow`.

| Задача | Команда |
|---|---|
| Обновить до новой версии (бэкап → код → образы → перезапуск) | `sudo bash deploy/scripts/deploy.sh` |
| Логи | `sudo docker compose logs -f --tail=100 api worker` |
| Состояние контейнеров и память | `sudo docker compose ps` и `sudo docker stats --no-stream` |
| Остановить MioFlow (данные сохраняются) | `sudo docker compose down` |
| Запустить снова | `sudo docker compose up -d` |

**Полностью удалить MioFlow с сервера** (с базой) — только если точно нужно:

```bash
cd /opt/mioflow && sudo docker compose down -v && sudo rm -f /etc/cron.d/mioflow-backup
```

## Бэкапы

- Каждый день в 03:15, зашифрованы AES-256, хранятся 30 дней в `/opt/mioflow/backups`. Журнал — `/var/log/mioflow-backup.log`.
- **Обязательно настройте копию вне сервера:** docs/SECURITY.md, раздел 3 (Yandex Object Storage, около 10 ₽/мес).
- Раз в месяц проверяйте восстановление: `sudo bash deploy/scripts/test-restore.sh`.

## Интеграции (после подключения домена)

Ключи вписываются в `/opt/mioflow/.env`, затем выполняется `sudo docker compose up -d`.

- **Telegram-бот MioFlow:** @BotFather → `/newbot` → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`. Это отдельный бот, ваши боты не затрагиваются. Перед включением прочитайте legal/RKN-notification.md.
- **MAX (бот для клиентов):** зарегистрируйте бота на [business.max.ru](https://business.max.ru) (нужна верифицированная организация/самозанятый) → токен в `MAX_BOT_TOKEN`, имя бота в `MAX_BOT_USERNAME`. Вебхук воркер подписывает сам при старте; секрет `MAX_WEBHOOK_SECRET` уже создан установщиком.
- **ВКонтакте (сообщения сообщества):** создайте сообщество MioFlow → Управление → Сообщения: включить, «Возможности ботов»: включить → Работа с API → ключ доступа с правом «сообщения» → `VK_GROUP_TOKEN`; короткое имя сообщества → `VK_GROUP_SCREEN_NAME`. В разделе Callback API: версия 5.199, адрес `https://mioflow.ru/v1/webhooks/vk`, строку подтверждения → `VK_CONFIRMATION_CODE`, секретный ключ — значение `VK_SECRET` из `.env`; типы событий: «Входящее сообщение» и «Действие с сообщением».
- **SMS не используются:** напоминания уходят в первый подключённый канал — Telegram → MAX → ВКонтакте → email. Всё бесплатно для салона и клиента.
- **Почта:** ящик `no-reply@mioflow.ru` в Яндекс 360 → `SMTP_URL="smtps://no-reply%40mioflow.ru:ПАРОЛЬ_ПРИЛОЖЕНИЯ@smtp.yandex.ru:465"`.
- **ЮKassa (самозанятый):** `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`. Адрес уведомлений — `https://mioflow.ru/v1/webhooks/yookassa`, события `payment.succeeded` и `payment.canceled`.

## Если что-то пошло не так

| Симптом | Что сделать |
|---|---|
| «Порт 8080 уже занят» | Повторите установку с `--site-port` и `--app-port` |
| `denied` при скачивании образов | Проверьте второй токен: classic, право read:packages |
| Сайт не открывается снаружи, а на сервере `curl localhost:8080` работает | Откройте порты в файрволе провайдера |
| Сервис не стартует | `sudo docker compose logs --tail=100 api` — пришлите вывод |

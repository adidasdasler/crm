# Деплой на VPS

Схема: Docker (Nginx → API → PostgreSQL + воркер напоминаний и подписок). Другие сайты и боты на сервере не затрагиваются: MioFlow занимает только свои порты.

- **Без домена (сейчас):** сайт открывается на `http://IP:8080`, приложение — на `http://IP:8081`. Для проверки и показа.
- **С доменом mioflow.ru (для реальных клиентов):** хостовый Nginx с HTTPS на портах 80/443 → `127.0.0.1:8080`.

## 0. Что нужно

- VPS в России (152-ФЗ), Ubuntu 22.04 или 24.04, от 2 vCPU и 4 ГБ памяти, 30+ ГБ диска.
- Доступ по SSH с правами `sudo`.

## А. Быстрый запуск по IP — без домена

### 1. Доступ к коду

Репозиторий приватный, поэтому серверу нужен токен только на чтение:

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Repository access: **Only select repositories** → `crm`. Permissions → Repository → **Contents: Read-only**. Срок — например, 90 дней.
3. Скопируйте токен (показывается один раз).

### 2. Установка

Подключитесь к серверу по SSH и выполните. На запрос логина введите имя пользователя GitHub, вместо пароля — токен:

```bash
sudo git clone -b claude/zen-hawking-ibm979 https://github.com/adidasdasler/crm.git /opt/pora
```

```bash
cd /opt/pora && sudo bash deploy/install.sh --demo
```

Флаг `--demo` создаёт демо-салон для показа (вход `demo@salon.local` / `demo12345`); уберите его, если не нужен.

Скрипт:

- ставит Docker, если его нет (из репозитория Ubuntu, с зеркалом Docker Hub);
- добавляет swap на небольших серверах — сборке нужно около 2 ГБ памяти;
- создаёт `.env` со случайными паролями;
- собирает и запускает сервис (первый раз 5–15 минут);
- открывает порты 8080 и 8081 в ufw и включает ежедневный бэкап базы.

В конце он печатает адреса сайта и приложения.

> Если у провайдера VPS есть свой файрвол в панели управления, откройте там порты 8080 и 8081.

### Что не работает без домена

- **HTTPS.** Пароли и данные передаются незашифрованными, поэтому реальных клиентов так не подключайте.
- **Telegram-бот.** Telegram отправляет вебхуки только на HTTPS-адрес, поэтому напоминания пока могут уходить только по SMS.
- **Оплата ЮKassa** требует HTTPS-адрес для уведомлений.

### Обновление

```bash
cd /opt/pora && sudo bash deploy/scripts/deploy.sh
```

Скрипт делает бэкап, скачивает новую версию, пересобирает и перезапускает сервис.

## Б. Переход на домен mioflow.ru

1. У регистратора домена создайте DNS-записи типа A: `mioflow.ru`, `www.mioflow.ru`, `app.mioflow.ru` → IP сервера.
2. В `/opt/pora/.env` поменяйте:

   ```
   PUBLIC_WEB_URL=https://mioflow.ru
   APP_URL=https://app.mioflow.ru
   NGINX_BIND=127.0.0.1
   COOKIE_SECURE=true
   ```

3. Установите Nginx и certbot на сервер (если их нет):

   ```bash
   sudo apt-get install -y nginx certbot
   ```

4. Подключите конфиг сайта:

   ```bash
   sudo cp /opt/pora/deploy/nginx/host-mioflow.conf /etc/nginx/sites-available/mioflow.conf
   ```

   ```bash
   sudo mkdir -p /var/www/certbot && sudo ln -s /etc/nginx/sites-available/mioflow.conf /etc/nginx/sites-enabled/
   ```

5. Получите сертификат. Блок `listen 443` в конфиге ссылается на сертификат, поэтому до его выпуска временно закомментируйте этот блок:

   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot -d mioflow.ru -d www.mioflow.ru -d app.mioflow.ru
   ```

6. Раскомментируйте блок 443 и перезагрузите Nginx:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

7. Пересоберите сервис с новыми адресами:

   ```bash
   cd /opt/pora && sudo bash deploy/scripts/deploy.sh
   ```

8. Закройте временные порты:

   ```bash
   sudo ufw delete allow 8080/tcp && sudo ufw delete allow 8081/tcp
   ```

Certbot сам продлевает сертификат (systemd timer).

## 4. Telegram-бот, SMS, почта и оплата

Все ключи вписываются в `/opt/pora/.env`. После правок выполните `sudo bash deploy/scripts/deploy.sh`.

**Telegram-бот** (нужен домен с HTTPS):

1. В Telegram откройте @BotFather → `/newbot` → получите токен.
2. Заполните `TELEGRAM_BOT_TOKEN` и `TELEGRAM_BOT_USERNAME` (без @). `TELEGRAM_WEBHOOK_SECRET` скрипт установки уже сгенерировал.
3. После перезапуска в `docker compose logs worker` должна появиться строка `telegram setWebhook ok`.
4. В приложении: «Ещё → Уведомления в Telegram → Подключить».

> Перед включением Telegram прочитайте про трансграничную передачу в [legal/RKN-notification.md](legal/RKN-notification.md). Без Telegram сервис тоже работает: напоминания уходят по SMS.

**SMS:** зарегистрируйтесь на sms.ru, пополните баланс и укажите `SMS_RU_API_KEY`. SMS уходят только клиентам без Telegram, в пределах лимита тарифа салона.

**Почта** (восстановление пароля): создайте ящик `no-reply@mioflow.ru`, например в Яндекс 360. Получите пароль приложения и укажите `SMTP_URL="smtps://no-reply%40mioflow.ru:ПАРОЛЬ@smtp.yandex.ru:465"`.

**Оплата (ЮKassa для самозанятых):**

1. Подключите магазин в ЮKassa как самозанятый и проверьте, что чеки в «Мой налог» формируются автоматически.
2. Укажите `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY`.
3. В личном кабинете ЮKassa → «Интеграция» → «HTTP-уведомления» укажите `https://mioflow.ru/v1/webhooks/yookassa` и отметьте события `payment.succeeded` и `payment.canceled`.
4. Сделайте тестовую оплату на минимальную сумму.

## 5. Бэкапы

Скрипт установки уже включил ежедневный бэкап в 03:15 (`/etc/cron.d/pora-backup`).

- Бэкапы хранятся в `/opt/pora/backups` 30 дней. Чтобы шифровать их, укажите `BACKUP_GPG_RECIPIENT`.
- Копию за пределы сервера отправляйте в хранилище в РФ (Yandex Object Storage) через `rclone`.
- Раз в месяц проверяйте восстановление: `sudo bash deploy/scripts/test-restore.sh`.

## 6. Обслуживание

Команды выполняются в `/opt/pora`.

| Задача | Команда |
|---|---|
| Логи API | `sudo docker compose logs -f --tail=100 api` |
| Логи напоминаний и подписок | `sudo docker compose logs -f --tail=100 worker` |
| Обновить версию | `sudo bash deploy/scripts/deploy.sh` |
| Консоль БД | `sudo docker compose exec postgres psql -U salon` |
| Перезапуск | `sudo docker compose restart api` |
| Остановить всё | `sudo docker compose down` (данные сохраняются) |

## 7. Мониторинг (минимум)

- UptimeRobot или аналог раз в минуту проверяет `https://mioflow.ru/v1/health` (до домена — `http://IP:8080/v1/health`) и шлёт алерт в Telegram.
- Мониторинг ошибок (self-hosted GlitchTip) — в планах.

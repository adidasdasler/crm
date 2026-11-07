# Деплой на VPS

Схема: хостовый Nginx (80/443, TLS) → `127.0.0.1:8080` → Docker (Nginx → API → PostgreSQL; воркер напоминаний и подписок).
Наружу из Docker открыт только `127.0.0.1:8080`. Другие сайты и боты на сервере не затрагиваются.

## 0. Что нужно

- VPS в РФ (152-ФЗ), Ubuntu 22.04/24.04, от 2 vCPU и 4 GB RAM.
- Домен, например `salon.ru`. DNS-записи A для `salon.ru`, `www.salon.ru`, `app.salon.ru` указывают на IP сервера.
- Docker 24+ с Docker Compose v2 и Nginx на хосте.

## 1. Код и секреты

```bash
sudo mkdir -p /opt/salon && sudo chown $USER /opt/salon
```

```bash
git clone https://github.com/<ваш-аккаунт>/<репозиторий>.git /opt/salon && cd /opt/salon
```

```bash
cp .env.example .env && chmod 600 .env
```

Заполните `.env`. Секреты сгенерируйте командой ниже: по одному разу на `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `JWT_SECRET` и `TELEGRAM_WEBHOOK_SECRET`.

```bash
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48
```

Укажите домены в `PUBLIC_WEB_URL=https://salon.ru` и `APP_URL=https://app.salon.ru`.

## 2. Запуск

```bash
bash deploy/scripts/deploy.sh
```

Скрипт собирает образы, поднимает стек, применяет миграции и создаёт тарифы. В конце он проверяет `http://127.0.0.1:8080/v1/health`.

## 3. Nginx на хосте и SSL

```bash
sudo cp deploy/nginx/host-salon.conf /etc/nginx/sites-available/salon.conf
```

```bash
sudo sed -i 's/salon\.ru/ВАШ-ДОМЕН.ru/g' /etc/nginx/sites-available/salon.conf
```

Получите сертификат. Блок 443 в конфиге ссылается на сертификат, поэтому до его выпуска временно закомментируйте этот блок.

```bash
sudo mkdir -p /var/www/certbot && sudo ln -s /etc/nginx/sites-available/salon.conf /etc/nginx/sites-enabled/
```

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d ВАШ-ДОМЕН.ru -d www.ВАШ-ДОМЕН.ru -d app.ВАШ-ДОМЕН.ru
```

После выпуска раскомментируйте блок 443 и перезагрузите Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Certbot сам продлевает сертификат (systemd timer).

## 4. Telegram-бот, SMS и оплата

**Telegram-бот** (напоминания клиентам, уведомления вам о новых записях):

1. В Telegram откройте @BotFather → `/newbot` → получите токен.
2. В `.env` заполните `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (без @) и `TELEGRAM_WEBHOOK_SECRET` (любая случайная строка).
3. Перезапустите стек: `bash deploy/scripts/deploy.sh`. Воркер сам зарегистрирует вебхук `https://ВАШ-ДОМЕН.ru/v1/webhooks/telegram`. Если всё прошло успешно, в `docker compose logs worker` будет строка `telegram setWebhook ok`.
4. В приложении: «Ещё → Уведомления в Telegram → Подключить».

> Перед включением Telegram прочитайте про трансграничную передачу в [legal/RKN-notification.md](legal/RKN-notification.md). Без Telegram сервис тоже работает: напоминания уходят по SMS.

**SMS:** зарегистрируйтесь на sms.ru, пополните баланс и укажите `SMS_RU_API_KEY`. SMS уходят только клиентам без Telegram, в пределах лимита тарифа салона.

**Оплата (ЮKassa для самозанятых):**

1. Подключите магазин в ЮKassa как самозанятый и проверьте, что чеки в «Мой налог» формируются автоматически.
2. В `.env` укажите `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY`.
3. В личном кабинете ЮKassa → «Интеграция» → «HTTP-уведомления» укажите `https://ВАШ-ДОМЕН.ru/v1/webhooks/yookassa` и отметьте события `payment.succeeded` и `payment.canceled`.
4. Сделайте тестовую оплату на минимальную сумму. Если вебхук не дошёл, статус подтягивается сам, когда владелец возвращается на страницу «Подписка».

## 5. Бэкапы

```bash
crontab -e
```

Добавьте строку (ежедневно в 03:15):

```
15 3 * * * cd /opt/salon && bash deploy/scripts/backup.sh >> /var/log/salon-backup.log 2>&1
```

- Бэкапы хранятся в `/opt/salon/backups` 30 дней. Чтобы шифровать их, укажите `BACKUP_GPG_RECIPIENT`.
- Копию за пределы сервера отправляйте в хранилище в РФ (Yandex Object Storage) через `rclone`.
- Раз в месяц проверяйте восстановление: `bash deploy/scripts/test-restore.sh`.

## 6. Обслуживание

| Задача | Команда |
|---|---|
| Логи API | `docker compose logs -f --tail=100 api` |
| Логи напоминаний и подписок | `docker compose logs -f --tail=100 worker` |
| Обновить версию | `bash deploy/scripts/deploy.sh` |
| Консоль БД | `docker compose exec postgres psql -U salon` |
| Перезапуск | `docker compose restart api` |

## 7. Мониторинг (минимум)

- UptimeRobot или аналог проверяет `https://ВАШ-ДОМЕН.ru/v1/health` раз в минуту и шлёт алерт в Telegram.
- Мониторинг ошибок (self-hosted Sentry/GlitchTip) — в плане этапа 2.1.

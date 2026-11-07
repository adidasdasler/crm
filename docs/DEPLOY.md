# Деплой на VPS

Схема: хостовый Nginx (80/443, TLS) → `127.0.0.1:8080` → Docker (Nginx → API → PostgreSQL, Redis).
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

Заполните `.env`. Секреты сгенерируйте командой ниже: по одному разу на `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `REDIS_PASSWORD` и `JWT_SECRET`.

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

## 4. Бэкапы

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

## 5. Обслуживание

| Задача | Команда |
|---|---|
| Логи API | `docker compose logs -f --tail=100 api` |
| Обновить версию | `bash deploy/scripts/deploy.sh` |
| Консоль БД | `docker compose exec postgres psql -U salon` |
| Перезапуск | `docker compose restart api` |

## 6. Мониторинг (минимум)

- UptimeRobot или аналог проверяет `https://ВАШ-ДОМЕН.ru/v1/health` раз в минуту и шлёт алерт в Telegram.
- Sentry подключается на этапе 2 (`SENTRY_DSN`).

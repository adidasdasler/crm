# MioFlow: команды для обслуживания и восстановления

Все команды выполняются на сервере в папке проекта:

```bash
cd /opt/mioflow
```

Другие боты и сайты на сервере эти команды не затрагивают: работают только с контейнерами MioFlow (`docker compose` в этой папке).

---

## 1. Быстрая проверка: всё ли работает

| Что проверить | Команда |
|---|---|
| Контейнеры запущены | `sudo docker compose ps` |
| API отвечает, воркер жив (`"worker":"ok"`) | `curl -s http://127.0.0.1:8080/v1/health` |
| Память и процессор | `sudo docker stats --no-stream` |
| Место на диске | `df -h /` |
| Журнал мониторинга (проверка каждые 5 минут) | `tail -n 30 /var/log/mioflow-monitor.log` |
| Журнал бэкапов | `tail -n 30 /var/log/mioflow-backup.log` |

В приложении: «Ещё → Админ-панель сервиса» показывает воркер, ошибки за сутки, размер базы и свободное место. Пункт виден, если ваш email указан в `ADMIN_EMAILS` в `.env`.

## 2. Логи

| Что | Команда |
|---|---|
| Последние 200 строк API | `sudo docker compose logs --tail=200 api` |
| Следить за логами в реальном времени | `sudo docker compose logs -f --tail=50 api worker` |
| Воркер: напоминания, лист ожидания, предоплата | `sudo docker compose logs --tail=200 worker` |
| Только ошибки | `sudo docker compose logs --tail=2000 api \| grep -i error` |
| Найти запрос по id из админ-панели | `sudo docker compose logs api \| grep <requestId>` |
| Nginx внутри Docker | `sudo docker compose logs --tail=100 nginx` |
| Внешний Nginx и HTTPS | `sudo tail -n 100 /var/log/nginx/error.log` |

Ошибки API и воркера за 30 дней видны и в приложении: «Админ-панель → Ошибки».

## 3. Перезапуск и обновление

| Ситуация | Команда |
|---|---|
| Сайт тормозит или «завис» — перезапустить API и воркер | `sudo docker compose restart api worker` |
| Перезапустить всё MioFlow (база сохраняется) | `sudo docker compose restart` |
| Обновить до последней версии | `sudo bash deploy/scripts/deploy.sh` |
| Остановить MioFlow (данные сохраняются) | `sudo docker compose down` |
| Запустить после остановки | `sudo docker compose up -d` |
| Применить изменения в `.env` | `sudo docker compose up -d` |

`deploy.sh` сам делает бэкап, скачивает код и образы, перезапускает и проверяет, что сервис поднялся.

## 4. Откат на предыдущую версию

Каждая версия в GitHub собирается в образ с меткой — хэшем коммита.

1. Найдите хэш рабочей версии: на GitHub «Actions → Docker images», или в коде командой `git log --oneline -10`.
2. Укажите его и перезапустите:

```bash
sudo sed -i '/^IMAGE_TAG=/d' .env && echo "IMAGE_TAG=<хэш коммита полностью>" | sudo tee -a .env
```

```bash
sudo docker compose pull && sudo docker compose up -d
```

3. Вернуться на последнюю версию:

```bash
sudo sed -i '/^IMAGE_TAG=/d' .env && sudo bash deploy/scripts/deploy.sh
```

Миграции базы только добавляют таблицы и колонки, поэтому старая версия работает с обновлённой базой. Если откат не помог — восстановите базу из бэкапа (раздел 6).

## 5. Бэкапы

- Делаются автоматически каждый день в 03:15 и перед каждым обновлением.
- Хранятся 30 дней в `/opt/mioflow/backups`.
- Шифруются AES-256 паролем `BACKUP_PASSPHRASE` из `.env`. **Храните копию этого пароля вне сервера**: без него бэкап не расшифровать.

| Задача | Команда |
|---|---|
| Сделать бэкап прямо сейчас | `sudo bash deploy/scripts/backup.sh` |
| Список бэкапов | `ls -lh backups/` |
| Проверить, что последний бэкап восстанавливается (раз в месяц) | `sudo bash deploy/scripts/test-restore.sh` |
| Скачать бэкапы к себе на компьютер (выполнять на компьютере) | `scp -r root@<IP сервера>:/opt/mioflow/backups ./mioflow-backups` |

Копия во внешнее хранилище в России: укажите `BACKUP_RCLONE_REMOTE` в `.env` (подробно — docs/SECURITY.md, раздел 3).

## 6. Восстановление из бэкапа

Когда нужно: данные испорчены, удалены по ошибке, неудачное обновление.

```bash
sudo bash deploy/scripts/restore.sh
```

Скрипт восстанавливает последний бэкап. Конкретный бэкап указывается так:

```bash
sudo bash deploy/scripts/restore.sh backups/mioflow-20261112-031500.sql.gz.gpg
```

Что делает скрипт:
1. Показывает, что будет восстановлено, и просит написать «ВОССТАНОВИТЬ».
2. Проверяет, что бэкап расшифровывается.
3. Сохраняет **текущее** состояние в новый бэкап — по нему можно вернуться тем же скриптом.
4. Останавливает API и воркер на 1–3 минуты, пересоздаёт базу, загружает данные и фото дизайнов.
5. Запускает сервис и проверяет, что он отвечает.

## 7. Перенос на новый сервер

1. **На старом сервере** сделайте свежий бэкап:

```bash
cd /opt/mioflow && sudo bash deploy/scripts/backup.sh
```

2. **На новом сервере** установите MioFlow по docs/DEPLOY.md, шаги 1–5.
3. Скопируйте со старого сервера `.env` и папку `backups` (выполняется на новом сервере):

```bash
sudo scp root@<IP старого сервера>:/opt/mioflow/.env /opt/mioflow/.env
```

```bash
sudo scp -r root@<IP старого сервера>:/opt/mioflow/backups /opt/mioflow/
```

   Именно старый `.env` важен: в нём `BACKUP_PASSPHRASE` (расшифровка бэкапа), `JWT_SECRET` (иначе перестанут работать ссылки «управлять записью» и все войдут заново), `SECRETS_KEY` (ключи ЮKassa салонов) и пароли базы.
4. Перезапустите сервис с этим `.env` и восстановите данные:

```bash
cd /opt/mioflow && sudo docker compose up -d && sudo bash deploy/scripts/restore.sh
```

5. Переключите домен: в DNS (Selectel) поменяйте A-записи `@`, `www`, `app` на IP нового сервера. Затем включите HTTPS:

```bash
sudo bash deploy/scripts/enable-domain.sh
```

6. Проверьте сайт и вход. Старый сервер выключайте через несколько дней, когда убедитесь, что всё работает.
7. Если сменился провайдер или город дата-центра, подайте в Роскомнадзор уведомление об изменении сведений в течение 10 рабочих дней (docs/legal/RKN-notification.md).

## 8. Частые проблемы

| Симптом | Причина и что делать |
|---|---|
| Сайт не открывается совсем | `sudo docker compose ps`: если контейнеры не `running` — `sudo docker compose up -d`. Если запущены — проверьте внешний Nginx: `sudo nginx -t && sudo systemctl reload nginx` |
| «502 Bad Gateway» | API не поднялся: `sudo docker compose logs --tail=100 api` — частая причина в ошибке в `.env` |
| Не приходят напоминания | В админ-панели воркер «не отвечает» → `sudo docker compose restart worker`, затем `sudo docker compose logs --tail=100 worker` |
| «Нет места на диске» | `sudo docker system prune -f` (удаляет старые образы, данные не трогает); затем `ls -lh backups/` и при необходимости удалите самые старые бэкапы |
| Истекает сертификат HTTPS | Продлевается автоматически. Вручную: `sudo certbot renew && sudo systemctl reload nginx` |
| Клиент пишет «не могу войти» | Вход блокируется на 15 минут после 5 неверных паролей — подождать или «Забыли пароль?» |
| Салон просит продлить пробный период | «Админ-панель → Салоны» → «+7 дней» или «+30 дней» |
| В демо-салоне беспорядок | «Админ-панель → Сбросить демо-салон сейчас» (или подождать ночного сброса) |

## 9. Консоль базы данных (только чтение, осторожно)

```bash
sudo docker compose exec postgres psql -U postgres -d mioflow
```

Полезные запросы (выход — `\q`):

```sql
-- последние зарегистрированные салоны
SELECT name, slug, "createdAt" FROM "Tenant" WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 10;
-- напоминания, которые не ушли за сутки
SELECT status, count(*) FROM "Reminder" WHERE "scheduledAt" > now() - interval '1 day' GROUP BY status;
-- размер базы
SELECT pg_size_pretty(pg_database_size('mioflow'));
```

Изменять данные напрямую в базе не стоит: сначала сделайте бэкап (`sudo bash deploy/scripts/backup.sh`).

## 10. Секреты в `.env`

| Переменная | Что будет, если потерять или сменить |
|---|---|
| `BACKUP_PASSPHRASE` | Старые бэкапы не расшифровать. **Храните копию вне сервера** |
| `JWT_SECRET` | Все пользователи выйдут из аккаунтов; старые ссылки «управлять записью» перестанут работать |
| `SECRETS_KEY` | Сохранённые ключи ЮKassa салонов не расшифруются — салонам придётся ввести их заново |
| `POSTGRES_PASSWORD`, `OWNER_DB_PASSWORD`, `APP_DB_PASSWORD` | Записаны в базе при установке: меняйте только вместе с паролями ролей в PostgreSQL |
| `ALERT_TELEGRAM_*` | Перестанут приходить тревоги мониторинга |

Безопасная копия `.env` на ваш компьютер (выполняется на компьютере):

```bash
scp root@<IP сервера>:/opt/mioflow/.env ./mioflow.env
```

Храните её в менеджере паролей или на зашифрованном диске, не в мессенджерах.

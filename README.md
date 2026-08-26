# BookMeeting - Система управления встречами

Полнофункциональное приложение для управления встречами с интеграцией в Bitrix24.

## 🚀 Быстрый запуск

### Требования
- Docker Desktop
- Docker Compose

### Запуск
```bash
# Запустить проект
./start.sh

# Остановить проект  
./stop.sh

# Посмотреть логи
docker-compose logs -f
```

## 🌐 Доступные сервисы

- **Frontend**: http://localhost:8088
- **Backend API**: http://localhost:4400
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## 📁 Структура проекта

```
BookMeeting/
├── backend/          # Node.js API сервер
├── frontend/         # React приложение
├── docker-compose.yml # Конфигурация Docker
├── start.sh          # Скрипт запуска
└── stop.sh           # Скрипт остановки
```

## 🔧 Разработка

По умолчанию Docker собирает продакшен-образы. Изменения в коде попадут в контейнеры после пересборки:

```bash
./start.sh
```

Для горячей перезагрузки (hot reload) запускайте сервисы локально:

- Frontend (Vite):
  ```bash
  cd frontend
  npm install
  npm run dev
  ```
  Откроется на http://localhost:5173

- Backend (nodemon):
  ```bash
  cd backend
  npm install
  npm run dev
  ```
  API на http://localhost:4400

## 🗄️ База данных

PostgreSQL с автоматическим созданием схемы через Sequelize ORM.

## 📝 Логи

```bash
# Все сервисы
docker-compose logs -f

# Только backend
docker-compose logs -f backend

# Только frontend  
docker-compose logs -f frontend
```

## 🚢 Продакшен и домен

На сервере уже установлен Nginx. Контейнеры поднимаются Docker Compose, а Nginx на хосте проксирует запросы к фронтенду и API.

### Шаги
1) На сервере подготовьте `.env` по образцу `env.example`.
2) Запустите:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
3) Конфиг Nginx (хост-машина) для `book-meeting.centr-cred.by`:
```nginx
server {
    listen 80;
    server_name book-meeting.centr-cred.by;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name book-meeting.centr-cred.by;

    ssl_certificate     /etc/letsencrypt/live/book-meeting.centr-cred.by/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/book-meeting.centr-cred.by/privkey.pem;

    # Frontend (статика)
    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:4400;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### SSL (Let’s Encrypt + автообновление)
```bash
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d book-meeting.centr-cred.by \
  --email admin@centr-cred.by --agree-tos --non-interactive
```
Cron для автообновления и перезагрузки Nginx:
```bash
0 3 * * * certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

## CI/CD (GitHub Actions)

Workflow `.github/workflows/deploy.yml` при пуше в `main` подключается по SSH к серверу, обновляет код и запускает `docker-compose.prod.yml`.
Необходимые secrets в репозитории:
- `SSH_HOST`, `SSH_USER`, `SSH_KEY` (private key), `SSH_PORT` (optional)
- `DEPLOY_PATH` – путь деплоя на сервере

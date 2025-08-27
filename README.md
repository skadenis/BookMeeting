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

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:4000
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

Все изменения в коде автоматически перезагружаются благодаря volume mounts в Docker.

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

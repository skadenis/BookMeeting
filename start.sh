#!/bin/bash

echo "🚀 Запускаю BookMeeting через Docker Compose..."

# Останавливаем если уже запущено
docker-compose down

# Собираем и запускаем
docker-compose up --build -d

echo "✅ Проект запущен!"
echo ""
echo "🌐 Frontend: http://localhost:8088"
echo "🔧 Backend API: http://localhost:4400"
echo "🗄️  PostgreSQL: localhost:5432"
echo "🔴 Redis: localhost:6379"
echo ""
echo "📋 Логи: docker-compose logs -f"
echo "⏹️  Остановить: docker-compose down"

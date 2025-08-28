#!/bin/bash

echo "🚀 Запускаю BookMeeting в режиме разработки (Vite + Nodemon)..."

docker compose down

# Postgres/Redis + backend dev + frontend Vite dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d

echo "✅ Dev-стек запущен!"
echo ""
echo "🌐 Frontend (Vite): http://localhost:5173"
echo "🔧 Backend API: http://localhost:4400"
echo "📋 Логи: docker compose logs -f"



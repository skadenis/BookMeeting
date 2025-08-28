FROM node:20-alpine

WORKDIR /app

# Копируем package файлы
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --omit=dev

# Копируем исходный код
COPY . .

# Открываем порт
EXPOSE 4000

# Запускаем в продакшен режиме
CMD ["npm", "start"]
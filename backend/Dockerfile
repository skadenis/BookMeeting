FROM node:20-alpine

WORKDIR /app

# Копируем package файлы
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci

# Копируем исходный код
COPY . .

# Открываем порт
EXPOSE 4000

# Запускаем в режиме разработки
CMD ["npm", "run", "dev"]
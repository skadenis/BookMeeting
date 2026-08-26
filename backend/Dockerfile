FROM node:20-alpine

# alpine поставляется без базы часовых поясов: без tzdata переменная TZ
# молча игнорируется и контейнер остаётся в UTC
RUN apk add --no-cache tzdata
ENV TZ=Europe/Minsk

WORKDIR /app

# Копируем package файлы
COPY package.json package-lock.json ./

# npm ci вместо npm install: ставит ровно то, что записано в lock-файле.
# Раньше стоял npm install, который молча правил дерево зависимостей —
# и маскировал то, что package-lock.json был рассинхронизирован с package.json
# (в нём не хватало dayjs, node-cron и uuid).
# devDependencies нужны: docker-compose.dev.yml запускает npm run dev (nodemon).
RUN npm ci

# Копируем исходный код (см. .dockerignore — node_modules с хоста не попадёт)
COPY . .

EXPOSE 4000

# Запуск от непривилегированного пользователя
USER node

CMD ["npm", "start"]

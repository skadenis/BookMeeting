FROM node:20-alpine AS builder

WORKDIR /app

# Build-time переменные Vite. VITE_PUBLIC_APP_ID/TOKEN раньше не пробрасывались,
# из-за чего собранный виджет всегда показывал «Нет доступа»: App.jsx требует
# обе, а взять их было неоткуда, кроме адресной строки.
ARG VITE_API_BASE_URL=/api
ARG VITE_PUBLIC_APP_ID=
ARG VITE_PUBLIC_APP_TOKEN=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_PUBLIC_APP_ID=$VITE_PUBLIC_APP_ID
ENV VITE_PUBLIC_APP_TOKEN=$VITE_PUBLIC_APP_TOKEN

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Продакшен образ
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

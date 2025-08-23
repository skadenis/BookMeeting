# Bitrix24 Meetings App

Full-stack appointments management integrated in Bitrix24.

## Quick start (Docker)

1. Copy env example:

```
cp .env.example .env
```

2. Build and run:

```
docker compose up -d --build
```

App will be available at http://localhost:8080 and API at http://localhost:8080/api

## Development

- Backend:
```
cd backend
npm i
npm run dev
```
- Frontend:
```
cd frontend
npm i
npm run dev
```

## Bitrix auth
The app expects a Bearer token from Bitrix and domain in `X-Bitrix-Domain`. For local development, set `BITRIX_DEV_MODE=true` and use `VITE_DEV_BITRIX_TOKEN`/`VITE_DEV_BITRIX_DOMAIN`.

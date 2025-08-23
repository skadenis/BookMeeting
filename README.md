# Bitrix24 Meetings App

Full-stack appointments management integrated in Bitrix24.


## One-click run

- With Docker (if available) or fallback to local dev automatically:
```
npm start
```
- Force local dev (SQLite + in-memory Redis):
```
npm run dev
```
- Force Docker:
```
npm run docker
```

App (Docker): http://localhost:8080
App (Local dev): http://localhost:5173, API: http://localhost:4000/api


## Development

- Backend:
```
cd backend
npm i

node src/index.js

- Frontend:
```
cd frontend
npm i
npm run dev
```

## Bitrix auth
The app expects a Bearer token from Bitrix and domain in `X-Bitrix-Domain`. For local development, set `BITRIX_DEV_MODE=true` and use `VITE_DEV_BITRIX_TOKEN`/`VITE_DEV_BITRIX_DOMAIN`.

#!/usr/bin/env bash
set -euo pipefail
MODE=${1:-auto}

has_docker() {
	command -v docker >/dev/null 2>&1 && command -v docker compose >/dev/null 2>&1
}

run_docker() {
	echo "[run] Starting via Docker Compose..."
	docker compose up -d --build
	echo "[run] Open http://localhost:8080"
}

run_local() {
	echo "[run] Starting locally (SQLite + in-memory Redis)"
	export USE_SQLITE=true
	export DISABLE_REDIS=true
	(
		cd backend
		npm i --silent
		node src/index.js &
		BACK_PID=$!
		echo $BACK_PID > ../.backend.pid
	)
	(
		cd frontend
		npm i --silent
		npm run dev -- --host 0.0.0.0 --port 5173 &
		FRONT_PID=$!
		echo $FRONT_PID > ../.frontend.pid
	)
	echo "[run] Backend: http://localhost:4000 | Frontend: http://localhost:5173"
}

case "$MODE" in
	docker)
		if has_docker; then run_docker; else echo "[run] Docker not found"; exit 1; fi
		;;
	dev|local)
		run_local
		;;
	auto|*)
		if has_docker; then run_docker; else run_local; fi
		;;
 esac
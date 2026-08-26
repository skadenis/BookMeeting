#!/usr/bin/env bash
#
# Разворачивание на сервере. Запускается из .github/workflows/deploy.yml
# после git reset --hard, уже внутри каталога деплоя.
#
# Логика вынесена сюда из YAML намеренно: appleboy/ssh-action передаёт тело
# скрипта строкой, и на длинном тексте с кириллицей и псевдографикой строка
# приходила покалеченной — деплой падал с
#   bash: -c: line 248: syntax error near unexpected token `;'
# Через action теперь идёт только короткая ASCII-команда, а этот файл
# приезжает на сервер обычным git и проверяется bash -n в CI.
#
# Порядок шагов важен: всё, что может упасть, происходит ДО остановки
# работающего сервиса. Раньше деплой первым действием делал
# `docker compose down`, и любая ошибка сборки оставляла прод лежать.

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="http://127.0.0.1:4400/api/health"
HEALTH_ATTEMPTS=30
HEALTH_DELAY=3

fail() {
    echo "ОШИБКА: $*" >&2
    exit 1
}

# --- .env -------------------------------------------------------------------
# Файл больше не создаётся из env.example автоматически: так на сервер
# попадали значения по умолчанию (admin123 и прочие) и приложение
# поднималось с ними как боевое.
if [ ! -f .env ]; then
    fail ".env отсутствует. Создайте его вручную по образцу env.example."
fi

echo "Проверяю переменные окружения..."
set -a
# shellcheck disable=SC1091
. ./.env
set +a

MISSING=""
for VAR in ADMIN_JWT_SECRET ADMIN_PASSWORD PUBLIC_TOKEN_PAIRS BITRIX_REST_URL; do
    if [ -z "${!VAR:-}" ]; then
        MISSING="$MISSING $VAR"
    fi
done
if [ -n "$MISSING" ]; then
    echo "В .env не заданы:$MISSING" >&2
    fail "Прод НЕ тронут, работающая версия продолжает работать."
fi

# Значения, лежавшие в открытом репозитории: бэкенд отвергнет их на старте,
# поэтому отсекаем здесь, пока сервис ещё не остановлен.
if [ "$ADMIN_JWT_SECRET" = "change-me-in-production" ]; then
    fail "ADMIN_JWT_SECRET оставлен значением из репозитория. Прод не тронут."
fi

# Пара виджета обязана совпадать с адресом плейсмента Bitrix, поэтому её
# нельзя сменить односторонне — деплой из-за неё не останавливаем, но
# предупреждаем заметно.
OLD_IFS="$IFS"
IFS=','
for PAIR in $PUBLIC_TOKEN_PAIRS; do
    case "$PAIR" in
        widget1:secretA|widget2:secretB)
            echo "ВНИМАНИЕ: PUBLIC_TOKEN_PAIRS содержит пару '$PAIR' из открытого репозитория." >&2
            echo "          Заведите новую здесь и в адресе плейсмента Bitrix." >&2
            ;;
    esac
done
IFS="$OLD_IFS"

# --- проверка конфигурации --------------------------------------------------
echo "Проверяю конфигурацию compose..."
docker compose -f "$COMPOSE_FILE" config >/dev/null \
    || fail "Конфигурация compose невалидна. Прод не тронут."

# --- сборка до остановки ----------------------------------------------------
echo "Собираю образы (работающий сервис пока не трогаю)..."
docker compose -f "$COMPOSE_FILE" build \
    || fail "Сборка не удалась. Прод не тронут, старая версия работает."

# --- переключение -----------------------------------------------------------
# up -d пересоздаёт только изменившиеся контейнеры; полный down не нужен
# и лишь удлинял окно недоступности.
echo "Переключаю на новую версию..."
if ! docker compose -f "$COMPOSE_FILE" up -d --remove-orphans; then
    echo "Не удалось поднять сервисы. Логи:" >&2
    docker compose -f "$COMPOSE_FILE" logs --tail=100 || true
    exit 1
fi

# --- health check -----------------------------------------------------------
echo "Жду готовности бэкенда..."
OK=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        OK=1
        break
    fi
    sleep "$HEALTH_DELAY"
done

if [ "$OK" != "1" ]; then
    echo "Бэкенд не отвечает на /api/health за $((HEALTH_ATTEMPTS * HEALTH_DELAY)) секунд. Логи:" >&2
    docker compose -f "$COMPOSE_FILE" logs --tail=120 backend || true
    exit 1
fi
echo "Бэкенд отвечает"

docker image prune -f >/dev/null 2>&1 || true

echo "Развёртывание завершено успешно"
docker compose -f "$COMPOSE_FILE" ps || true

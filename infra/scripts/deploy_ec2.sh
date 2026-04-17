#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose is not installed."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "Missing .env file. Copy .env.example to .env and set production values first."
  exit 1
fi

if [[ -f "${ROOT_DIR}/infra/nginx/default-ssl.conf" ]]; then
  if "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh certbot -c "test -f /etc/letsencrypt/live/api-new-nail.kendemo.com/fullchain.pem" >/dev/null 2>&1; then
    cp "${ROOT_DIR}/infra/nginx/default-ssl.conf" "${ROOT_DIR}/infra/nginx/default.conf"
  fi
fi

"${COMPOSE[@]}" up -d --build --remove-orphans
"${COMPOSE[@]}" exec -T api npm run prisma:migrate:deploy
"${COMPOSE[@]}" exec -T nginx nginx -s reload

if [[ "${RUN_SEED:-false}" == "true" ]]; then
  "${COMPOSE[@]}" exec -T api npm run prisma:seed
fi

"${COMPOSE[@]}" ps
echo "Deployment completed successfully."

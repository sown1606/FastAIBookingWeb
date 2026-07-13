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

if [[ "${RUN_SEED:-false}" == "true" ]]; then
  echo "Production deployment refuses RUN_SEED=true. Demo/fake seed data must never be created in production."
  exit 1
fi

"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d postgres
"${COMPOSE[@]}" run --rm --no-deps api npm run prisma:migrate:deploy

"${COMPOSE[@]}" up -d --remove-orphans
"${COMPOSE[@]}" up -d --force-recreate --no-deps nginx
"${COMPOSE[@]}" exec -T nginx nginx -t
"${COMPOSE[@]}" exec -T nginx nginx -s reload

"${COMPOSE[@]}" ps
echo "Deployment completed successfully."

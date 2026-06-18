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

if [[ "${NODE_ENV:-}" != "development" || "${ALLOW_DEMO_SEED:-false}" != "true" ]]; then
  echo "Demo seed is local-only. Set NODE_ENV=development and ALLOW_DEMO_SEED=true explicitly."
  exit 1
fi

"${COMPOSE[@]}" exec -T \
  -e NODE_ENV=development \
  -e ALLOW_DEMO_SEED=true \
  api npm run prisma:seed

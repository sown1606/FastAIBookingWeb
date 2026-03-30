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

"${COMPOSE[@]}" run --rm certbot renew --webroot --webroot-path /var/www/certbot
"${COMPOSE[@]}" restart nginx

echo "SSL renewal completed and Nginx reloaded."

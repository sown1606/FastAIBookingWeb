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

LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
if [[ $# -ge 1 ]]; then
  LETSENCRYPT_EMAIL="$1"
fi

if [[ -z "${LETSENCRYPT_EMAIL}" ]]; then
  echo "Missing Let's Encrypt email. Set LETSENCRYPT_EMAIL env var or pass it as the first argument."
  exit 1
fi

DOMAINS=(
  "api-new-nail.kendemo.com"
  "admin-new-nail.kendemo.com"
  "app-new-nail.kendemo.com"
)

"${COMPOSE[@]}" up -d nginx

DOMAIN_ARGS=()
for domain in "${DOMAINS[@]}"; do
  DOMAIN_ARGS+=("-d" "$domain")
done

"${COMPOSE[@]}" run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "${LETSENCRYPT_EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  "${DOMAIN_ARGS[@]}"

cp "${ROOT_DIR}/infra/nginx/default-ssl.conf" "${ROOT_DIR}/infra/nginx/default.conf"
"${COMPOSE[@]}" restart nginx

echo "SSL certificates issued and Nginx switched to HTTPS config."

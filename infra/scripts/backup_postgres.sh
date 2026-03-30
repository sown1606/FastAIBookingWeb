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

BACKUP_DIR="${ROOT_DIR}/infra/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUTPUT_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"

DATABASE_USER="$(grep '^DATABASE_USER=' .env | cut -d'=' -f2-)"
DATABASE_NAME="$(grep '^DATABASE_NAME=' .env | cut -d'=' -f2-)"

if [[ -z "${DATABASE_USER}" || -z "${DATABASE_NAME}" ]]; then
  echo "DATABASE_USER and DATABASE_NAME must be set in .env."
  exit 1
fi

"${COMPOSE[@]}" exec -T postgres pg_dump \
  -U "${DATABASE_USER}" \
  -d "${DATABASE_NAME}" \
  --no-owner \
  --no-privileges | gzip > "${OUTPUT_FILE}"

echo "Backup created at ${OUTPUT_FILE}"

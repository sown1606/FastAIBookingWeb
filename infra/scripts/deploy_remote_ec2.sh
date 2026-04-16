#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

EC2_HOST="${EC2_HOST:-32.194.150.135}"
EC2_USER="${EC2_USER:-ubuntu}"
EC2_KEY="${EC2_KEY:-${ROOT_DIR}/fastAibooking.pem}"
EC2_APP_DIR="${EC2_APP_DIR:-/home/${EC2_USER}/fastAibooking}"

if [[ ! -f "${EC2_KEY}" ]]; then
  echo "Missing EC2 key at ${EC2_KEY}."
  exit 1
fi

SSH_OPTS=(-i "${EC2_KEY}" -o StrictHostKeyChecking=accept-new)
RSYNC_RSH="ssh -i ${EC2_KEY} -o StrictHostKeyChecking=accept-new"

rsync -az --delete -e "${RSYNC_RSH}" \
  --exclude ".git" \
  --exclude ".idea" \
  --exclude ".env" \
  --exclude "fastAibooking.pem" \
  --exclude "node_modules" \
  --exclude "apps/*/node_modules" \
  --exclude "apps.zip" \
  "${ROOT_DIR}/" "${EC2_USER}@${EC2_HOST}:${EC2_APP_DIR}/"

ssh "${SSH_OPTS[@]}" "${EC2_USER}@${EC2_HOST}" \
  "cd '${EC2_APP_DIR}' && chmod +x infra/scripts/deploy_ec2.sh && ./infra/scripts/deploy_ec2.sh"

#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://api-new-nail.kendemo.com}"
ADMIN_WEB_URL="${ADMIN_WEB_URL:-https://admin-new-nail.kendemo.com}"
APP_WEB_URL="${APP_WEB_URL:-https://app-new-nail.kendemo.com}"

check_url() {
  local url="$1"
  local label="$2"
  local expected_status="$3"
  local actual_status

  actual_status="$(curl -sS -o /dev/null -w "%{http_code}" "$url")"
  if [[ "$actual_status" != "$expected_status" ]]; then
    echo "FAILED [${label}] expected ${expected_status}, got ${actual_status}"
    exit 1
  fi
  echo "OK [${label}] status=${actual_status}"
}

echo "Running read-only production checks. This script never creates test data."
check_url "${ADMIN_WEB_URL}" "admin frontend reachable" "200"
check_url "${APP_WEB_URL}" "app frontend reachable" "200"
check_url "${BASE_URL}/health/liveness" "health liveness" "200"
check_url "${BASE_URL}/health/readiness" "health readiness" "200"
check_url "${BASE_URL}/api/v1/health/liveness" "api health liveness" "200"
check_url "${BASE_URL}/api/v1/health/readiness" "api health readiness" "200"
echo "Read-only production checks completed successfully."

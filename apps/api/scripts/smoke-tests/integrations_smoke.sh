#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"

if [[ "${NODE_ENV:-}" != "development" || "${ALLOW_SMOKE_TEST_DATA:-false}" != "true" ]]; then
  echo "Data-creating integration smoke tests are local-only. Set NODE_ENV=development and ALLOW_SMOKE_TEST_DATA=true."
  exit 1
fi

case "${BASE_URL}" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *)
    echo "Refusing data-creating smoke test against non-local URL: ${BASE_URL}"
    exit 1
    ;;
esac

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@fastaibooking.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin123!}"
OWNER_EMAIL="${OWNER_EMAIL:-owner.demo@fastaibooking.local}"
OWNER_PASSWORD="${OWNER_PASSWORD:-Owner123!}"
AGENT_EMAIL="${AGENT_EMAIL:-agent.demo@fastaibooking.local}"
AGENT_PASSWORD="${AGENT_PASSWORD:-Agent123!}"

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

request() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  local token="${4:-}"

  local headers=(-H "Accept: application/json")
  if [[ -n "$token" ]]; then
    headers+=(-H "Authorization: Bearer ${token}")
  fi
  if [[ -n "$data" ]]; then
    headers+=(-H "Content-Type: application/json")
    curl -sS -X "$method" "${headers[@]}" --data "$data" "$url" -o "$BODY_FILE"
  else
    curl -sS -X "$method" "${headers[@]}" "$url" -o "$BODY_FILE"
  fi
}

json_get() {
  local path="$1"
  node - "$path" "$BODY_FILE" <<'NODE'
const fs = require("fs");
const path = process.argv[2].split(".");
const bodyPath = process.argv[3];
const payload = JSON.parse(fs.readFileSync(bodyPath, "utf8"));

let cursor = payload;
for (const segment of path) {
  if (segment === "") continue;
  if (/^\d+$/.test(segment)) {
    cursor = cursor[Number(segment)];
  } else {
    cursor = cursor[segment];
  }
}

if (typeof cursor === "object") {
  console.log(JSON.stringify(cursor));
} else {
  console.log(String(cursor));
}
NODE
}

login() {
  local path="$1"
  local email="$2"
  local password="$3"
  request POST "${BASE_URL}${path}" "{\"email\":\"${email}\",\"password\":\"${password}\"}"
  json_get "data.accessToken"
}

echo "1) Admin login"
ADMIN_TOKEN="$(login "/api/v1/admin/auth/login" "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
echo "admin_token_received=true"

echo "2) Owner login"
OWNER_TOKEN="$(login "/api/v1/auth/login-owner" "$OWNER_EMAIL" "$OWNER_PASSWORD")"
echo "owner_token_received=true"

echo "3) Operator login"
AGENT_TOKEN="$(login "/api/v1/auth/login-call-center" "$AGENT_EMAIL" "$AGENT_PASSWORD")"
echo "agent_token_received=true"

echo "4) Resolve owner booking context"
request GET "${BASE_URL}/api/v1/customers?page=1&limit=1" "" "$OWNER_TOKEN"
CUSTOMER_ID="$(json_get "data.items.0.id")"
request GET "${BASE_URL}/api/v1/staff?includeInactive=false" "" "$OWNER_TOKEN"
STAFF_ID="$(json_get "data.0.id")"
request GET "${BASE_URL}/api/v1/services" "" "$OWNER_TOKEN"
SERVICE_ID="$(json_get "data.0.id")"

BOOKING_DATE="$(node -e 'const d=new Date(Date.now()+3*24*60*60*1000); while ([0,6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate()+1); console.log(d.toISOString().slice(0,10))')"
request GET "${BASE_URL}/api/v1/availability/slots?staffId=${STAFF_ID}&serviceId=${SERVICE_ID}&date=${BOOKING_DATE}&intervalMinutes=15" "" "$OWNER_TOKEN"
BOOKING_START="$(json_get "data.slots.0.startTime")"
if [[ -z "${BOOKING_START}" ]]; then
  BOOKING_START="$(node -e 'const d=new Date(Date.now()+3*24*60*60*1000); while ([0,6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate()+1); d.setUTCHours(15,0,0,0); console.log(d.toISOString())')"
fi

echo "5) Create a real booking through the owner API"
request POST "${BASE_URL}/api/v1/appointments" "{\"customerId\":\"${CUSTOMER_ID}\",\"staffId\":\"${STAFF_ID}\",\"serviceId\":\"${SERVICE_ID}\",\"startTime\":\"${BOOKING_START}\",\"status\":\"CONFIRMED\",\"source\":\"DASHBOARD\"}" "$OWNER_TOKEN"
OWNER_APPOINTMENT_ID="$(json_get "data.id")"
echo "owner_appointment_id=${OWNER_APPOINTMENT_ID}"

echo "6) Run AI booking from transcript"
AI_TRANSCRIPT_TEXT="$(node -e 'console.log(JSON.stringify("Hi, this is Jamie Foster. My phone number is +1 212 555 0999. I want a Classic Manicure tomorrow at 11:00 AM."))')"
request POST "${BASE_URL}/api/v1/ai/booking-from-transcript" "{\"transcriptText\":${AI_TRANSCRIPT_TEXT},\"transcriptSource\":\"smoke_test\",\"createCustomerIfMissing\":true}" "$OWNER_TOKEN"
AI_BOOKING_ATTEMPT_ID="$(json_get "data.bookingAttempt.id")"
echo "ai_booking_attempt_id=${AI_BOOKING_ATTEMPT_ID}"

echo "7) Load an existing call session for escalation testing"
request GET "${BASE_URL}/api/v1/calls?page=1&limit=2" "" "$OWNER_TOKEN"
CALL_SESSION_ID="$(json_get "data.items.0.id")"
echo "call_session_id=${CALL_SESSION_ID}"

echo "8) Create an escalation from AI Reception"
LIVE_PERSON_TEXT="$(node -e 'console.log(JSON.stringify("I need a real person. Please connect me to a human operator now."))')"
request POST "${BASE_URL}/api/v1/ai/booking-from-text" "{\"text\":${LIVE_PERSON_TEXT},\"callSessionId\":\"${CALL_SESSION_ID}\",\"createCustomerIfMissing\":true}" "$OWNER_TOKEN"
ESCALATION_BOOKING_ATTEMPT_ID="$(json_get "data.bookingAttempt.id")"
echo "escalation_booking_attempt_id=${ESCALATION_BOOKING_ATTEMPT_ID}"

echo "9) Inspect the operator queue"
request GET "${BASE_URL}/api/v1/call-center/queue?limit=20" "" "$AGENT_TOKEN"
QUEUE_ID="$(json_get "data.0.id")"
echo "queue_id=${QUEUE_ID}"

echo "10) Create fallback metadata"
request POST "${BASE_URL}/api/v1/call-center/queue/${QUEUE_ID}/callback-request" "{\"callbackPhone\":\"+12125550999\",\"notes\":\"Customer asked for a callback if no one is available.\"}" "$AGENT_TOKEN"
request POST "${BASE_URL}/api/v1/call-center/queue/${QUEUE_ID}/sms-fallback" "{\"recipientPhone\":\"+12125550999\",\"message\":\"We missed your call. Reply with the best time for a callback.\"}" "$AGENT_TOKEN"

echo "11) Accept and complete the queue item"
request POST "${BASE_URL}/api/v1/call-center/queue/${QUEUE_ID}/accept" "{}" "$AGENT_TOKEN"
request PATCH "${BASE_URL}/api/v1/call-center/queue/${QUEUE_ID}" "{\"operatorNotes\":\"Handled in smoke test.\",\"qaNotes\":\"Verified queue workflow.\",\"resolution\":\"Customer connected to operator and request completed.\"}" "$AGENT_TOKEN"
request POST "${BASE_URL}/api/v1/call-center/queue/${QUEUE_ID}/complete" "{\"resolution\":\"Customer connected to operator and request completed.\",\"operatorNotes\":\"Handled in smoke test.\",\"qaNotes\":\"Verified queue workflow.\"}" "$AGENT_TOKEN"

echo "12) Verify queue detail loads after completion"
request GET "${BASE_URL}/api/v1/call-center/queue/${QUEUE_ID}" "" "$AGENT_TOKEN"
FINAL_QUEUE_STATUS="$(json_get "data.status")"
echo "final_queue_status=${FINAL_QUEUE_STATUS}"

echo "Smoke test completed successfully."

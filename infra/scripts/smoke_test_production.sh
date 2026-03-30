#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://api-new-nail.kendemo.com}"
ADMIN_WEB_URL="${ADMIN_WEB_URL:-https://admin-new-nail.kendemo.com}"
APP_WEB_URL="${APP_WEB_URL:-https://app-new-nail.kendemo.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@fastaibooking.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin123!}"

timestamp="$(date +%s)"
owner_email="owner.${timestamp}@fastaibooking.test"
owner_password="Owner123!Test"
owner_new_password="Owner123!TestNew"
staff_login_password="Staff123!Test"
staff_email="staff.${timestamp}@fastaibooking.test"

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT

http_code=""

json_get() {
  local path="$1"
  python3 - "$path" "$tmp_body" <<'PY'
import json
import sys

path = sys.argv[1].split(".")
body_path = sys.argv[2]
with open(body_path, "r", encoding="utf-8") as handle:
    data = json.load(handle)

cur = data
for part in path:
    if part.isdigit():
        cur = cur[int(part)]
    else:
        cur = cur[part]

if cur is None:
    print("")
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

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
  fi

  if [[ -n "$data" ]]; then
    http_code="$(curl -sS -X "$method" "${headers[@]}" --data "$data" "$url" -o "$tmp_body" -w "%{http_code}")"
  else
    http_code="$(curl -sS -X "$method" "${headers[@]}" "$url" -o "$tmp_body" -w "%{http_code}")"
  fi
}

check_web_url() {
  local url="$1"
  local label="$2"
  local code
  code="$(curl -sS -L -o /dev/null -w "%{http_code}" "$url")"
  if [[ "$code" != "200" ]]; then
    echo "FAILED [$label] expected 200 got ${code}"
    exit 1
  fi
  echo "OK [$label] status=${code}"
}

assert_status() {
  local expected="$1"
  local label="$2"
  if [[ "$http_code" != "$expected" ]]; then
    echo "FAILED [$label] expected ${expected} got ${http_code}"
    cat "$tmp_body"
    exit 1
  fi
  echo "OK [$label] status=${http_code}"
}

get_next_weekday_date() {
  python3 - <<'PY'
from datetime import datetime, timedelta, timezone
now = datetime.now(timezone.utc)
day = now + timedelta(days=1)
while day.weekday() > 4:
    day += timedelta(days=1)
print(day.strftime("%Y-%m-%d"))
PY
}

get_start_iso_for_date() {
  local date="$1"
  python3 - "$date" <<'PY'
from datetime import datetime, timezone
import sys
date = sys.argv[1]
dt = datetime.fromisoformat(date).replace(hour=15, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
print(dt.isoformat().replace("+00:00", "Z"))
PY
}

echo "Running smoke tests against ${BASE_URL}"

check_web_url "${ADMIN_WEB_URL}" "admin frontend reachable"
check_web_url "${APP_WEB_URL}" "app frontend reachable"

request GET "${BASE_URL}/health/liveness"
assert_status "200" "health liveness"

request GET "${BASE_URL}/health/readiness"
assert_status "200" "health readiness"

request GET "${BASE_URL}/api/v1/staff"
if [[ "$http_code" != "401" && "$http_code" != "403" ]]; then
  echo "FAILED [unauth protected route] expected 401/403 got ${http_code}"
  cat "$tmp_body"
  exit 1
fi
echo "OK [unauth protected route] status=${http_code}"

register_payload="$(cat <<JSON
{
  "fullName":"Smoke Owner",
  "email":"${owner_email}",
  "password":"${owner_password}",
    "phone":"+12125550101",
  "salon":{
    "name":"Smoke Test Salon ${timestamp}",
    "contactEmail":"${owner_email}",
    "contactPhone":"+12125550101",
    "timezone":"America/New_York",
    "city":"New York",
    "state":"NY",
    "postalCode":"10001",
    "country":"US"
  }
}
JSON
)"
request POST "${BASE_URL}/api/v1/auth/register-owner" "$register_payload"
assert_status "201" "auth register owner"

owner_access_token="$(json_get "data.accessToken")"
owner_refresh_token="$(json_get "data.refreshToken")"
salon_id="$(json_get "data.salon.id")"

login_payload="{\"email\":\"${owner_email}\",\"password\":\"${owner_password}\"}"
request POST "${BASE_URL}/api/v1/auth/login-owner" "$login_payload"
assert_status "200" "auth login owner"
owner_access_token="$(json_get "data.accessToken")"
owner_refresh_token="$(json_get "data.refreshToken")"

request GET "${BASE_URL}/api/v1/auth/me" "" "$owner_access_token"
assert_status "200" "auth me"

request POST "${BASE_URL}/api/v1/auth/forgot-password" "{\"email\":\"${owner_email}\"}"
assert_status "200" "auth forgot password"

request POST "${BASE_URL}/api/v1/auth/reset-password" "{\"token\":\"invalid-token\",\"newPassword\":\"${owner_new_password}\"}"
assert_status "400" "auth reset password invalid token"

request GET "${BASE_URL}/api/v1/salon/profile" "" "$owner_access_token"
assert_status "200" "salon profile get"

request PUT "${BASE_URL}/api/v1/salon/profile" "{\"name\":\"Smoke Test Salon Updated ${timestamp}\"}" "$owner_access_token"
assert_status "200" "salon profile update"

request GET "${BASE_URL}/api/v1/salon/settings" "" "$owner_access_token"
assert_status "200" "salon settings get"

request PUT "${BASE_URL}/api/v1/salon/settings" "{\"bookingLeadTimeMinutes\":15}" "$owner_access_token"
assert_status "200" "salon settings update"

request POST "${BASE_URL}/api/v1/staff" "{\"fullName\":\"Smoke Staff\",\"email\":\"${staff_email}\",\"phone\":\"+12125550111\",\"title\":\"Technician\",\"createLogin\":true,\"password\":\"${staff_login_password}\"}" "$owner_access_token"
assert_status "201" "staff create"
staff_id="$(json_get "data.staff.id")"

request GET "${BASE_URL}/api/v1/staff?includeInactive=true" "" "$owner_access_token"
assert_status "200" "staff list"

request PATCH "${BASE_URL}/api/v1/staff/${staff_id}" "{\"title\":\"Senior Technician\"}" "$owner_access_token"
assert_status "200" "staff update"

request POST "${BASE_URL}/api/v1/staff/${staff_id}/deactivate" "{}" "$owner_access_token"
assert_status "200" "staff deactivate"

request POST "${BASE_URL}/api/v1/staff/${staff_id}/reactivate" "{}" "$owner_access_token"
assert_status "200" "staff reactivate"

request GET "${BASE_URL}/api/v1/billing/usage" "" "$owner_access_token"
assert_status "200" "billing usage"

request POST "${BASE_URL}/api/v1/services" "{\"name\":\"Smoke Service\",\"durationMinutes\":45,\"priceCents\":4500,\"staffIds\":[\"${staff_id}\"]}" "$owner_access_token"
assert_status "201" "service create"
service_id="$(json_get "data.id")"

request GET "${BASE_URL}/api/v1/services" "" "$owner_access_token"
assert_status "200" "service list"

request PATCH "${BASE_URL}/api/v1/services/${service_id}" "{\"priceCents\":4700}" "$owner_access_token"
assert_status "200" "service update"

request POST "${BASE_URL}/api/v1/services/${service_id}/deactivate" "{}" "$owner_access_token"
assert_status "200" "service deactivate"

request POST "${BASE_URL}/api/v1/services/${service_id}/activate" "{}" "$owner_access_token"
assert_status "200" "service activate"

request GET "${BASE_URL}/api/v1/business-hours" "" "$owner_access_token"
assert_status "200" "business hours get"

request PUT "${BASE_URL}/api/v1/business-hours" '{"hours":[{"dayOfWeek":0,"isOpen":false},{"dayOfWeek":1,"isOpen":true,"openTime":"09:00","closeTime":"18:00"},{"dayOfWeek":2,"isOpen":true,"openTime":"09:00","closeTime":"18:00"},{"dayOfWeek":3,"isOpen":true,"openTime":"09:00","closeTime":"18:00"},{"dayOfWeek":4,"isOpen":true,"openTime":"09:00","closeTime":"18:00"},{"dayOfWeek":5,"isOpen":true,"openTime":"09:00","closeTime":"18:00"},{"dayOfWeek":6,"isOpen":true,"openTime":"09:00","closeTime":"16:00"}]}' "$owner_access_token"
assert_status "200" "business hours update"

request POST "${BASE_URL}/api/v1/customers" "{\"firstName\":\"Smoke\",\"lastName\":\"Customer\",\"email\":\"customer.${timestamp}@fastaibooking.test\",\"phone\":\"+12125550121\"}" "$owner_access_token"
assert_status "201" "customer create"
customer_id="$(json_get "data.id")"

request GET "${BASE_URL}/api/v1/customers?q=Smoke" "" "$owner_access_token"
assert_status "200" "customer list"

request GET "${BASE_URL}/api/v1/customers/${customer_id}" "" "$owner_access_token"
assert_status "200" "customer detail"

request GET "${BASE_URL}/api/v1/customers/${customer_id}/appointments" "" "$owner_access_token"
assert_status "200" "customer appointment history"

slot_date="$(get_next_weekday_date)"
request GET "${BASE_URL}/api/v1/availability/slots?staffId=${staff_id}&serviceId=${service_id}&date=${slot_date}&intervalMinutes=15" "" "$owner_access_token"
assert_status "200" "availability slots"
slot_start="$(json_get "data.slots.0.startTime")"

if [[ -z "${slot_start}" ]]; then
  slot_start="$(get_start_iso_for_date "$slot_date")"
fi

request POST "${BASE_URL}/api/v1/availability/validate" "{\"staffId\":\"${staff_id}\",\"serviceId\":\"${service_id}\",\"startTime\":\"${slot_start}\"}" "$owner_access_token"
assert_status "200" "availability validate"

request POST "${BASE_URL}/api/v1/appointments" "{\"customerId\":\"${customer_id}\",\"staffId\":\"${staff_id}\",\"serviceId\":\"${service_id}\",\"startTime\":\"${slot_start}\",\"source\":\"DASHBOARD\"}" "$owner_access_token"
assert_status "201" "appointment create"
appointment_id="$(json_get "data.id")"

request GET "${BASE_URL}/api/v1/appointments" "" "$owner_access_token"
assert_status "200" "appointment list"

request GET "${BASE_URL}/api/v1/appointments/${appointment_id}" "" "$owner_access_token"
assert_status "200" "appointment detail"

request PATCH "${BASE_URL}/api/v1/appointments/${appointment_id}" "{\"notes\":\"Updated by smoke test\"}" "$owner_access_token"
assert_status "200" "appointment update"

request PATCH "${BASE_URL}/api/v1/appointments/${appointment_id}/reschedule" "{\"startTime\":\"${slot_start}\"}" "$owner_access_token"
assert_status "200" "appointment reschedule"

request PATCH "${BASE_URL}/api/v1/appointments/${appointment_id}/cancel" "{\"reason\":\"Smoke test cancel\"}" "$owner_access_token"
assert_status "200" "appointment cancel"

request POST "${BASE_URL}/api/v1/appointments/from-ai" "{\"customerId\":\"${customer_id}\",\"staffId\":\"${staff_id}\",\"serviceId\":\"${service_id}\",\"startTime\":\"${slot_start}\",\"notes\":\"AI flow test\"}" "$owner_access_token"
if [[ "$http_code" != "201" && "$http_code" != "400" ]]; then
  echo "FAILED [appointment create from ai] expected 201 or 400 got ${http_code}"
  cat "$tmp_body"
  exit 1
fi
echo "OK [appointment create from ai] status=${http_code}"

callrail_payload="$(cat <<JSON
{
  "event_type":"call.completed",
  "event_id":"evt-${timestamp}",
  "call_id":"call-${timestamp}",
  "salon_id":"${salon_id}",
  "status":"completed",
  "customer_phone_number":"+12125550131",
  "tracking_phone_number":"+12125550141",
  "source_name":"Smoke Test Campaign",
  "start_time":"${slot_start}",
  "duration_seconds":300,
  "transcript":"My name is Smoke Caller and my phone is +12125550131. Please book Smoke Service with Smoke Staff on ${slot_start}."
}
JSON
)"

request POST "${BASE_URL}/api/v1/integrations/callrail/webhook" "$callrail_payload"
assert_status "202" "callrail webhook ingest"

request POST "${BASE_URL}/api/v1/integrations/callrail/webhook" "$callrail_payload"
assert_status "202" "callrail webhook idempotent ingest"

request GET "${BASE_URL}/api/v1/calls" "" "$owner_access_token"
assert_status "200" "calls list"
call_session_id="$(json_get "data.items.0.id")"

request GET "${BASE_URL}/api/v1/calls/${call_session_id}" "" "$owner_access_token"
assert_status "200" "call detail"

request GET "${BASE_URL}/api/v1/calls/${call_session_id}/events" "" "$owner_access_token"
assert_status "200" "call events list"

request GET "${BASE_URL}/api/v1/calls/${call_session_id}/transcripts" "" "$owner_access_token"
assert_status "200" "call transcripts list"

request GET "${BASE_URL}/api/v1/calls/${call_session_id}/booking-attempts" "" "$owner_access_token"
assert_status "200" "call booking attempts list"

request GET "${BASE_URL}/api/v1/availability/slots?staffId=${staff_id}&serviceId=${service_id}&date=${slot_date}&intervalMinutes=15" "" "$owner_access_token"
assert_status "200" "availability slots for ai booking"
ai_slot_start="$(json_get "data.slots.0.startTime")"
if [[ -z "${ai_slot_start}" ]]; then
  ai_slot_start="${slot_start}"
fi

request POST "${BASE_URL}/api/v1/ai/parse-booking" "{\"text\":\"My name is Smoke Caller and my phone is +12125550131. Book Smoke Service with Smoke Staff on ${ai_slot_start}.\",\"callSessionId\":\"${call_session_id}\"}" "$owner_access_token"
assert_status "200" "ai parse booking"
ai_interaction_id="$(json_get "data.interactionId")"

request GET "${BASE_URL}/api/v1/ai/interactions/${ai_interaction_id}" "" "$owner_access_token"
assert_status "200" "ai interaction detail"

request POST "${BASE_URL}/api/v1/ai/suggest-slots" "{\"serviceName\":\"Smoke Service\",\"staffName\":\"Smoke Staff\",\"preferredStartTime\":\"${ai_slot_start}\",\"daysAhead\":7,\"maxSlots\":5}" "$owner_access_token"
assert_status "200" "ai suggest slots"

request POST "${BASE_URL}/api/v1/ai/booking-from-text" "{\"text\":\"My name is Smoke Caller and my phone is +12125550131. Book Smoke Service with Smoke Staff on ${ai_slot_start}.\",\"callSessionId\":\"${call_session_id}\",\"createCustomerIfMissing\":true}" "$owner_access_token"
assert_status "200" "ai booking from text"
ai_booking_status="$(json_get "data.bookingAttempt.status")"
if [[ "${ai_booking_status}" != "SUCCESS" ]]; then
  echo "FAILED [ai booking from text success] expected SUCCESS got ${ai_booking_status}"
  cat "$tmp_body"
  exit 1
fi
echo "OK [ai booking from text success] status=${ai_booking_status}"

request POST "${BASE_URL}/api/v1/ai/booking-from-transcript" "{\"transcriptText\":\"My name is Smoke Caller and my phone is +12125550131. Book Smoke Service with Smoke Staff on ${ai_slot_start}.\",\"callSessionId\":\"${call_session_id}\",\"transcriptSource\":\"smoke_test\",\"createCustomerIfMissing\":true}" "$owner_access_token"
assert_status "200" "ai booking from transcript"

request GET "${BASE_URL}/api/v1/availability/slots?staffId=${staff_id}&serviceId=${service_id}&date=${slot_date}&intervalMinutes=15" "" "$owner_access_token"
assert_status "200" "availability slots for staff smoke appointment"
staff_slot_start="$(json_get "data.slots.0.startTime")"
if [[ -z "${staff_slot_start}" ]]; then
  staff_slot_start="${slot_start}"
fi

request POST "${BASE_URL}/api/v1/appointments" "{\"customerId\":\"${customer_id}\",\"staffId\":\"${staff_id}\",\"serviceId\":\"${service_id}\",\"startTime\":\"${staff_slot_start}\",\"source\":\"DASHBOARD\"}" "$owner_access_token"
assert_status "201" "appointment create for staff flow"
staff_appointment_id="$(json_get "data.id")"

request POST "${BASE_URL}/api/v1/auth/change-password" "{\"currentPassword\":\"${owner_password}\",\"newPassword\":\"${owner_new_password}\"}" "$owner_access_token"
assert_status "200" "auth change password"

request POST "${BASE_URL}/api/v1/auth/login-owner" "{\"email\":\"${owner_email}\",\"password\":\"${owner_new_password}\"}"
assert_status "200" "auth login with changed password"

request POST "${BASE_URL}/api/v1/auth/logout" "{\"refreshToken\":\"${owner_refresh_token}\"}"
assert_status "200" "auth logout"

request POST "${BASE_URL}/api/v1/auth/login-staff" "{\"email\":\"${staff_email}\",\"password\":\"${staff_login_password}\"}"
assert_status "200" "staff login"
staff_access_token="$(json_get "data.accessToken")"
staff_refresh_token="$(json_get "data.refreshToken")"

request GET "${BASE_URL}/api/v1/auth/me" "" "$staff_access_token"
assert_status "200" "staff auth me"

request GET "${BASE_URL}/api/v1/appointments" "" "$staff_access_token"
assert_status "200" "staff appointments list"

request GET "${BASE_URL}/api/v1/appointments/${staff_appointment_id}" "" "$staff_access_token"
assert_status "200" "staff appointment detail"

request PATCH "${BASE_URL}/api/v1/appointments/${staff_appointment_id}" "{\"status\":\"CONFIRMED\"}" "$staff_access_token"
assert_status "200" "staff update appointment status"

request GET "${BASE_URL}/api/v1/billing/usage" "" "$staff_access_token"
assert_status "403" "staff billing forbidden"

request GET "${BASE_URL}/api/v1/salon/profile" "" "$staff_access_token"
assert_status "403" "staff salon management forbidden"

request GET "${BASE_URL}/api/v1/customers" "" "$staff_access_token"
assert_status "403" "staff customer management forbidden"

request POST "${BASE_URL}/api/v1/appointments" "{\"customerId\":\"${customer_id}\",\"staffId\":\"${staff_id}\",\"serviceId\":\"${service_id}\",\"startTime\":\"${staff_slot_start}\",\"source\":\"DASHBOARD\"}" "$staff_access_token"
assert_status "403" "staff create appointment forbidden"

request POST "${BASE_URL}/api/v1/auth/logout" "{\"refreshToken\":\"${staff_refresh_token}\"}"
assert_status "200" "staff logout"

request POST "${BASE_URL}/api/v1/admin/auth/login" "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}"
assert_status "200" "admin login"
admin_token="$(json_get "data.accessToken")"

request GET "${BASE_URL}/api/v1/admin/salons" "" "$admin_token"
assert_status "200" "admin salons list"

if [[ -n "${salon_id}" ]]; then
  request GET "${BASE_URL}/api/v1/admin/salons/${salon_id}" "" "$admin_token"
  assert_status "200" "admin salon detail"
fi

request GET "${BASE_URL}/api/v1/admin/metrics/overview" "" "$admin_token"
assert_status "200" "admin overview metrics"

request GET "${BASE_URL}/api/v1/admin/calls" "" "$admin_token"
assert_status "200" "admin calls list"

request GET "${BASE_URL}/api/v1/admin/ai-logs" "" "$admin_token"
assert_status "200" "admin ai logs list"

if [[ -n "${call_session_id}" ]]; then
  request GET "${BASE_URL}/api/v1/admin/calls/${call_session_id}" "" "$admin_token"
  assert_status "200" "admin call detail"
fi

if [[ -n "${ai_interaction_id}" ]]; then
  request GET "${BASE_URL}/api/v1/admin/ai-logs/${ai_interaction_id}" "" "$admin_token"
  assert_status "200" "admin ai log detail"
fi

echo "All smoke tests completed successfully."

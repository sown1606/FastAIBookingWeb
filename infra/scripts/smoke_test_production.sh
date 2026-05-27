#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://api-new-nail.kendemo.com}"
ADMIN_WEB_URL="${ADMIN_WEB_URL:-https://admin-new-nail.kendemo.com}"
APP_WEB_URL="${APP_WEB_URL:-https://app-new-nail.kendemo.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@fastaibooking.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin123!}"
CALL_PROVIDER="${CALL_PROVIDER:-amazon_connect}"
INTERNAL_API_TOKEN="${FASTAIBOOKING_API_INTERNAL_TOKEN:-}"
AWS_PROFILE="${AWS_PROFILE:-nailnew}"
AWS_REGION="${AWS_REGION:-us-east-1}"

timestamp="$(date +%s)"
owner_email="owner.${timestamp}@fastaibooking.test"
owner_password="Owner123!Test"
owner_new_password="Owner123!TestNew"
staff_login_password="Staff123!Test"
staff_email="staff.${timestamp}@fastaibooking.test"
call_center_email="agent.${timestamp}@fastaibooking.test"
call_center_password="Agent123!Test"

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
    try:
        if part.isdigit():
            index = int(part)
            if not isinstance(cur, list) or index >= len(cur):
                print("")
                sys.exit(0)
            cur = cur[index]
        else:
            if not isinstance(cur, dict) or part not in cur:
                print("")
                sys.exit(0)
            cur = cur[part]
    except (IndexError, KeyError, TypeError):
        print("")
        sys.exit(0)

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

assert_json_value() {
  local path="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual="$(json_get "$path")"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAILED [$label] expected ${expected} got ${actual}"
    cat "$tmp_body"
    exit 1
  fi
  echo "OK [$label] ${path}=${actual}"
}

aws_available() {
  command -v aws >/dev/null 2>&1 && \
    aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" >/dev/null 2>&1
}

aws_json_value() {
  local json="$1"
  local path="$2"
  python3 - "$json" "$path" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
cur = data
for part in sys.argv[2].split("."):
    if not part:
        continue
    if isinstance(cur, dict):
        cur = cur.get(part)
    else:
        cur = None
    if cur is None:
        break
print("" if cur is None else cur)
PY
}

assert_aws_value() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAILED [$label] expected ${expected} got ${actual}"
    exit 1
  fi
  echo "OK [$label] ${actual}"
}

verify_aws_resources() {
  if ! aws_available; then
    echo "SKIP [aws resource verification] AWS CLI/profile ${AWS_PROFILE} is not available."
    return
  fi

  echo "Running AWS resource verification with profile ${AWS_PROFILE} in ${AWS_REGION}"

  if [[ -n "${AMAZON_CONNECT_INSTANCE_ID:-}" ]]; then
    local instance_json instance_status
    instance_json="$(aws connect describe-instance --profile "$AWS_PROFILE" --region "$AWS_REGION" --instance-id "$AMAZON_CONNECT_INSTANCE_ID")"
    instance_status="$(aws_json_value "$instance_json" "Instance.InstanceStatus")"
    assert_aws_value "$instance_status" "ACTIVE" "connect instance active"
  else
    echo "SKIP [connect instance active] AMAZON_CONNECT_INSTANCE_ID is missing."
  fi

  if [[ -n "${AMAZON_CONNECT_INSTANCE_ID:-}" && -n "${AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION:-}" ]]; then
    local ai_flow_json ai_flow_status ai_flow_state
    ai_flow_json="$(aws connect describe-contact-flow --profile "$AWS_PROFILE" --region "$AWS_REGION" --instance-id "$AMAZON_CONNECT_INSTANCE_ID" --contact-flow-id "$AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION")"
    ai_flow_status="$(aws_json_value "$ai_flow_json" "ContactFlow.Status")"
    ai_flow_state="$(aws_json_value "$ai_flow_json" "ContactFlow.State")"
    assert_aws_value "$ai_flow_status" "PUBLISHED" "ai reception contact flow published"
    assert_aws_value "$ai_flow_state" "ACTIVE" "ai reception contact flow active"
  else
    echo "SKIP [ai reception contact flow] AMAZON_CONNECT_INSTANCE_ID or AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION is missing."
  fi

  if [[ -n "${AMAZON_CONNECT_INSTANCE_ID:-}" && -n "${AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION:-}" ]]; then
    local human_flow_json human_flow_status human_flow_state
    human_flow_json="$(aws connect describe-contact-flow --profile "$AWS_PROFILE" --region "$AWS_REGION" --instance-id "$AMAZON_CONNECT_INSTANCE_ID" --contact-flow-id "$AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION")"
    human_flow_status="$(aws_json_value "$human_flow_json" "ContactFlow.Status")"
    human_flow_state="$(aws_json_value "$human_flow_json" "ContactFlow.State")"
    assert_aws_value "$human_flow_status" "PUBLISHED" "human escalation contact flow published"
    assert_aws_value "$human_flow_state" "ACTIVE" "human escalation contact flow active"
  else
    echo "SKIP [human escalation contact flow] AMAZON_CONNECT_INSTANCE_ID or AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION is missing."
  fi

  if [[ -n "${AMAZON_CONNECT_INSTANCE_ID:-}" && -n "${AMAZON_CONNECT_QUEUE_ID_DEFAULT:-}" ]]; then
    local queue_json queue_status
    queue_json="$(aws connect describe-queue --profile "$AWS_PROFILE" --region "$AWS_REGION" --instance-id "$AMAZON_CONNECT_INSTANCE_ID" --queue-id "$AMAZON_CONNECT_QUEUE_ID_DEFAULT")"
    queue_status="$(aws_json_value "$queue_json" "Queue.Status")"
    assert_aws_value "$queue_status" "ENABLED" "operator queue enabled"
  else
    echo "SKIP [operator queue enabled] AMAZON_CONNECT_INSTANCE_ID or AMAZON_CONNECT_QUEUE_ID_DEFAULT is missing."
  fi

  if [[ -n "${AMAZON_LEX_BOT_ID:-${LEX_BOT_ID:-}}" && -n "${AMAZON_LEX_BOT_ALIAS_ID:-${LEX_BOT_ALIAS_ID:-}}" ]]; then
    local bot_id alias_id lex_json lex_status
    bot_id="${AMAZON_LEX_BOT_ID:-$LEX_BOT_ID}"
    alias_id="${AMAZON_LEX_BOT_ALIAS_ID:-$LEX_BOT_ALIAS_ID}"
    lex_json="$(aws lexv2-models describe-bot-alias --profile "$AWS_PROFILE" --region "$AWS_REGION" --bot-id "$bot_id" --bot-alias-id "$alias_id")"
    lex_status="$(aws_json_value "$lex_json" "botAliasStatus")"
    assert_aws_value "$lex_status" "Available" "lex prod alias available"
  else
    echo "SKIP [lex prod alias available] AMAZON_LEX_BOT_ID/LEX_BOT_ID or AMAZON_LEX_BOT_ALIAS_ID/LEX_BOT_ALIAS_ID is missing."
  fi

  if [[ -n "${BOOKING_LAMBDA_FUNCTION_NAME:-${LAMBDA_BOOKING_HANDLER_NAME:-}}" ]]; then
    local lambda_name lambda_json lambda_runtime lambda_env_keys
    lambda_name="${BOOKING_LAMBDA_FUNCTION_NAME:-$LAMBDA_BOOKING_HANDLER_NAME}"
    lambda_json="$(aws lambda get-function-configuration --profile "$AWS_PROFILE" --region "$AWS_REGION" --function-name "$lambda_name")"
    lambda_runtime="$(aws_json_value "$lambda_json" "Runtime")"
    assert_aws_value "$lambda_runtime" "nodejs20.x" "lambda runtime"
    lambda_env_keys="$(python3 - "$lambda_json" <<'PY'
import json
import sys
data = json.loads(sys.argv[1])
keys = sorted((data.get("Environment") or {}).get("Variables", {}).keys())
print(",".join(keys))
PY
)"
    for required_key in FASTAIBOOKING_API_BASE_URL FASTAIBOOKING_API_INTERNAL_TOKEN DEFAULT_SALON_ID; do
      if [[ ",${lambda_env_keys}," != *",${required_key},"* ]]; then
        echo "FAILED [lambda env var names] missing ${required_key}"
        exit 1
      fi
    done
    echo "OK [lambda env var names] FASTAIBOOKING_API_BASE_URL, FASTAIBOOKING_API_INTERNAL_TOKEN, DEFAULT_SALON_ID"
  else
    echo "SKIP [lambda runtime/env] BOOKING_LAMBDA_FUNCTION_NAME or LAMBDA_BOOKING_HANDLER_NAME is missing."
  fi
}

invoke_lambda_human_escalation_sample() {
  if ! aws_available; then
    echo "SKIP [lambda invoke sample] AWS CLI/profile ${AWS_PROFILE} is not available."
    return
  fi
  local lambda_name="${BOOKING_LAMBDA_FUNCTION_NAME:-${LAMBDA_BOOKING_HANDLER_NAME:-}}"
  if [[ -z "$lambda_name" ]]; then
    echo "SKIP [lambda invoke sample] BOOKING_LAMBDA_FUNCTION_NAME or LAMBDA_BOOKING_HANDLER_NAME is missing."
    return
  fi

  local event_file output_file
  event_file="$(mktemp)"
  output_file="$(mktemp)"
  cat > "$event_file" <<JSON
{
  "invocationSource": "FulfillmentCodeHook",
  "inputTranscript": "I want to speak to a real person.",
  "sessionId": "smoke-lambda-${timestamp}",
  "sessionState": {
    "sessionAttributes": {
      "salonId": "${salon_id}",
      "AmazonConnectContactId": "smoke-lambda-${timestamp}",
      "CalledNumber": "${AMAZON_CONNECT_PHONE_NUMBER:-+18483487681}",
      "CustomerEndpointAddress": "+12125550132"
    },
    "intent": {
      "name": "HumanEscalationIntent",
      "state": "ReadyForFulfillment",
      "slots": {}
    }
  }
}
JSON

  aws lambda invoke --profile "$AWS_PROFILE" --region "$AWS_REGION" --function-name "$lambda_name" --payload "fileb://${event_file}" "$output_file" >/dev/null
  local message
  message="$(python3 - "$output_file" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
print(((data.get("messages") or [{}])[0]).get("content", ""))
PY
)"
  rm -f "$event_file" "$output_file"
  assert_aws_value "$message" "Please wait while I connect you." "lambda invoke human escalation message"
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

request GET "${BASE_URL}/api/v1/health/liveness"
assert_status "200" "api health liveness"

request GET "${BASE_URL}/api/v1/health/readiness"
assert_status "200" "api health readiness"

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

request POST "${BASE_URL}/api/v1/admin/auth/login" "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}"
assert_status "200" "admin login"
admin_token="$(json_get "data.accessToken")"

request GET "${BASE_URL}/api/v1/admin/salons" "" "$admin_token"
assert_status "200" "admin salons list"

if [[ -n "${salon_id}" ]]; then
  request GET "${BASE_URL}/api/v1/admin/salons/${salon_id}" "" "$admin_token"
  assert_status "200" "admin salon detail"
fi

request POST "${BASE_URL}/api/v1/admin/call-center/agents" "{\"fullName\":\"Smoke Agent\",\"email\":\"${call_center_email}\",\"phone\":\"+12125550151\",\"password\":\"${call_center_password}\"}" "$admin_token"
assert_status "201" "admin call center agent create"
call_center_agent_id="$(json_get "data.user.id")"
if [[ -z "${call_center_agent_id}" ]]; then
  call_center_agent_id="$(json_get "data.id")"
fi

request PUT "${BASE_URL}/api/v1/admin/salons/${salon_id}/call-center-assignments" "{\"agentUserIds\":[\"${call_center_agent_id}\"]}" "$admin_token"
assert_status "200" "admin call center assignment update"

request PUT "${BASE_URL}/api/v1/admin/salons/${salon_id}/settings" '{"callCenterEnabled":true,"callbackRequestEnabled":true,"voicemailEnabled":true,"smsFallbackEnabled":false,"callLogVisibility":"OWNER_STAFF_OPERATOR"}' "$admin_token"
assert_status "200" "admin call center settings update"

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

request GET "${BASE_URL}/api/v1/availability/slots?staffId=${staff_id}&serviceId=${service_id}&date=${slot_date}&intervalMinutes=15" "" "$owner_access_token"
assert_status "200" "availability slots for amazon connect internal booking"
ai_internal_slot_start="$(json_get "data.slots.0.startTime")"
if [[ -z "${ai_internal_slot_start}" ]]; then
  ai_internal_slot_start="${slot_start}"
fi

if [[ -z "${INTERNAL_API_TOKEN}" ]]; then
  echo "FAILED [ai internal appointment endpoint] FASTAIBOOKING_API_INTERNAL_TOKEN is required."
  exit 1
fi

ai_internal_payload="$(cat <<JSON
{
  "salonId":"${salon_id}",
  "customerName":"Smoke AI Caller",
  "customerPhone":"+12125550131",
  "serviceName":"Smoke Service",
  "requestedDate":"${ai_internal_slot_start}",
  "staffPreference":"Smoke Staff",
  "source":"amazon_connect_smoke_test",
  "amazonConnectContactId":"smoke-contact-${timestamp}",
  "amazonConnectPhoneNumber":"+12125550141",
  "calledNumber":"+12125550141"
}
JSON
)"

request POST "${BASE_URL}/api/v1/internal/ai/appointments" "$ai_internal_payload" "$INTERNAL_API_TOKEN"
assert_status "201" "ai internal amazon connect appointment"
ai_internal_outcome="$(json_get "data.outcome")"
if [[ "${ai_internal_outcome}" != "BOOKED" ]]; then
  echo "FAILED [ai internal outcome] expected BOOKED got ${ai_internal_outcome}"
  cat "$tmp_body"
  exit 1
fi
call_session_id="$(json_get "data.callSessionId")"
ai_internal_interaction_id="$(json_get "data.aiInteractionId")"

if [[ -z "${call_session_id}" ]]; then
  echo "FAILED [ai internal call session] expected callSessionId"
  cat "$tmp_body"
  exit 1
fi
echo "OK [ai internal call session] id=${call_session_id}"
if [[ -z "${ai_internal_interaction_id}" ]]; then
  echo "FAILED [ai internal interaction] expected aiInteractionId"
  cat "$tmp_body"
  exit 1
fi
echo "OK [ai internal interaction] id=${ai_internal_interaction_id}"

ai_escalation_payload="$(cat <<JSON
{
  "salonId":"${salon_id}",
  "intentName":"HumanEscalationIntent",
  "customerName":"Smoke Escalation Caller",
  "customerPhone":"+12125550132",
  "transcript":"I want to speak to a real person.",
  "source":"amazon_connect_smoke_test",
  "amazonConnectContactId":"smoke-escalation-${timestamp}",
  "amazonConnectPhoneNumber":"+12125550141",
  "calledNumber":"+12125550141"
}
JSON
)"

request POST "${BASE_URL}/api/v1/internal/ai/appointments" "$ai_escalation_payload" "$INTERNAL_API_TOKEN"
assert_status "200" "ai internal human escalation"
assert_json_value "data.outcome" "HUMAN_ESCALATION" "ai internal human escalation outcome"
assert_json_value "data.lexResponse.message" "Please wait while I connect you." "ai internal human escalation message"
assert_json_value "data.lexResponse.sessionAttributes.transferToQueue" "true" "ai internal human escalation queue transfer"

if [[ "${CALL_PROVIDER}" == "callrail" ]]; then
  callrail_payload="$(cat <<JSON
{
  "event_type":"call.completed",
  "event_id":"evt-${timestamp}",
  "call_id":"callrail-${timestamp}",
  "salon_id":"${salon_id}",
  "status":"completed",
  "customer_phone_number":"+12125550139",
  "tracking_phone_number":"+12125550149",
  "source_name":"Smoke Test Campaign",
  "start_time":"${ai_internal_slot_start}",
  "duration_seconds":300,
  "transcript":"My name is Smoke Attribution Caller and my phone is +12125550139."
}
JSON
)"

  request POST "${BASE_URL}/api/v1/integrations/callrail/webhook" "$callrail_payload"
  assert_status "202" "optional callrail webhook ingest"

  request POST "${BASE_URL}/api/v1/integrations/callrail/webhook" "$callrail_payload"
  assert_status "202" "optional callrail webhook idempotent ingest"
else
  echo "SKIP [optional callrail webhook] CALL_PROVIDER=${CALL_PROVIDER}"
fi

request GET "${BASE_URL}/api/v1/calls" "" "$owner_access_token"
assert_status "200" "calls list"

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

request GET "${BASE_URL}/api/v1/call-center/runtime" "" "$owner_access_token"
assert_status "200" "owner call center runtime"

request GET "${BASE_URL}/api/v1/call-center/queue" "" "$owner_access_token"
assert_status "200" "owner call center queue"

request POST "${BASE_URL}/api/v1/ai/booking-from-text" "{\"text\":\"This is Smoke Escalation and my phone is +12125550132. I need a real person to help with my appointment.\",\"callSessionId\":\"${call_session_id}\",\"createCustomerIfMissing\":true}" "$owner_access_token"
assert_status "200" "ai human escalation from text"
escalation_id="$(json_get "data.escalation.id")"
if [[ -z "${escalation_id}" ]]; then
  echo "FAILED [ai human escalation id] expected escalation id"
  cat "$tmp_body"
  exit 1
fi
echo "OK [ai human escalation id] id=${escalation_id}"

request POST "${BASE_URL}/api/v1/auth/login-call-center" "{\"email\":\"${call_center_email}\",\"password\":\"${call_center_password}\"}"
assert_status "200" "call center login"
call_center_access_token="$(json_get "data.accessToken")"
call_center_refresh_token="$(json_get "data.refreshToken")"

request GET "${BASE_URL}/api/v1/auth/me" "" "$call_center_access_token"
assert_status "200" "call center auth me"

request GET "${BASE_URL}/api/v1/call-center/runtime" "" "$call_center_access_token"
assert_status "200" "operator call center runtime"

request GET "${BASE_URL}/api/v1/call-center/salons" "" "$call_center_access_token"
assert_status "200" "operator assigned salons"

request GET "${BASE_URL}/api/v1/call-center/salons/${salon_id}" "" "$call_center_access_token"
assert_status "200" "operator assigned salon detail"

request GET "${BASE_URL}/api/v1/call-center/salons/${salon_id}/staff" "" "$call_center_access_token"
assert_status "200" "operator assigned salon staff"

request GET "${BASE_URL}/api/v1/call-center/salons/${salon_id}/services" "" "$call_center_access_token"
assert_status "200" "operator assigned salon services"

request GET "${BASE_URL}/api/v1/call-center/salons/${salon_id}/customers?q=Smoke" "" "$call_center_access_token"
assert_status "200" "operator assigned salon customers"

request GET "${BASE_URL}/api/v1/call-center/queue?status=QUEUED" "" "$call_center_access_token"
assert_status "200" "operator queued escalations"

request GET "${BASE_URL}/api/v1/call-center/queue/${escalation_id}" "" "$call_center_access_token"
assert_status "200" "operator escalation detail"

request POST "${BASE_URL}/api/v1/call-center/queue/${escalation_id}/accept" "{\"amazonConnectContactId\":\"smoke-contact-${timestamp}\"}" "$call_center_access_token"
assert_status "200" "operator escalation accept"

request PATCH "${BASE_URL}/api/v1/call-center/queue/${escalation_id}" '{"operatorNotes":"Smoke test operator note","qaNotes":"Smoke QA note","resolution":"Operator is handling the caller."}' "$call_center_access_token"
assert_status "200" "operator escalation update"

request GET "${BASE_URL}/api/v1/availability/slots?staffId=${staff_id}&serviceId=${service_id}&date=${slot_date}&intervalMinutes=15" "" "$owner_access_token"
assert_status "200" "availability slots for operator appointment"
operator_slot_start="$(json_get "data.slots.0.startTime")"
if [[ -z "${operator_slot_start}" ]]; then
  operator_slot_start="${slot_start}"
fi

request POST "${BASE_URL}/api/v1/call-center/salons/${salon_id}/appointments" "{\"customerId\":\"${customer_id}\",\"staffId\":\"${staff_id}\",\"serviceId\":\"${service_id}\",\"startTime\":\"${operator_slot_start}\",\"notes\":\"Created by operator smoke test\",\"status\":\"CONFIRMED\"}" "$call_center_access_token"
assert_status "201" "operator appointment create"
operator_appointment_id="$(json_get "data.id")"

request PATCH "${BASE_URL}/api/v1/call-center/salons/${salon_id}/appointments/${operator_appointment_id}" '{"notes":"Updated by operator smoke test","status":"CONFIRMED"}' "$call_center_access_token"
assert_status "200" "operator appointment update"

request GET "${BASE_URL}/api/v1/availability/slots?staffId=${staff_id}&serviceId=${service_id}&date=${slot_date}&intervalMinutes=15" "" "$owner_access_token"
assert_status "200" "availability slots for operator reschedule"
operator_reschedule_start="$(json_get "data.slots.0.startTime")"
if [[ -z "${operator_reschedule_start}" ]]; then
  operator_reschedule_start="${operator_slot_start}"
fi

request PATCH "${BASE_URL}/api/v1/call-center/salons/${salon_id}/appointments/${operator_appointment_id}/reschedule" "{\"startTime\":\"${operator_reschedule_start}\"}" "$call_center_access_token"
assert_status "200" "operator appointment reschedule"

request PATCH "${BASE_URL}/api/v1/call-center/salons/${salon_id}/appointments/${operator_appointment_id}/cancel" '{"reason":"Smoke test operator cancel"}' "$call_center_access_token"
assert_status "200" "operator appointment cancel"

request POST "${BASE_URL}/api/v1/call-center/queue/${escalation_id}/complete" '{"resolution":"Smoke test completed the human escalation.","operatorNotes":"Completed by smoke test","qaNotes":"Workflow verified"}' "$call_center_access_token"
assert_status "200" "operator escalation complete"

request POST "${BASE_URL}/api/v1/auth/logout" "{\"refreshToken\":\"${call_center_refresh_token}\"}"
assert_status "200" "call center logout"

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

verify_aws_resources
invoke_lambda_human_escalation_sample

echo "All smoke tests completed successfully."

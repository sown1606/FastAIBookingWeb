#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BASE_URL="${BASE_URL:-https://api-new-nail.kendemo.com}"
OWNER_TOKEN="${OWNER_TOKEN:-}"

if [[ -z "${OWNER_TOKEN}" ]]; then
  echo "Missing OWNER_TOKEN. Export OWNER_TOKEN before running this smoke test."
  exit 1
fi

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT

request() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  local auth_mode="${4:-owner}"

  local headers=(-H "Accept: application/json")
  if [[ "$auth_mode" == "owner" ]]; then
    headers+=(-H "Authorization: Bearer ${OWNER_TOKEN}")
  fi
  if [[ -n "$data" ]]; then
    headers+=(-H "Content-Type: application/json")
    curl -sS -X "$method" "${headers[@]}" --data "$data" "$url" -o "$tmp_body"
  else
    curl -sS -X "$method" "${headers[@]}" "$url" -o "$tmp_body"
  fi
  cat "$tmp_body"
}

json_get() {
  local path="$1"
  python3 - "$path" "$tmp_body" <<'PY'
import json
import sys

path = sys.argv[1].split(".")
with open(sys.argv[2], "r", encoding="utf-8") as handle:
    obj = json.load(handle)

cur = obj
for part in path:
    if part.isdigit():
        cur = cur[int(part)]
    else:
        cur = cur[part]

if isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

echo "1) Sending sample CallRail webhook"
request POST "${BASE_URL}/api/v1/integrations/callrail/webhook" "$(cat "${ROOT_DIR}/apps/api/docs/examples/callrail-webhook.sample.json")" "public" >/dev/null

echo "2) Listing calls"
request GET "${BASE_URL}/api/v1/calls?page=1&limit=5" >/dev/null
call_session_id="$(json_get "data.items.0.id" || true)"
if [[ -z "${call_session_id}" ]]; then
  echo "No call session found after webhook ingestion."
  exit 1
fi
echo "call_session_id=${call_session_id}"

echo "3) Parsing booking text with AI endpoint"
request POST "${BASE_URL}/api/v1/ai/parse-booking" "$(cat "${ROOT_DIR}/apps/api/docs/examples/booking-unavailable.sample.json")" >/dev/null
interaction_id="$(json_get "data.interactionId" || true)"
echo "interaction_id=${interaction_id}"

echo "4) Running booking-from-transcript"
transcript_text="$(cat "${ROOT_DIR}/apps/api/docs/examples/transcript.sample.txt" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
request POST "${BASE_URL}/api/v1/ai/booking-from-transcript" "{\"transcriptText\":${transcript_text},\"callSessionId\":\"${call_session_id}\",\"transcriptSource\":\"smoke_script\",\"createCustomerIfMissing\":true}" >/dev/null

echo "5) Fetching booking attempts for call"
request GET "${BASE_URL}/api/v1/calls/${call_session_id}/booking-attempts" >/dev/null

echo "Integration smoke test completed."

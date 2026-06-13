#!/usr/bin/env bash
set -euo pipefail

# Example:
# AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com ./scripts/aws/ensure-connect-approved-origins.sh

AWS_PROFILE="${AWS_PROFILE:-nailnew}"
AWS_REGION="${AWS_REGION:-us-east-1}"
APP_ORIGIN="${APP_ORIGIN:-https://app-new-nail.kendemo.com}"
LOCAL_ORIGIN="${LOCAL_ORIGIN:-http://localhost:5173}"
INSTANCE_ALIAS_SEARCH="${INSTANCE_ALIAS_SEARCH:-fastaibooking}"

origin_from_url() {
  local value="${1%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"

  if [[ "$value" =~ ^https?://[^/]+ ]]; then
    printf '%s\n' "${BASH_REMATCH[0]}"
  fi
}

add_origin_candidate() {
  local origin="$1"
  if [[ -z "$origin" ]]; then
    return
  fi
  if [[ ${#ORIGIN_CANDIDATES[@]} -eq 0 ]] || ! printf '%s\n' "${ORIGIN_CANDIDATES[@]}" | grep -Fxq "$origin"; then
    ORIGIN_CANDIDATES+=("$origin")
  fi
}

printf 'Using AWS profile %s in region %s\n' "$AWS_PROFILE" "$AWS_REGION"
printf 'Finding Amazon Connect instance matching "%s"...\n' "$INSTANCE_ALIAS_SEARCH"

INSTANCE_ROW="$(
  aws connect list-instances \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --query "InstanceSummaryList[?contains(InstanceAlias, \`${INSTANCE_ALIAS_SEARCH}\`)] | [0].[Id, InstanceAlias]" \
    --output text
)"

if [[ -z "$INSTANCE_ROW" || "$INSTANCE_ROW" == "None"* ]]; then
  printf 'No Amazon Connect instance alias matched "%s".\n' "$INSTANCE_ALIAS_SEARCH" >&2
  exit 1
fi

read -r INSTANCE_ID INSTANCE_ALIAS <<<"$INSTANCE_ROW"
printf 'Using Amazon Connect instance %s (%s)\n' "$INSTANCE_ALIAS" "$INSTANCE_ID"

declare -a ORIGIN_CANDIDATES=()
add_origin_candidate "$(origin_from_url "$APP_ORIGIN")"
add_origin_candidate "$(origin_from_url "$LOCAL_ORIGIN")"

for env_file in .env.production .env .env.local apps/app/.env.production apps/app/.env apps/app/.env.local; do
  if [[ ! -f "$env_file" ]]; then
    continue
  fi

  while IFS='=' read -r key value; do
    if [[ "$key" == "VITE_APP_BASE_URL" ]]; then
      add_origin_candidate "$(origin_from_url "$value")"
    fi
  done < <(grep -E '^VITE_APP_BASE_URL=' "$env_file" || true)
done

if [[ ${#ORIGIN_CANDIDATES[@]} -eq 0 ]]; then
  printf 'No valid http(s) origins were provided or discovered.\n' >&2
  exit 1
fi

printf 'Checking current Approved origins...\n'
CURRENT_ORIGINS="$(
  aws connect list-approved-origins \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --instance-id "$INSTANCE_ID" \
    --query 'Origins' \
    --output text
)"

for origin in "${ORIGIN_CANDIDATES[@]}"; do
  if printf '%s\n' "$CURRENT_ORIGINS" | tr '\t' '\n' | grep -Fxq "$origin"; then
    printf 'Already approved: %s\n' "$origin"
    continue
  fi

  printf 'Associating Approved origin: %s\n' "$origin"
  aws connect associate-approved-origin \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --instance-id "$INSTANCE_ID" \
    --origin "$origin" >/dev/null
done

printf 'Approved origins after update:\n'
aws connect list-approved-origins \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --instance-id "$INSTANCE_ID" \
  --query 'Origins' \
  --output table

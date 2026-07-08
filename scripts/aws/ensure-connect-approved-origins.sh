#!/usr/bin/env bash
set -euo pipefail

# Example:
# AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com FORCE_REAPPLY=true ./scripts/aws/ensure-connect-approved-origins.sh

AWS_PROFILE="${AWS_PROFILE:-nailnew}"
AWS_REGION="${AWS_REGION:-us-east-1}"
APP_ORIGIN="${APP_ORIGIN:-https://app-new-nail.kendemo.com}"
LOCAL_ORIGIN="${LOCAL_ORIGIN:-http://localhost:5173}"
INSTANCE_ALIAS_SEARCH="${INSTANCE_ALIAS_SEARCH:-fastaibooking}"
EXPECTED_AWS_ACCOUNT_ID="${EXPECTED_AWS_ACCOUNT_ID:-197452633989}"
EXPECTED_INSTANCE_ID="${EXPECTED_INSTANCE_ID:-}"
FORCE_REAPPLY="${FORCE_REAPPLY:-false}"

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

print_origins() {
  local title="$1"
  local origins="$2"
  printf '%s\n' "$title"
  if [[ -z "$origins" || "$origins" == "None" ]]; then
    printf '  - none\n'
    return
  fi
  printf '%s\n' "$origins" | tr '\t' '\n' | sed '/^$/d; s/^/  - /'
}

printf 'Using AWS profile %s in region %s\n' "$AWS_PROFILE" "$AWS_REGION"
CALLER_IDENTITY="$(
  aws sts get-caller-identity \
    --profile "$AWS_PROFILE" \
    --query '[Account, Arn, UserId]' \
    --output text
)"
read -r AWS_ACCOUNT_ID AWS_CALLER_ARN AWS_USER_ID <<<"$CALLER_IDENTITY"
printf 'AWS caller identity:\n'
printf '  Account: %s\n' "$AWS_ACCOUNT_ID"
printf '  ARN: %s\n' "$AWS_CALLER_ARN"
printf '  UserId: %s\n' "$AWS_USER_ID"

if [[ -n "$EXPECTED_AWS_ACCOUNT_ID" && "$AWS_ACCOUNT_ID" != "$EXPECTED_AWS_ACCOUNT_ID" ]]; then
  printf 'Wrong AWS account for this FastAIBooking Connect instance. Expected %s but got %s using profile %s.\n' \
    "$EXPECTED_AWS_ACCOUNT_ID" "$AWS_ACCOUNT_ID" "$AWS_PROFILE" >&2
  exit 1
fi

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
printf 'Using Amazon Connect instance:\n'
printf '  Alias: %s\n' "$INSTANCE_ALIAS"
printf '  Id: %s\n' "$INSTANCE_ID"
printf '  Region: %s\n' "$AWS_REGION"

if [[ -n "$EXPECTED_INSTANCE_ID" && "$INSTANCE_ID" != "$EXPECTED_INSTANCE_ID" ]]; then
  printf 'Wrong Amazon Connect instance. Expected %s but found %s (%s) in %s.\n' \
    "$EXPECTED_INSTANCE_ID" "$INSTANCE_ID" "$INSTANCE_ALIAS" "$AWS_REGION" >&2
  exit 1
fi

declare -a ORIGIN_CANDIDATES=()
APP_ORIGIN_NORMALIZED="$(origin_from_url "$APP_ORIGIN")"
add_origin_candidate "$APP_ORIGIN_NORMALIZED"
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

if [[ -z "$APP_ORIGIN_NORMALIZED" ]]; then
  printf 'APP_ORIGIN must be a valid http(s) origin or URL. Received: %s\n' "$APP_ORIGIN" >&2
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
print_origins 'Approved origins before update:' "$CURRENT_ORIGINS"

if [[ "$FORCE_REAPPLY" == "true" ]]; then
  if printf '%s\n' "$CURRENT_ORIGINS" | tr '\t' '\n' | grep -Fxq "$APP_ORIGIN_NORMALIZED"; then
    printf 'FORCE_REAPPLY=true: disassociating exact APP_ORIGIN only: %s\n' "$APP_ORIGIN_NORMALIZED"
    aws connect disassociate-approved-origin \
      --profile "$AWS_PROFILE" \
      --region "$AWS_REGION" \
      --instance-id "$INSTANCE_ID" \
      --origin "$APP_ORIGIN_NORMALIZED" >/dev/null
    CURRENT_ORIGINS="$(
      aws connect list-approved-origins \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --instance-id "$INSTANCE_ID" \
        --query 'Origins' \
        --output text
    )"
  else
    printf 'FORCE_REAPPLY=true: APP_ORIGIN was not present before re-association: %s\n' "$APP_ORIGIN_NORMALIZED"
  fi
elif [[ "$FORCE_REAPPLY" != "false" ]]; then
  printf 'FORCE_REAPPLY must be true or false. Received: %s\n' "$FORCE_REAPPLY" >&2
  exit 1
fi

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

UPDATED_ORIGINS="$(
  aws connect list-approved-origins \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --instance-id "$INSTANCE_ID" \
    --query 'Origins' \
    --output text
)"
print_origins 'Approved origins after update:' "$UPDATED_ORIGINS"
printf 'Approved origins table:\n'
aws connect list-approved-origins \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --instance-id "$INSTANCE_ID" \
  --query 'Origins' \
  --output table

printf 'Command summary:\n'
printf '  AWS_PROFILE=%s\n' "$AWS_PROFILE"
printf '  AWS_REGION=%s\n' "$AWS_REGION"
printf '  AWS_ACCOUNT_ID=%s\n' "$AWS_ACCOUNT_ID"
printf '  INSTANCE_ALIAS=%s\n' "$INSTANCE_ALIAS"
printf '  INSTANCE_ID=%s\n' "$INSTANCE_ID"
printf '  APP_ORIGIN=%s\n' "$APP_ORIGIN_NORMALIZED"
printf '  FORCE_REAPPLY=%s\n' "$FORCE_REAPPLY"

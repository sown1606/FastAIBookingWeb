#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="nailnew"
EXPECTED_REGION="us-east-1"
EXPECTED_ACCOUNT="197452633989"
EXPECTED_ARN="arn:aws:iam::197452633989:user/fastaibooking-codex-deployer"

PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$EXPECTED_REGION}}"

unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
unset AWS_SECURITY_TOKEN
unset AWS_DEFAULT_PROFILE

if [ "$PROFILE" != "$EXPECTED_PROFILE" ]; then
  printf 'BLOCKED_WRONG_AWS_IDENTITY: expected profile %s, got %s\n' "$EXPECTED_PROFILE" "$PROFILE" >&2
  exit 1
fi

if [ "$REGION" != "$EXPECTED_REGION" ]; then
  printf 'BLOCKED_WRONG_AWS_IDENTITY: expected region %s, got %s\n' "$EXPECTED_REGION" "$REGION" >&2
  exit 1
fi

identity="$(
  aws sts get-caller-identity \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query '[Account, Arn]' \
    --output text
)"

account="$(printf '%s\n' "$identity" | awk '{print $1}')"
arn="$(printf '%s\n' "$identity" | awk '{print $2}')"

if [ "$account" != "$EXPECTED_ACCOUNT" ] || [ "$arn" != "$EXPECTED_ARN" ]; then
  printf 'BLOCKED_WRONG_AWS_IDENTITY: expected %s %s, got %s %s\n' \
    "$EXPECTED_ACCOUNT" "$EXPECTED_ARN" "$account" "$arn" >&2
  exit 1
fi

printf 'Validated AWS identity: profile=%s region=%s account=%s principal=%s\n' \
  "$PROFILE" "$REGION" "$account" "$arn"

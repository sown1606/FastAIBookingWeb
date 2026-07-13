# 2026-07-13 Call Edge Cases and GPT Debug Export

## Scope

Fixed the verified AI call-flow issues and GPT-friendly debug export mode. No database migration was added. No Lex version was created.

## Root Causes Fixed

- Compact debug timeline: historical turns inherited latest interaction fields because `buildAdminDebugTimelineItems` spread a latest-state base object into older turns.
- GPT export size: compact export still carried payload shape and duplication that is useful for machines but poor for ChatGPT ingestion.
- Ungrounded time: `thirty five` and `and it's thirty five` could be accepted as `5 PM` without a time cue.
- Generic service clarification: when `lastAskedSlot=serviceName`, current-turn active service answers were not always preferred over stale session service data.
- Staff exclusions: current staff could survive explicit exclusion phrases such as `any staff but not Amy` or `I don't want Amy`.
- Staff DTMF retry stability: digit-only staff selections could be reclassified as raw staff text after a saved staff menu had already mapped the digit.

## AWS Evidence: 21:08 Vietnam-Time Disconnect

Window searched: `2026-07-13T14:07:00Z` to `2026-07-13T14:10:30Z`.

AWS profile/region: `nailnew`, `us-east-1`.

Connect instance:

- Alias: `fastaibooking`
- Instance ID: `74f78377-766f-46b7-a745-4bc97b68a8dc`

Contacts found:

- `e266d6a2-3e4d-4417-9278-6ae62d8926c8`
  - Initiation: `2026-07-13T14:08:21.892Z`
  - Disconnect: `2026-07-13T14:08:33.129Z`
  - Attributes: caller `+84798171999`, called `+18483487681`
  - No `/aws/lambda/fastaibooking-booking-handler` events.
  - No `/aws/connect/fastaibooking` events.
  - No `/aws/lex/KHMIXGA2US` events.
  - No real-time contact analysis: `Real-time contact analysis not found`.
- `a22fd688-9ff2-496e-9d9d-4abbe8693b2e`
  - Initiation: `2026-07-13T14:09:33.175Z`
  - Later production call with Lambda logs, including the `food set`, `i want to book a pedicure tomorrow afternoon`, and `and it's thirty five` turns.

Conclusion: exact short-call ContactId is `e266d6a2-3e4d-4417-9278-6ae62d8926c8`. Available AWS telemetry does not expose an exact disconnect reason. Evidence proves the call ended before Lambda/API logging and there is no logged Lex no-input, no-match, Lambda error, or Connect flow transition error. CloudTrail lookup was denied for this profile, and CTR storage is not configured. I did not claim a code root cause and did not deploy the Connect flow.

The checked-in Connect flow artifact prompt was aligned to the required shorter wording, but the active AWS Connect flow was not deployed because the requested guardrail allowed Connect deployment only with trace evidence of a flow defect.

## Export Size

- Before: supplied compact export was approximately `1.32 MB` for 15 calls.
- After production GPT smoke: latest 15-call GPT export was `89,563` bytes.
- Result: under the `400 KB` target.

## Validation

- `node --check infra/lambda/booking-handler/index.mjs` - pass
- `npm run test:lambda` - pass
- `npm run test:api` - pass
- `npm run typecheck:api` - pass
- `npm run typecheck:admin` - pass
- `npm run typecheck:app` - pass
- `npm run build:api` - pass
- `npm run build:admin` - pass
- `npm run build:app` - pass
- `npm test` - pass
- `git diff --check` - pass

## Deployment

- API/Admin/App: `npm run deploy:ec2` completed successfully.
- Production health smoke: `./infra/scripts/smoke_test_production.sh` passed all checks.
- Lambda: deployed `fastaibooking-booking-handler` to `$LATEST`.
  - LastModified: `2026-07-13T19:03:21.000+0000`
  - CodeSha256: `xAgUFENByFVr+OIn3Cqh/Ht9jbEM+vLUCMcL0YF015I=`
- Amazon Connect flow: not deployed, per AWS evidence and guardrail.

## Synthetic Production Smokes

Run ID: `codex-edge-1783969663947`.

- Pedicure tomorrow afternoon, any staff is fine:
  - Asked `requestedTime`.
  - Did not invent `5 PM`.
  - Appointment created: no.
- Generic services -> Pedicure:
  - Turn 1 preserved future date, `2 PM`, and `Amy` while asking service.
  - Turn 2 accepted `Pedicure` and proceeded to confirmation preserving `2 PM` and `Amy`.
  - Appointment created: no.
  - A same-day variant also preserved `today`, `2 PM`, and `Amy`, but did not confirm because Amy had a real production appointment at 2 PM.
- Any staff but not Amy:
  - Selected `Trang`, not Amy.
  - Proceeded to confirmation.
  - Appointment created: no.
- No, just change the staff:
  - Cleared staff and elicited `staffPreference`.
  - Appointment created: no.
- GPT export latest 15 calls:
  - `recordCount=15`
  - `exportMode=gpt`
  - `bytes=89563`
  - Heavy payload key check: pass
  - Future-state leak check: pass

## Cleanup

No synthetic appointment IDs were returned by any targeted smoke. No appointment cleanup was required.


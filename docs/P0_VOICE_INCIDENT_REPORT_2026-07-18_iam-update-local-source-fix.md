# FastAIBooking P0 Voice Incident Report - 2026-07-18 IAM Update Run

## Final Status

`NOT_PROMOTED`

## Executive Summary

Local source defects were fixed and regression coverage was expanded, but live AWS evidence collection and all PSTN gates were blocked before any deployment by invalid AWS credentials:

```
sts:GetCallerIdentity: InvalidClientTokenId - The security token included in the request is invalid.
```

No canary or production voice stack was changed by this execution. No real PSTN calls were placed, no real appointments were created by this execution, and no production appointment cleanup could be verified.

## Root Causes

Proven local source defects:
- The repository Connect flow used `x-amz-lex:audio:max-length-ms:*:* = 20000`, which exceeds Amazon Connect's documented 15000 ms limit for Lex voice input and can route contacts to the Error branch.
- The prior endpointing profile waited 3200-4200 ms after speech stopped, which could add avoidable caller-perceived silence before processing.
- Global Lex barge-in was enabled for every slot through a wildcard session attribute instead of slot-specific measured behavior.
- The observed transcript `full set day at three p m the end is high` had no regression fixture and fell through to a misleading staff/date prompt path.
- Amazon Connect speech diagnostic confidence could be persisted as `1` without a Lex transcription confidence source.
- A later bare service DTMF digit could become trusted service state after an untrusted or dropped initial service turn.

Remaining live hypotheses:
- The two silent calls could still involve Connect flow routing, invalid Connect-to-Lex settings, Lex no-input/error behavior, Lambda response handling, Lex synthesis, Connect playback, or speakerphone barge-in. AWS contact and flow logs were inaccessible in this run, so the live failure boundary remains unproven.

## Incident Boundary Classification

- 2026-07-18 10:14 Asia/Ho_Chi_Minh: `Evidence remains insufficient`. `connect:SearchContacts` and CloudWatch flow logs could not be queried because AWS identity failed.
- 2026-07-18 10:16 Asia/Ho_Chi_Minh: Lex produced the corrupted transcript from the supplied AI record and the application response was misleading. Boundary: application resolver/prompt handling after Lex/Lambda turn production, not proven as silent playback.
- 2026-07-18 10:26 Asia/Ho_Chi_Minh: `Evidence remains insufficient`. Provider-only contacts and flow logs could not be queried because AWS identity failed.

## Source Changes

- AWS reference for the max speech duration contract: https://docs.aws.amazon.com/connect/latest/adminguide/get-customer-input.html
- Connect flow source marker updated to `2026-07-18-p0-definitive-voice-fix`.
- Connect max speech duration changed from `20000` to `12000` for phone Lex actions.
- Endpointing source profile changed to balanced values:
  - global `1300`
  - service `1600`
  - date `1300`
  - time `1100`
  - staff `1400`
  - customer name `1200`
  - booking confirmation `700`
- Global wildcard barge-in was removed; booking slots now set slot-specific `allow-interrupt=false`.
- Lex v10 phone slot prompts now use `maxLengthMs=12000` and the same balanced endpointing values.
- Lex v10 locale has explicit `speechDetectionSensitivity="Default"` and explicit speech settings marker.
- API and Lambda both implement guarded booking-frame repair:
  - observed transcript proposes `today` and `Any staff` only as medium-confidence values
  - combined confirmation says: `I heard Full Set today at 3 PM with the first available staff. Is that right?`
  - proposals are stored separately and are not committed before confirmation
- API and Lambda both protect service DTMF after a dropped first service turn by asking a service confirmation instead of silently trusting the digit.
- Speech confidence persistence now uses Lex transcription confidence when supplied; unknown speech confidence is stored as null/unknown, not fabricated.
- `.env.production.example` no longer contains secret-like placeholder values for DB/JWT secrets.

## Live AWS State

Not fetched in this run. The AWS CLI has a configured shared-credentials access key and `us-east-1` region, but `sts:GetCallerIdentity` fails with `InvalidClientTokenId`. Because identity failed, this execution could not safely capture:
- live production/canary Lex alias versions
- live Lambda revisions or code SHAs
- live Connect flow content or normalized live SHAs
- Connect/SearchContacts incident traces
- Lex/Connect log delivery
- production API health/image

## Source Hashes

- `infra/aws/connect/contact-flows/ai-reception.json`: `44e4bb4ea7da60eccc5523ff9d1b0e857a4965c30e7e7a6006feb8fb4b8b550e`
- `infra/lambda/booking-handler/index.mjs`: `361e0fd66531adb18e986934bc145e00e5422dbb8112419b9bd88ae78b723138`
- `apps/api/src/modules/ai/ai.service.ts`: `8092ed16b9e705b00285463dd8d1a8985a0d0137d21f66cc8b6b5eefd8c27b63`

## Observability

Not configured. The invalid AWS token blocked CloudWatch log group creation/updates, Lex alias logging updates, S3 audio-log bucket creation/policy updates, and Connect flow-log verification.

## Telephone-Quality Audio and PSTN

Not run. `RecognizeUtterance`, canary PSTN, and production PSTN acceptance require valid AWS credentials and callable Connect/Lex resources.

No latency p50/p95/worst, caller-heard playback result, audio object hashes, canary contact IDs, or production contact IDs were produced by this run.

## Error-Path Proof

Local source contract tests pass for:
- Connect/Lex max speech duration at or below 15000 ms
- no wildcard Draft Lex alias in the Connect source
- explicit speech settings in Lex v10 source
- audible finite error/recovery graph coverage in the Connect source
- no Lex error path reaching another Lex input block without an intervening literal audible message

Live proof was not collected because AWS access failed.

## Timezone Evidence

Local regression coverage passed for salon-local appointment handling, mixed-timezone rejection, past-time rejection, and weekday/date contradiction handling. Live contact timezone consistency could not be verified.

## Appointment Cleanup

No real test appointments were created by this execution. Production cleanup and active-count verification for caller ending `4886`, plus inspection/cancellation of appointment `3dbb0306-0959-42de-8285-8a583b199cba`, were not executed because AWS/API production access was unavailable after the AWS identity gate failed.

## Verification

Passed on the final current tree:
- `npm run test:lambda`: 161 passed, 0 failed
- `npm run test:api`: 304 passed, 0 failed
- `npm run typecheck:api`: passed
- `npm run typecheck:admin`: passed
- `npm run typecheck:app`: passed
- `npm run build:api`: passed
- `npm run build:admin`: passed
- `npm run build:app`: passed
- `npm --prefix apps/api run prisma:generate`: passed
- `node scripts/secret-scan.mjs`: passed with allowlisted internal-token-name findings only
- Added-diff scan: no newly added full authorized phone/name, AWS token, bearer token, presigned URL, private key, or Lambda environment dump

Build warnings:
- `build:admin` and `build:app` reported existing Vite large-chunk warnings; builds completed successfully.

## Security Notes

- No audio files, deployment zips, raw AWS logs, presigned URLs, or full Lambda environment dumps were created or committed.
- New test fixtures use synthetic caller identity values and do not include the authorized full phone number.
- Existing untracked files present before this run were not modified or staged.

## Rollback Manifest

Machine-readable manifest: `docs/rollback-manifest-2026-07-18-iam-update-not-promoted.json`

Because no live deployment occurred, there is no deployed stack generation to roll back from this execution.

## Commit and Push

Commit SHA and pushed branch are recorded in the final handoff after Git commit/push completes.

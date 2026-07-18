# FastAIBooking P0 Voice Incident Report - 2026-07-18

## Executive Verdict

`NOT_PROMOTED`

Production voice routing was not promoted. The hard gates for Lex audio logs, Connect flow-log evidence, real PSTN audible playback, and post-promotion call acceptance were not met.

## Proven Facts vs Hypotheses

Proven:
- Production Lex alias `prod` still points to bot version `41`.
- Production Connect flow `FastAIBooking AI Reception` still has source marker `2026-07-17-thuyet-voice-hotfix`.
- Production Lambda code SHA remains `mR66LpeLRmt4CT4LHwxpqQkdizG2ZPtT3TFuF73YWq0=`.
- Internal API token was rotated; previous-token support was removed after both Lambdas verified the replacement token.
- Canary Lambda logging was isolated to `/aws/lambda/fastaibooking-booking-handler-p0-canary-20260717`.
- Lex text logs did not emit events after runtime probes. Lex audio logging could not be enabled because the deployer lacks `s3:CreateBucket`.
- Connect instance flow logs are enabled, but no flow-log event was observed; a non-PSTN chat probe did not enter the voice flow.

Hypotheses not closed:
- Caller-perceived silence may still involve endpointing, Lex synthesis, Connect playback, speakerphone echo/barge-in, or first-turn latency. These remain unproven without correlated audio evidence.

## Before / After

Before:
- Production path: Connect production flow -> Lex alias `prod` version `41` -> `fastaibooking-booking-handler`.
- Canary path existed separately: canary Connect flow -> Lex alias `p0-voice-canary-20260717` version `42` -> `fastaibooking-booking-handler-p0-canary-20260717`.
- Canary Lambda was configured to the production Lambda log group.
- Deployment/debug artifacts contained raw Lambda environment dumps and call/debug PII.

After:
- Production voice path remains on version `41`; no canary ARNs were promoted into production.
- API image is healthy at `sha256:8305a38bcab1a4c794247d66101784a4ed03a667aeb3c2ad9787b69b2e9a6924`.
- Canary Lambda has isolated log group and 7-day retention.
- Raw artifact trees and raw call capture files were removed from the working tree; documentation phone values were redacted to last-four form.
- Current-tree secret/PII scan passes.

## Security Remediation

- Rotated the internal API bearer token without printing token values.
- Deployed temporary dual-token API support, verified active and previous token acceptance, updated production and canary Lambdas, then removed previous-token support.
- Verified previous token is absent from API `.env` and rejected by the API.
- Removed tracked raw artifacts including `docs/report-artifacts/`, raw live-call captures, deployment zips, a recording file, and raw Lambda deployment output.
- Added `.gitignore` rules for zips, keys, report artifacts, raw recordings, and presigned outputs.
- Added reusable sanitizer and current-tree secret/PII scanner.
- `gitleaks` and `trufflehog` were not installed. Targeted Git evidence shows the shared pre-cleanup `HEAD` contains Lambda environment dump/internal token references in removed artifact paths. History rewrite was not performed.

## Test Gates

Frozen test clock: `2026-07-17T10:00:00-04:00`; timezone: `America/New_York`.

Passed:
- `npm run test:lambda`: `157` total, `157` passed, `0` failed. Run twice after fixes.
- `npm run test:api`: `301` total, `301` passed, `0` failed. Run twice after fixes.
- `npm run typecheck:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run typecheck:app`: passed.
- `npm run build:api`: passed.
- `npm run build:admin`: passed.
- `npm run build:app`: passed.
- `npm --prefix apps/api run prisma:generate`: passed.
- `node scripts/secret-scan.mjs`: passed.

## AWS Versions and Hashes

Production:
- Lex bot `KHMIXGA2US`, alias `prod` / `JVIPIZDYE3`, version `41`, status `Available`.
- Production Lambda `fastaibooking-booking-handler`, revision `7e58a186-3c78-4b3c-8857-180bb0c5ce61`, code SHA `mR66LpeLRmt4CT4LHwxpqQkdizG2ZPtT3TFuF73YWq0=`.
- Production Connect flow `dcccf542-587c-426c-a644-a4c6f24da6e4`, marker `2026-07-17-thuyet-voice-hotfix`, normalized SHA-256 `199aa5ae084361b68be429ca8175fc20031871e6b1b496f8b116e5ca218e7347`.

Canary:
- Lex alias `p0-voice-canary-20260717` / `Z4DLL5S5B2`, version `42`, status `Available`.
- Canary Lambda `fastaibooking-booking-handler-p0-canary-20260717`, revision `3dc23469-754a-4f0c-8059-676cec172fd8`, code SHA `RbTj6sA3QH5ahCOmRfefoDO4LGDqvbjd5Uu2YBqAPzw=`.
- Canary Connect flow `70b6c12b-1a5f-4d37-aea3-943dc291acd3`, marker `2026-07-17-p0-voice-regression-canary`, normalized SHA-256 `3953cc4ac9b6eb77240b85da3ffd11cf497853b48b83d42e0b6de81a0786bc4e`.

## Observability Evidence

Lambda:
- Direct canary Lambda probe returned `StatusCode=200`, `ElicitSlot`, `PlainText`, nonempty message.
- Isolated canary log group has streams with event counts `5` and `4`.

Lex:
- Canary text log group exists with 3-day retention but produced no streams after `RecognizeText` probes.
- Audio logs were not enabled; `s3:CreateBucket` was denied for the dedicated canary audio bucket.

Connect:
- Instance `CONTACTFLOW_LOGS` is `true`.
- Canary flow starts at `UpdateFlowLoggingBehavior`.
- Connect log group `/aws/connect/fastaibooking` has no observed events.
- Diagnostic chat contact `73e8ab7b-095b-4126-b6c0-d090ce14f30d` was stopped; it never entered a contact flow.

## Real-Call Matrix

No real PSTN acceptance calls were run after final changes. Required critical cases therefore remain `NOT_RUN`:
- normal one-shot;
- slow natural speech;
- segmented service/date/time/staff;
- `Any staff is fine`;
- no-input recovery after service;
- correction without slot corruption.

## Latency

No p50/p95/worst PSTN latency metrics were collected because the observability gate failed before real-call testing. The direct canary Lambda diagnostic logged `lambdaProcessingMs=583`, but this is not telephone ASR, Lex audio synthesis, or Connect playback latency.

## Playback Evidence Stage

No `CALLER_AUDIO_HEARD_CONFIRMED` evidence exists. Available evidence is limited to `LAMBDA_RESPONSE_CONFIRMED` for direct canary Lambda and `RecognizeText` probes. This is insufficient to close the voice playback incident.

## Appointment Cleanup

Authorized phone ending `4886`:
- `active_before=0`
- `active_after=0`
- `matching_customer_records=1`

No active appointment required cancellation in this run.

## Rollback / Production Stability

No production voice promotion occurred, so rollback was not required. Production Lex alias, production Connect source marker, and production Lambda code SHA remain on the pre-P0 production voice path. Production Lambda environment changed only for internal-token rotation.

## Commit / Branch

Branch: `main`

Commit SHA: recorded in the final handoff after commit/push.

## Remaining Risks and Follow-Up

- Grant S3 permissions or pre-create a dedicated encrypted Lex canary audio bucket, then enable Lex audio logs.
- Repair Lex text log delivery; current resource policy and alias settings were insufficient to create streams.
- Prove Connect flow-log delivery with a voice-flow contact only after Lex logs are working.
- Run `RecognizeUtterance` with telephone-quality audio fixtures.
- Run the full authorized PSTN canary matrix three consecutive times, then promote only if all gates pass.
- Run production PSTN acceptance twice only after canary success.
- Consider shared-history rewrite only with owner authorization; credentials have already been rotated so historical copies are no longer valid for the internal API token.

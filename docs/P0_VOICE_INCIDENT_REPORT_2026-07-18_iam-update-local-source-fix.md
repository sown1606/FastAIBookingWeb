# FastAIBooking P0 Voice Incident Report - 2026-07-18 IAM Update Run

## Final Status

`NOT_PROMOTED`

## Executive Summary

AWS access was verified with deployment profile `nailnew`, and the IAM update was sufficient to inspect and modify the canary voice stack. Production was not promoted because the required real PSTN canary matrix and production PSTN acceptance were not completed after the final canary change.

Canary was updated to the corrected Lambda, Lex version, Connect flow, and S3 audio logging. Synthetic telephone-quality `RecognizeUtterance` runs proved the corrected canary can parse the critical Full Set one-shot and segmented booking paths, and the final past-date guard now rejects unresolved spoken past references before customer-name prompting. These are not substitutes for caller-heard PSTN acceptance.

## Root Causes

Proven facts:
- Live production was still on Connect marker `2026-07-17-thuyet-voice-hotfix`, production flow `dcccf542-587c-426c-a644-a4c6f24da6e4`, Lex alias `JVIPIZDYE3`, Lex version `41`.
- Live production and predeploy canary Connect Lex blocks still used `x-amz-lex:audio:max-length-ms:*:* = 20000`, above the Amazon Connect voice limit of 15000 ms.
- Live production endpointing was excessive for short booking turns: global `3200`, service `2800`, date/time `2200`, staff `2600`, customer name `2000`, confirmation `900`.
- Predeploy canary endpointing was even slower at global `4200`, with wildcard `allow-interrupt=true`.
- The previous Lex locale source encoded a unified speech setting that produced a live hidden Nova Sonic runtime configuration. `RecognizeUtterance` failed against that canary generation with `speech-to-speech models` unsupported, and `StartConversation` failed because the account is not onboarded to Connect Unlimited AI.
- The old production Lambda log for the corrupted turn recorded speech confidence as `1` without a real confidence source.
- The observed corrupted transcript had no deployed guarded repair in production.
- Before the final canary Lambda update, unresolved spoken `yesterday` with no Lex date slot could prompt for customer name instead of rejecting the past date.

Remaining hypotheses:
- The two silent provider contacts most likely hit the old production voice stack, but Connect flow-log delivery was absent, so the exact block-level failure is not fully proven.
- iPhone speakerphone echo and barge-in still require real PSTN A/B measurement before any production promotion.

## Incident Boundary Classification

- 2026-07-18 10:14 Asia/Ho_Chi_Minh, contact `b873b37d-d860-4e82-98e7-bed380c66393`: category 8, evidence remains insufficient. Connect attributes show the old flow marker and no recorded Connect error branch. No Lambda invocation or Lex successful-turn log was found, and the Connect flow-log group had no events.
- 2026-07-18 10:16 Asia/Ho_Chi_Minh, contact `bacb4bce-2496-441e-b3b2-50854c2d27ab`: category 3 for the lost date/staff fields, with downstream Lambda prompt handling defect. Lambda was invoked and retained service/time, but Lex produced `full set day at three p m the end is high`; date and staff were not usable from the top result.
- 2026-07-18 10:26 Asia/Ho_Chi_Minh, contact `aec365c5-88ac-461f-b26b-b8462d4ec9d3`: category 8, evidence remains insufficient. Connect attributes show the old flow marker and no recorded Connect error branch. No Lambda invocation or Lex successful-turn log was found, and the Connect flow-log group had no events.

## Live Before/After

AWS identity:
- account `197452633989`
- principal `arn:aws:iam::197452633989:user/fastaibooking-codex-deployer`

Production before and after this run:
- Lex alias `JVIPIZDYE3` remained on version `41`.
- Lambda `fastaibooking-booking-handler` remained at code SHA `mR66LpeLRmt4CT4LHwxpqQkdizG2ZPtT3TFuF73YWq0=`, revision `7e58a186-3c78-4b3c-8857-180bb0c5ce61`.
- Connect flow `dcccf542-587c-426c-a644-a4c6f24da6e4` remained marker `2026-07-17-thuyet-voice-hotfix`, normalized SHA `199aa5ae084361b68be429ca8175fc20031871e6b1b496f8b116e5ca218e7347`.

Canary before this run:
- Lex alias `Z4DLL5S5B2` was version `42`.
- Lambda `fastaibooking-booking-handler-p0-canary-20260717` was code SHA `RbTj6sA3QH5ahCOmRfefoDO4LGDqvbjd5Uu2YBqAPzw=`, revision `3dc23469-754a-4f0c-8059-676cec172fd8`.
- Connect flow `70b6c12b-1a5f-4d37-aea3-943dc291acd3` was marker `2026-07-17-p0-voice-regression-canary`, normalized SHA `3953cc4ac9b6eb77240b85da3ffd11cf497853b48b83d42e0b6de81a0786bc4e`.

Canary after this run:
- Lex alias `Z4DLL5S5B2` now points to immutable version `44`.
- Lex v44 locale uses `speechRecognitionSettings.speechModelPreference=Standard`, `speechDetectionSensitivity=Default`, and no unified speech model.
- Canary Lambda code SHA is `jJXR3izYSEBglP95b2gJUs+car+E9iW5yJM2yx9AQHU=`, revision `8e7f76d5-0f0b-4b09-b8c4-4b5161e77e80`.
- Canary Connect flow marker is `2026-07-18-p0-definitive-voice-fix`, normalized SHA `fc510d5c4ac5c10ba583b8932bceca34eee821791175a44f87aee18cd0289da3`.

Canary Connect speech values after:
- max speech duration `12000`
- global end timeout `1300`
- service `1600`
- date `1300`
- time `1100`
- staff `1400`
- customer name `1200`
- confirmation `700`
- slot-specific barge-in disabled for booking/recovery prompts

## Observability

- Canary Lex audio logging is configured to private encrypted S3 bucket `fastaibooking-lex-canary-audio-197452633989-us-east-1-20260718`, prefix `lex-canary-audio/`.
- S3 public access block and default AES256 encryption were applied.
- Bucket ownership-controls verification was denied: `s3:PutBucketOwnershipControls` on the canary bucket was not allowed by identity policy.
- The Lex runtime role is service-linked and rejected inline policy modification as `UnmodifiableEntity`. Bucket policy write permission was applied narrowly to the canary audio prefix.
- `RecognizeUtterance` created audio log objects under the canary prefix. One downloaded diagnostic object had SHA-256 `8f4abf6d4bab97353495cbd37fe429929f1660adacc52717ce855c968e12ba99`, duration `3.159375s`, WAV PCM mono 8 kHz, server-side encrypted.
- The downloaded local audio evidence was removed during cleanup.
- A dedicated canary text log group was created with 7-day retention, but successful-turn text events did not arrive there during this run. Lex runtime error events did arrive in the legacy Lex log group.
- Connect instance flow logging is enabled and canary `StartAction` reaches `UpdateFlowLoggingBehavior`, but no real voice contact entered the canary during this run, so Connect flow-log delivery is not PSTN-proven.

## Error-Path Proof

Local source contract tests pass for:
- all Connect Lex error and no-match branches reaching a literal audible message before retry or disconnect
- recovery actions reachable from `StartAction`
- no Lex error branch reaching another Lex input block without an intervening literal audible message
- no final recovery block self-loop
- no Connect or Lex phone max speech duration above 15000 ms
- no unversioned Draft alias in production/canary Connect flow source

Live canary graph was published with `enable-flow-logging` reachable and no Connect Lex `Error` or `NoMatchingCondition` branches skipping literal recovery. This still lacks caller-heard PSTN proof.

## Speech Model and Confidence Evidence

Winning canary candidate for this run: Standard model with Default VAD. This was chosen because the prior hidden Nova Sonic canary generation failed runtime compatibility for this account. Neural and HighNoiseTolerance were not promoted because the required real speakerphone matrix was not completed.

Evidence:
- `RecognizeUtterance` session `p0-canary-20260718T080653Z-any-staff-v44` transcript: `Full Set today at three p. m. Any staff is fine`; intent confidence `0.93`; slots resolved to Full Set, today, 3 PM, Any staff.
- `RecognizeUtterance` session `p0-canary-20260718T080818Z-amy-v44` transcript: `Full Set today at three p. m. with Amy`; slots resolved to Full Set, today, 3 PM, Amy.
- Lambda diagnostics now preserve unknown speech confidence as null/unknown and text confidence as `1` only for text input.

## Latency Metrics

Synthetic telephone-quality canary `RecognizeUtterance` elapsed metrics:
- `slow_any`: `5863 ms` end-to-response elapsed, Lambda `1749 ms`
- `conflict_date`: `4927 ms` elapsed, Lambda `340 ms`
- `past-date-afterguard`: `4952 ms` elapsed, Lambda `851 ms`
- segmented with caller session attrs:
  - service segment: `3150 ms` elapsed, Lambda `289 ms`
  - date segment: `4048 ms` elapsed, Lambda `1200 ms`
  - time segment: `5807 ms` elapsed, Lambda `2918 ms`
  - staff segment: `4029 ms` elapsed, Lambda `1214 ms`

These are backend/runtime measurements, not caller-heard PSTN playback measurements. The p95 caller-heard acceptance gate remains unrun.

## Timezone Evidence

Local tests cover salon timezone snapshot consistency, past-time rejection, weekday/date contradiction, and mixed-timezone rejection. The canary segmented session with caller attrs preserved local booking state across turns. No real canary or production appointment was created, so event-time timezone consistency was not proven through a PSTN booking transaction.

## Appointment Cleanup

- Incident appointment `3dbb0306-0959-42de-8285-8a583b199cba` was inspected through the production admin API. It was `SCHEDULED` and was canceled in this run.
- No canary audio run completed final booking confirmation, so no appointment was created by this execution.
- Active appointment count for the authorized customer phone ending `4886` was verified as `0`.
- Matched authorized customer record was redacted in local output as phone `***4886`.

## Verification

Passed after the final source change:
- `npm run test:lambda`: `162` passed, `0` failed; run twice after the final Lambda source change
- `npm run test:api`: `304` passed, `0` failed
- `npm run typecheck:api`: passed
- `npm run typecheck:admin`: passed
- `npm run typecheck:app`: passed
- `npm run build:api`: passed
- `npm run build:admin`: passed with existing Vite large-chunk warning
- `npm run build:app`: passed with existing Vite large-chunk warnings
- `npm --prefix apps/api run prisma:generate`: passed

Source hashes after final local change:
- `infra/aws/connect/contact-flows/ai-reception.json`: `44e4bb4ea7da60eccc5523ff9d1b0e857a4965c30e7e7a6006feb8fb4b8b550e`
- `infra/lambda/booking-handler/index.mjs`: `03918428b326cf30c7c30218439cfe8a08b206b2316d3a03ea0b3abf049b5d77`
- `apps/api/src/modules/ai/ai.service.ts`: `8092ed16b9e705b00285463dd8d1a8985a0d0137d21f66cc8b6b5eefd8c27b63`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/BotLocale.json`: `92bf9bfb5fddb64be2377176fff3d49395720abc28b0ae0cf275bd8d8077730a`

Security scan status: `node scripts/secret-scan.mjs` passed after cleanup with allowlisted repository findings only.

## Cleanup and Security

- Local downloaded audio evidence, generated audio fixtures, raw AWS logs, SDK scratch installs, and deployment zip artifacts were removed from `.tmp` before final scan.
- No bearer tokens, presigned URLs, raw Lambda environments, full customer phone numbers, or audio files are committed.
- The tracked rollback manifest intentionally stores redacted live IDs, versions, SHAs, and rollback order only.

## Rollback Manifest

Machine-readable predeploy rollback manifest: `docs/rollback-manifest-2026-07-18-live-predeploy.json`

Production was not changed, so no production rollback was required. Local binary/audio/raw-log artifacts under `.tmp` were removed during cleanup because no production promotion occurred.

## Git

Branch: `p0/voice-definitive-source-fix-20260718`

Source commits already pushed before the live canary phase:
- `a6b8341d2063e4c313b2387f2557fce259260253`
- `b6cc9d20fcb22be97abc01200a986e4ec8534a1f`

Live canary source commit:
- `a2705d087bc97667aedbaff3985de7c4f3f49a55`

Draft PR creation remained blocked from this environment because the GitHub connector returned `422 must be a collaborator`, and the installed `gh` CLI is not authenticated.

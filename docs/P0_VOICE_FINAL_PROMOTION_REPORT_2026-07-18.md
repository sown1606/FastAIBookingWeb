# P0 Voice Final Promotion Report - 2026-07-18

Final status: `NOT_PROMOTED`

Created at: `2026-07-18T09:49:02Z`

## Scope

- Branch: `p0/voice-definitive-source-fix-20260718`
- Initial resolved HEAD: `71e433bd736bca723448abfc1fe1d6e89f66e82c`
- Guard/source commit pushed: `634d6a821a106372fd200ae89d67fe7726e545bf`
- AWS profile: `nailnew`
- AWS region: `us-east-1`
- AWS account: `197452633989`
- Expected principal: `arn:aws:iam::197452633989:user/fastaibooking-codex-deployer`

## Decision

Production was not promoted. The canary flow source was updated and verified, but the required observability gate failed before any caller-scoped PSTN route was created.

Blocking evidence:

- Canary Lex audio logging created private S3 audio objects for successful `RecognizeUtterance` sessions.
- Canary Lex text logging did not create successful-turn events in `/aws/lex/KHMIXGA2US/p0-voice-regression-canary`.
- A custom Lex runtime role with narrow log and audio permissions was tried, the canary alias was re-saved, and another successful `RecognizeUtterance` was run. Text events still did not arrive.
- IAM diagnostics for the custom role were blocked by denied `iam:SimulatePrincipalPolicy` and denied `iam:GetRolePolicy` on role `FastAIBookingLexConversationLogsRole20260718`.
- The temporary custom Lex role was removed and the bot runtime role was restored to `arn:aws:iam::197452633989:role/aws-service-role/lexv2.amazonaws.com/AWSServiceRoleForLexV2Bots_3N9FIXUYTDR`.

## Live State

Production remains intentionally unchanged:

- Lex bot: `KHMIXGA2US`
- Production alias: `JVIPIZDYE3`
- Production Lex version: `41`
- Production Lambda: `fastaibooking-booking-handler`
- Production Lambda code SHA: `mR66LpeLRmt4CT4LHwxpqQkdizG2ZPtT3TFuF73YWq0=`
- Production Lambda revision: `7e58a186-3c78-4b3c-8857-180bb0c5ce61`
- Production Connect flow: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Production flow marker: `2026-07-17-thuyet-voice-hotfix`
- Production normalized flow SHA: `199aa5ae084361b68be429ca8175fc20031871e6b1b496f8b116e5ca218e7347`
- Production live max speech duration: `20000 ms`
- Production live endpointing: global `3200 ms`, service `2800 ms`, date `2200 ms`, time `2200 ms`, staff `2600 ms`, customer name `2000 ms`, confirmation `900 ms`
- Production live barge-in: wildcard interrupt enabled

Canary current state:

- Canary alias: `Z4DLL5S5B2`
- Canary Lex version: `44`
- Speech model: `Standard`
- VAD: `Default`
- Canary Lambda: `fastaibooking-booking-handler-p0-canary-20260717`
- Canary Lambda code SHA: `jJXR3izYSEBglP95b2gJUs+car+E9iW5yJM2yx9AQHU=`
- Canary Lambda revision: `ed293842-52ed-4212-af5a-597f055e6159`
- Canary Connect flow: `70b6c12b-1a5f-4d37-aea3-943dc291acd3`
- Canary flow marker: `2026-07-18-p0-pstn-canary`
- Canary normalized flow SHA: `27603a40bbdfc17e788df47c5c7e1c96ae0548f361effce47eabb75459203d9e`
- Canary max speech duration: `12000 ms`
- Canary endpointing: global `1300 ms`, service `1600 ms`, date `1300 ms`, time `1100 ms`, staff `1400 ms`, customer name `1200 ms`, confirmation `700 ms`
- Canary booking and recovery prompt barge-in: slot-specific disabled

Generated production candidate, not deployed:

- Candidate marker: `2026-07-18-p0-pstn-production`
- Candidate normalized flow SHA: `38f00aa3fe014ea4db2756ed71532c594b6bd1b4424ada76621740e95ada1410`
- Candidate max speech duration: `12000 ms`
- Candidate endpointing and barge-in match the canary source profile above.

## Root Cause

Proven facts:

- Production is still on the old Connect flow marker with `20000 ms` max speech duration and wildcard barge-in.
- The source candidate and canary flow now enforce `12000 ms` max speech duration and finite, audible Lex error recovery paths through source validators.
- The observed 10:16-class turn had a real ASR corruption: service and time survived, but date and first-available staff evidence were lost before the response.
- The Lambda/API regression suite now protects the observed frame repair, malformed first-available tails, DTMF scoping, timezone guards, and no fabricated speech confidence.
- Successful Lex audio logging is proven for canary `RecognizeUtterance`; successful Lex text logging to the intended destination is not proven.

Remaining hypotheses:

- The missing Lex text logs may be caused by a resource policy, service-linked-role behavior, or Lex V2 conversation log delivery mode that is not visible with the current IAM read permissions.
- The real PSTN silent-call boundary cannot be reclassified in this continuation because PSTN canary routing was not created after the observability gate failed.
- The recurring synthetic latency above gate may include Lex runtime overhead, cold behavior, or audio response generation; caller-heard PSTN latency was not measured.

## Incident Boundaries

- 10:14 local: not re-traced in this continuation. Evidence remains insufficient here.
- 10:16 local, represented by contact `bacb4bce-2496-441e-b3b2-50854c2d27ab`: Lex produced a corrupted transcript and the application response was valid but misleading. Boundary is after Lex ASR and in Lambda/API resolver and prompt policy.
- 10:26 local: not re-traced in this continuation. Evidence remains insufficient here.

## Observability

- Lex audio logs: object creation verified under private prefix `lex-canary-audio/`.
- Audio evidence retained in report only as metadata: first successful object ETag `cfa838cddab073e3d01ae3655b40eb0a`, size `42114 bytes`, approximate duration `2.63 s`.
- Local audio and downloaded/generated evidence were deleted.
- Lex text logs: configured on canary alias but no successful-turn events reached `/aws/lex/KHMIXGA2US/p0-voice-regression-canary`.
- Connect flow logs: instance log group `/aws/connect/fastaibooking` exists with 7-day retention, but no real PSTN canary contact entered the canary flow during this continuation.
- Lambda structured diagnostics are present in source and tests; no real PSTN canary Lambda correlation was collected.

## Synthetic Runtime Evidence

Successful `RecognizeUtterance` sessions:

- `p0-continuation-20260718T092916`: transcript `Full Set today at three p. m. Any staff is fine`, NLU confidence `0.93`, elapsed `4999 ms`.
- `p0-logrole-20260718T093424`: same critical phrase accepted, elapsed `5280 ms`.
- `p0-logresave-20260718T093603`: same critical phrase accepted, elapsed `3041 ms`.

Synthetic elapsed metrics:

- p50: `4999 ms`
- p95: `5280 ms`
- worst: `5280 ms`
- Gate result: failed synthetic p95 `<= 4500 ms`; no synthetic run exceeded `6000 ms`.

N-best/confidence source:

- Runtime response exposed top transcript and NLU confidence.
- Dedicated Lex text logs did not provide the required successful-turn N-best evidence.

## PSTN Acceptance

- Caller-scoped canary route: not created.
- Canary PSTN contact IDs: none.
- Canary critical rounds passed: `0`.
- Canary extended matrix passed: `false`.
- Production PSTN contact IDs: none.
- Production critical rounds passed: `0`.
- Caller-heard playback result: not measured.

## Error Path Proof

- `npm run voice:deploy:canary:dry-run` passed source validation and matched live canary SHA.
- `npm run voice:deploy:production:dry-run` passed source validation and showed production drift without writing.
- Validators reject Connect Lex max speech duration above `15000 ms`, Draft aliases, unreachable recovery blocks, final recovery self-loops, and Lex error/no-match paths that reach another Lex block without a literal audible message.
- Runtime PSTN proof was not collected because the observability gate failed first.

## Appointment Cleanup

- Incident appointment `3dbb0306-0959-42de-8285-8a583b199cba`: already `CANCELED`.
- Appointments created during this continuation: none.
- Active appointment count for `***4886`: `0`.
- No unrelated `***1999` appointments were blanket-canceled.

## Tests And Builds

- `npm run aws:verify-identity`: passed.
- `npm run test:lambda`: `162/162` passed, run 1 duration `12151.644 ms`.
- `npm run test:lambda`: `162/162` passed, run 2 duration `12201.021 ms`.
- `npm run test:api`: `304/304` passed, duration `24545.256 ms`.
- `npm run typecheck:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run typecheck:app`: passed.
- `npm run build:api`: passed.
- `npm run build:admin`: passed with existing chunk-size warning.
- `npm run build:app`: passed with existing chunk-size warning.
- `npm --prefix apps/api run prisma:generate`: passed.
- `npm run voice:deploy:canary:dry-run`: passed.
- `npm run voice:deploy:production:dry-run`: passed.
- `node scripts/secret-scan.mjs`: passed with only allowlisted variable-name findings.

## Git And PR

- Guard/source commit pushed: `634d6a821a106372fd200ae89d67fe7726e545bf`
- Report commit pushed before PR auth check: `2b6ced9a9c39f216ac3adae2e7d02ff1ef2e95f5`
- PR creation: unavailable because `gh auth status` returned not logged in.
- Compare URL: `https://github.com/sown1606/FastAIBookingWeb/compare/main...p0/voice-definitive-source-fix-20260718`

## Rollback

- Production rollback was not required because no production write occurred.
- Canary flow rollback snapshot was created before the canary write, then local temporary artifacts were removed during cleanup.
- The temporary custom Lex role attempt was rolled back by restoring the original service-linked bot role and deleting the custom role.

## Remaining Risks

- Production still has live `20000 ms` Connect max speech duration and wildcard barge-in.
- Canary Lex text logs are not usable for successful turns.
- No caller-heard PSTN evidence was collected.
- The production promotion gate remains closed until Lex text observability and PSTN canary acceptance pass.

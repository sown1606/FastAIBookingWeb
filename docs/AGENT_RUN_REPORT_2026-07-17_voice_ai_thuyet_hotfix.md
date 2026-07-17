# 2026-07-17 Voice AI Thuyet Hotfix

## Root Cause

| Area | ContactId | Evidence | Root cause | Fix |
| --- | --- | --- | --- | --- |
| Full Set as `full jet` | `09f62f96-7fe5-4ae3-ab53-37f1da8b9cb7` | `full jet` then date/time/Amy; service stayed missing | Service recovery was too conservative for active `serviceName` scoped ASR aliases | Added scoped `full jet` Full Set confirmation; preserves trusted date/time/staff |
| Known-good one-shot | `4908373f-592d-4968-b6b7-fa8f9b37d794` | `phone set on monday july twentieth at three p m with amy` succeeded | Existing contextual recovery worked | Kept contextual recovery; did not add broad `phone set` Lex synonym |
| Any staff distortion | `63516dc2-dded-4f12-9ff8-a5846e6ce9bf` | Active `staffPreference`, transcript `edit stop if i` | Observed first-available distortions were missing | Added scoped first-available variants and one-question confirmation |
| Past appointment creation | `e28a082f-a59e-4096-915d-0657e40db4e2` | July 12 booking created on July 17 | Past-time validation was too late/missing on some Lambda/API paths | Added Lambda immediate rejection, API pre-create rejection, and transactional create guard |
| Weekday/date conflict | examples in export | `monday july eighteenth`, `monday july third` | Weekday token and explicit date were not compared before commit | Added weekday/date conflict detection and focused clarification |
| Short Full Set silence | around `2026-07-17T11:22Z` | Contact `3a83f992-...` exists, but all-retention Lambda log search found zero events | Likely no Lambda invocation or no captured utterance, not a silent Lambda response | Connect flow drift fixed; nonterminal branches route back to Lex prompt/input |
| Unexpected music | around `2026-07-17T11:28Z` | Contacts `f668...`, `a476...`, `b231...` had no queue/agent info in Connect detail | Queue music exists only in customer queue flow; ordinary AI flow should not enter it | Live AI flow now gates queue transfer only on `transferToQueue=true`; reachability tests pass |

## Drift And Deployment

- Pre-deploy Connect AI flow was live on `2026-07-16-silent-disconnect-latency-any-staff`, confirming deployment drift.
- Post-deploy Connect AI flow is `2026-07-17-thuyet-voice-hotfix`; normalized live hash matches repo: `d2322239169407698806f98515cff736aa0d6f7cf67b07410cea0d7b8b04a64a`.
- Lambda `fastaibooking-booking-handler` now has code SHA `mR66LpeLRmt4CT4LHwxpqQkdizG2ZPtT3TFuF73YWq0=`, revision `72057191-277f-4bf6-8691-98a9ee35de22`.
- Lex production alias `JVIPIZDYE3` now points to bot version `41`; rollback alias version is `40`.
- EC2 production deploy succeeded; API image is `fastaibooking-api:latest@ed3d61707f98`. Admin/app images were unchanged.

## Commit And Push

- Branch: `main`.
- Hotfix commit: `4711ee611453a9c0a887f76d4e22e8b4b6fb9679`.
- Push result: `git push origin main` succeeded to `github.com-sown1606:sown1606/FastAIBookingWeb.git`, advancing `main` from `6c58ee2` to `4711ee6`.
- This report metadata section is committed in a follow-up documentation commit on the same branch; see the terminal summary for the final branch tip.

## Changes

- Lambda/API slot policy now keeps ownership scoped to active slot and strong explicit fields.
- Full Set recovery tiers now include scoped `full jet` while avoiding broad unrelated `jet` phrases.
- Staff recovery covers `edit stop if i`, `any stop if i`, `any stuff is fine`, exact first-available phrases, and older observed variants.
- Date/time safety now rejects past requested times before name collection, before final confirmation/API availability, and inside appointment creation.
- Weekday/date contradictions now ask a clarification instead of committing either date.
- `g p m` is no longer treated as 3 PM; active time slot asks: `What time? You can say 3 PM.`
- Lex Draft/version 41 has updated service/staff slot values, custom vocabulary, slot-value custom vocabulary enabled, and measured slot endpointing values.

## Tests

- `node --check infra/lambda/booking-handler/index.mjs` passed.
- `npm run test:lambda` passed: 153/153.
- `npm run test:api` passed: 299/299.
- `npm run typecheck:api`, `npm run build:api`, `npm run typecheck:admin`, `npm run build:admin`, `npm run typecheck:app`, `npm run build:app`, and `git diff --check` passed.
- Production Lambda probes passed for `full jet`, `edit stop if i`, `at g p m`, weekday/date conflict, and July 12 past-date rejection.

## Real Calls And Cleanup

- The raw `Pasted text(27).txt` file was not present in the workspace, so exact 11-call replay from that file was not measurable; mandatory snippets were covered in deterministic unit/API/Lambda probes.
- I did not run unsupervised repeated outbound PSTN calls because this environment has no audio driver/person to speak the required scenarios into the authorized iPhone. I did verify the existing Connect outbound mechanism and source number.
- No appointment was created by this run through real calls.
- Active/non-terminal appointments for the authorized caller ending `4886` were queried through production Prisma and verified at `0` before and after cleanup.

## ASR And Flow Evidence

- No raw audio was available, so WER and actual ASR confidence are not measurable from available evidence.
- Lex `voiceSettings` and `generativeAISettings` are still `null`; no Neural/VAD promotion was made without PSTN/audio measurement.
- Connect flow logs were empty for the 11:15-11:35 UTC flow window, but Contact Search returned all contacts in that window.
- Lambda all-retention search for `3a83f992-...` returned zero events, supporting “captured by Connect but Lambda not invoked” for the short-turn silence report.
- Queue music prompt `Music_Pop_ThisAndThatIsLife_Inst.wav` exists in the customer queue flow only; ordinary AI flow routes to queue only through explicit transfer attributes.

## Rollback

- Rollback manifest: `docs/report-artifacts/2026-07-17-voice-ai-thuyet-hotfix/rollback-manifest.json` (not committed).
- Previous Lex alias version: `40`.
- Previous Lambda code SHA: `IAyptIk46mywPhEQOW5UJyaPoMdBYAxzkL36uU9Qoes=`.
- Previous Connect AI flow hash: `f442d49c68aa34ec00ec046cc8f73d14d262e4a0a730e64dd272f1efb0288410`.
- Previous API image: `fastaibooking-api:latest@23883d0abb1b`.

## Remaining Risks

- Critical PSTN acceptance twice consecutively is not complete because no controlled speakerphone tester/audio input was available in this execution environment.
- Production salon config still says `Asia/Ho_Chi_Minh` while the salon record is US/Red Bank with +1 848 numbers. I did not change that data blindly; it remains a configuration risk.
- Assisted NLU and Neural/VAD were not promoted because there was no measurable real-audio benchmark in this run.

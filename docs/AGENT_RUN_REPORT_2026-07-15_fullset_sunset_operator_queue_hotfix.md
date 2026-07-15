# FastAIBooking Full Set Sunset and Operator Queue Hotfix - 2026-07-15

## Scope

Production hotfix for the live FastAIBooking call path on July 15, 2026:

- Recover observed PSTN ASR `sunset` / `sun set` as customer-facing `Full Set` only in strong booking/service context.
- Recover truncated `with a` to `Amy` only when exactly one active bookable `A*` staff member matches.
- Preserve grounded booking fields and stop Connect from replaying the generic `Please tell me what you need` prompt after Lambda-owned slot prompts.
- Route explicit human requests and DTMF `0` to the Amazon Connect operator queue without blocking on `NumberOfAgentsAvailable`.
- Record queue state only from provider queue-entry evidence.
- Clarify admin GPT debug export selection copy.

## Real Evidence Inspected

AWS account/profile:

- AWS profile: `nailnew`, region `us-east-1`, account `197452633989`.
- Lambda: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`.
- Lex bot: `KHMIXGA2US`; prod alias: `JVIPIZDYE3`.
- Connect instance: `74f78377-766f-46b7-a745-4bc97b68a8dc`.
- AI Reception flow: `dcccf542-587c-426c-a644-a4c6f24da6e4`.
- Human Escalation flow: `c7386b94-56bb-4382-b517-ee890bbacb51`.
- Customer Queue flow: `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`.
- Operator queue: `d0f2a5d8-e983-4609-9bbc-efb0881a465d`, `FastAIBooking Operator Queue`.
- Phone number: `+18483487681`, phone number id `f2e36faa-5264-4955-8a18-e2f53755c102`.

Production contacts inspected without mutation:

- `99dcfad6-3207-4c98-b49a-7bcd51c9f577`: Lambda/DB showed ASR `sunset today at three p m with a`; booking attempt kept date `2026-07-15` and time `3 PM` but had missing service/staff and asked service.
- `fde8ba7b-5993-4a53-a3e7-c1119e68c83d`: ASR `sunset today at three pm with`; booking attempt kept date/time but asked service and later fell into generic recovery.
- `7649061c-6936-405a-aa38-1abdccf1cf05`: ASR `i want to speak with a person`; HumanEscalationIntent recognized, DB escalation was `PENDING` with `routingOutcome=QUEUED`, `queuedAt=null`, provider evidence `queue=null`, `agent=null`; booking attempt had polluted `requestedStaff=speak person`.
- `d8ad6c44-c784-4335-a319-c74705717123`: DTMF `0` recognized with route `operator_transfer`, confidence `1`; DB escalation had `operator_outcome=AGENTS_BUSY`, no provider queue evidence, and flow disconnected.
- `7163405e-b4e4-4068-9475-12b5f3513890`: control path booked successfully: Manicure, today, 2 PM, Amy, appointment `556824a0-35db-426b-83bb-f70a5b985797`.

Other evidence:

- Active Lex version `33` Full Set synonyms did not include `sunset` or `sun set`.
- Active Human Escalation flow contained `CheckMetricData` with `MetricType=NumberOfAgentsAvailable`.
- Active AI Reception flow normal retry prompt was `Please tell me what you need, or press 0 for a person.`
- Active Customer Queue flow had no queue-entry callback and used 21-second treatment before timeout.
- Queue metrics after deployment showed busy staffed condition: `AGENTS_ONLINE=1`, `AGENTS_AVAILABLE=0`, `AGENTS_STAFFED=1`, `CONTACTS_IN_QUEUE=0`.

## Confirmed Root Causes

1. Live PSTN speech recognition converted `Full Set` to `sunset`; active Lambda/API/Lex version `33` did not safely recover that transcript.
2. Previous validation relied too heavily on typed Lex/direct Lambda paths and did not exercise the PSTN ASR behavior that produced `sunset` and truncated `Amy` to `a` or bare `with`.
3. Human Escalation used `NumberOfAgentsAvailable` as a transfer gate, so a staffed-but-busy operator was treated as unavailable instead of queueable.
4. App data could show `routingOutcome=QUEUED` while Connect provider evidence had no queue/agent and the contact ended by flow disconnect.
5. Human escalation phrases polluted booking fields, including `requestedStaff=speak person`.
6. Connect normal continuation could replay the generic request prompt after Lambda had already grounded fields and asked for only the missing slot.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.routes.ts`
- `apps/api/src/modules/call-center/call-center.service.ts`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/connect/contact-flows/human-escalation.json`
- `infra/aws/connect/contact-flows/customer-queue-timeout.json`
- `apps/admin/src/components/debug-bulk-actions.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `docs/AGENT_RUN_REPORT_2026-07-15_fullset_sunset_operator_queue_hotfix.md`

## Implementation Summary

- Added guarded `sunset` / `sun set` correction to `Full Set` only in service/booking context and only when no active exact configured `Sunset` service exists.
- Added exact configured dynamic service preservation so `Sunset` remains `Sunset` if configured.
- Added unique one-letter staff prefix recovery for explicit `with <letter>` context.
- Reset service recognition failure state and cleared stale service DTMF state after successful service correction.
- Propagated Lambda-owned continuation prompt to Connect via `connectContinuationPrompt`.
- Removed `NumberOfAgentsAvailable` gate from Human Escalation flow.
- Added provider queue-entry callback outcome `AMAZON_CONNECT_ENQUEUED`; kept transfer requests `PENDING` until provider queue evidence.
- Added queue timeout/capacity/error outcomes and complete `Goodbye` timeout message.
- Cleared booking-only fields for explicit human escalation and DTMF operator routes.
- Updated admin export copy to show selection status and canonical call bundle note.

## Automated Regression Cases

Covered by focused Lambda/API tests:

1. `sunset today at three p m with a`: `Full Set`, today, 3 PM, Amy when unique `A*`, final confirmation path, no service loop.
2. `sunset today at three pm with`: service/date/time preserved, asks only staff.
3. `sunset` with `lastAskedSlot=serviceName`: resolves `Full Set`.
4. `The sunset is beautiful`: does not resolve nail service.
5. Active configured service `Sunset`: exact configured service wins.
6. Repeated observed transcript: no generic loop, no duplicate appointment/log/session.
7. `I want to speak with a person`: no fake service/staff, one transition prompt, transfer attributes set.
8. DTMF `0`: same operator route.
9. Busy staffed operator: pending queue transfer instead of immediate busy disconnect.
10. Transfer request without provider queue-entry evidence: not marked successfully queued.
11. Provider queue-entry callback: transitions to `QUEUED` exactly once and preserves `queuedAt`.
12. Queue timeout: closes exactly once with complete caller message.

## Commands and Results

Automated tests and checks:

- `npm run test:lambda`: pass, 131/131.
- `npm run test:api`: pass, 272/272.
- `git diff --check`: pass.
- `npm run typecheck:api`: pass.
- `npm run typecheck:admin`: pass.
- `npm run typecheck:app`: pass.
- `npm run build:api`: pass.
- `npm run build:admin`: pass, Vite large chunk warning only.
- `npm run build:app`: pass, Vite large chunk warning only.

Production deploy and health:

- `npm run deploy:ec2`: success; no pending Prisma migrations; API healthy; nginx config test successful.
- Docker image hashes from EC2 deploy:
  - API: `sha256:23ad98f6571eb1a811622bebfc5c604d2547ef9256f48ff5d59b0f66425006f7`
  - Admin: `sha256:1fe49edbe0b06dcfe4de186b1cf05da88d6e2eb87f45002d131d50bb4d7bf006`
  - App: `sha256:74798a87217d0b3c3105c3fc1b133ec06a9c0cf69358de2e448dfb15591bfe23`
- `./infra/scripts/smoke_test_production.sh`: pass; admin/app 200, API liveness/readiness 200.

Lex runtime:

- Active typed alias runtime on `JVIPIZDYE3` version `34`, text `sunset today at three p m with a`: reached `BookAppointmentIntent` final confirmation with `serviceName=Full Set`, `requestedDate=2026-07-15`, `requestedTime=3 PM`, `staffPreference=Amy`, `staffId=e75b9b6d-ad6a-4060-b945-43f1358e3a79`; no generic prompt.
- Active typed alias runtime on `JVIPIZDYE3` version `34`, text `I want to speak with a person.`: top intent `HumanEscalationIntent`; message exactly `Let me check for an available operator.`; `transferToQueue=true`, `forceHumanEscalation=true`, `operatorQueueOutcome=AGENTS_BUSY`; no booking field pollution.
- AWS Polly audio generation was blocked by IAM: `AccessDeniedException` on `polly:SynthesizeSpeech`.
- Local audio fixtures were generated with `say` and converted to 16 kHz mono PCM with `ffmpeg`; Lex `recognize-utterance` rejected this bot/alias with `ValidationException: RecognizeUtterance operation is not supported for speech-to-speech models`.
- Because Lex audio runtime rejected `recognize-utterance`, no successful audio-input Lex runtime result is claimed.

Synthetic cleanup:

- Synthetic runtime contact IDs created successfully: `bd0e6807-f5eb-48f8-acb2-2893a2af1868`, `90657fa8-9b0b-47dc-a94b-9ca42eda5790`.
- Verified no appointment IDs on synthetic booking attempts.
- Deleted only synthetic rows: 2 `AIInteractionLog`, 2 `BookingAttempt`, 2 `CallTranscript`, 0 `CallEvent`, 2 `CallSession`.
- Post-cleanup counts for those IDs: `CallSession=0`, `BookingAttempt=0`, `AIInteractionLog=0`, `CallEscalation=0`.
- Verified no synthetic `Customer` rows for `+1555071500%`.

## AWS Before and After

Lambda `fastaibooking-booking-handler`:

- Before: LastModified `2026-07-15T07:06:32.000+0000`, RevisionId `06c97734-9307-48e9-b30b-c1670426867a`, CodeSha256 `3qMPGC9oV5S7VLBxrW7aMAA0q+/CCemuHyXKviwT0NI=`.
- Package zip SHA256: `7c09510c023353d30dfc3135dbe09711583e9a1d7d68c116655bf786518269e6`.
- After: LastModified `2026-07-15T12:37:41.000+0000`, RevisionId `5e6ec6dd-e9f5-496c-ba0d-eed570e94bd4`, CodeSha256 `fAlRDAIzU9MN/DE12+CXEVg+mh19aMEWZVv3hlGCaeY=`, State `Active`, LastUpdateStatus `Successful`.
- Lambda source `infra/lambda/booking-handler/index.mjs` SHA256: `59b4666cd0f61708410a773d51a8cd8b419e812fbb37487cf45c040ac4debe2d`.

Lex:

- Before prod alias `JVIPIZDYE3`: bot version `33`, status `Available`.
- Draft slot type `CRPHEOWTHG` updated at `2026-07-15T08:39:20.491-04:00`.
- New bot version: `34`, status `Available`; locale `en_US` status `Built`.
- After prod alias `JVIPIZDYE3`: bot version `34`, status `Available`, `en_US.enabled=true`, Lambda hook `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`.
- Active version `34` `NailServiceType` Full Set synonyms include `sunset` and `sun set`.
- Lex slot source SHA256: `154f37aa5e676934d2b4cb2259f556cd72391d23ce537215ecfeb030d029c993`.

Connect normalized active content hashes:

- AI Reception `dcccf542-587c-426c-a644-a4c6f24da6e4`: before `bd37200c5dabcc47776610ad30c4458c26b0bb904bb89614172401e3b1ee6d28`; after `f52fc8c0b3622010c20f05ac775a5b98239b8571407ee5cb2f345c3cd43336e1`; active matches local.
- Human Escalation `c7386b94-56bb-4382-b517-ee890bbacb51`: before `89e0b4a3c8a054dd7e75d93fd4a978778d1b3283a2b27159fc2c35e0e51f58ab`; after `0abfcf1fae8ca30874a307bab6e9b1d6dae72120fe3fff1d7793210ad1672d9a`; active matches local.
- Customer Queue `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`: before `641a972c3919d36d874a92a78c93e8eb9d6e1c7a870263859e9bc12b08e0ccda`; after `723ffce414659ef919ab710a0603c36f28cca277d7021d9bcba5893d07b2cfd2`; active matches local.

Phone/queue:

- `+18483487681` remains claimed to Connect instance `74f78377-766f-46b7-a745-4bc97b68a8dc`.
- CLI-visible phone APIs do not expose inbound contact-flow association; active AI Reception flow remains `ACTIVE`/`PUBLISHED` and still references Lex alias `KHMIXGA2US/JVIPIZDYE3`.
- Operator queue `d0f2a5d8-e983-4609-9bbc-efb0881a465d` remains `ENABLED`.

## Remaining Limitations

- I could not originate an actual PSTN call automatically from this environment.
- AWS Polly audio generation was denied by IAM.
- Lex `recognize-utterance` audio runtime was attempted with local PCM fixtures but rejected by Lex for this bot/alias with `RecognizeUtterance operation is not supported for speech-to-speech models`.
- Therefore, deployment success is supported by automated tests, active typed Lex runtime, deployed Connect source/hash verification, queue metrics, and production health checks, but not by a completed audio-input Lex runtime or PSTN call.

## Rollback Steps

1. Repoint Lex alias `JVIPIZDYE3` from version `34` back to version `33`, restoring `en_US` locale settings and Lambda hook:
   `aws lexv2-models update-bot-alias --bot-id KHMIXGA2US --bot-alias-id JVIPIZDYE3 --bot-alias-name prod --bot-version 33 --bot-alias-locale-settings '{"en_US":{"enabled":true,"codeHookSpecification":{"lambdaCodeHook":{"lambdaARN":"arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler","codeHookInterfaceVersion":"1.0"}}}}'`
2. Restore Lambda package with previous code hash `3qMPGC9oV5S7VLBxrW7aMAA0q+/CCemuHyXKviwT0NI=` from the previous deployment artifact or source checkout, then wait for `function-updated`.
3. Reapply previous Connect flow content if needed using the before hashes listed above as verification targets.
4. Redeploy EC2 from the previous known-good commit and run `./infra/scripts/smoke_test_production.sh`.

## Commit and Push

- Commit SHA: filled in final response after commit creation. The exact SHA cannot be embedded in this committed file without changing the SHA.
- Push result: filled in final response after `git push origin main`.

## Tester Acceptance Cases for Thuyet

1. `Full Set today at 3 PM with Amy.`
   Expected: confirm Full Set, today, 3 PM, Amy; no service re-ask.
2. Repeat the same sentence twice.
   Expected: no `Please tell me what you need` loop and no lost fields.
3. `Full Set today at 3 PM with any staff.`
   Expected: eligible staff chosen, then one final confirmation.
4. `I want to speak with a person.`
   Expected: one transition prompt, then queue/hold music.
5. Press `0` during the greeting.
   Expected: same queue/hold behavior.
6. Press `0` during the service prompt.
   Expected: same queue/hold behavior.
7. Keep an operator busy on another call, then request a person.
   Expected: caller waits in queue instead of immediate disconnect.
8. Let the queue time out.
   Expected: one complete polite timeout message and then clean disconnect, not a cut-off sentence.

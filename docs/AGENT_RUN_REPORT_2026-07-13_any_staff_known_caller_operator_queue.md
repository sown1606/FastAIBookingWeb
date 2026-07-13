# Agent Run Report: Any Staff, Known Caller, Operator Queue

Date: 2026-07-13
Branch: main
AWS profile/region: nailnew / us-east-1

## 1. Root Causes

1. Any staff recognition was too narrow. Live ASR variants such as `any stop`, `any stop if i`, and the first-available transcript `available` were not recognized in the staff-selection context.
2. Invalid raw staff text was preserved as trusted state. `anystop` could survive as `staffPreference` and `requestedStaff`, causing repeated technician-not-found prompts.
3. Known caller lookup ran after missing-slot selection on initial booking turns, so a known caller could be asked for a name before the lookup result was applied.
4. `3 PM` heard as `g p s` was not recovered by the time normalizers, so a complete utterance was treated as missing time.
5. Operator escalation had two spoken owners for the transition prompt: Lambda/API and the Connect Human Escalation contact flow.
6. Operator availability used database assignment state only. That proved that an operator queue was configured, not that an Amazon Connect agent was logged in or available.
7. The customer queue flow could keep callers in queue treatment without a bounded wait fallback.
8. Escalations could remain `QUEUED` when the no-agent or timeout outcome was already known by the Connect flow.

## 2. Production Calls And Transcripts

Supplied Any staff call:

- Call session: `e4608a2c-c64d-43cb-8d17-f1b70935e779`
- Amazon Connect ContactId: `7019d2a5-08eb-4b62-9f88-d3469700bd3b`
- Initial ASR: `i want to book a pedicure tomorrow afternoon any time is fine`
- Staff-prompt ASR: `any stop`, `any stop`, `any stop if i`
- Bad state before fix: `staffPreference = anystop`, `requestedStaff = anystop`

Supplied Full Set time call:

- Call session: `bcfd7284-08e3-435a-8fd4-9817d55ef1ec`
- Amazon Connect ContactId: `f57e2649-452b-48de-9679-ad746eda5c1b`
- ASR: `book full set tomorrow at g p s with chang`
- Correctly resolved before fix: `Full Set`, `tomorrow`, `Trang`
- Missing before fix: `3 PM`

Investigated 16:30 Vietnam first-available call:

- Search window: `2026-07-13T09:25:00Z` through `2026-07-13T09:35:00Z`
- Production DB result for phone/time window: no persisted call session row found
- CloudWatch ContactId found: `0bfa8ea8-87e0-4436-9c66-13687d5cad93`
- Exact ASR at `2026-07-13T09:30:10Z`: `available`
- Context: `lastAskedSlotBefore = staffPreference`, `activeDtmfMenuBefore = staff`
- Original/interpreted staff slot: `available`
- Root cause: `available` alone was not accepted as first-available unless the phrase contained a broader existing alias. It is now accepted only in staff-selection context.

## 3. Any Staff Alias Policy

Canonical value: `Any staff`

Grounded aliases accepted:

- `any staff`
- `any technician`
- `any tech`
- `anyone`
- `anybody`
- `first available`
- `the first available`
- `first avaiable`
- `for available`
- `whoever is available`
- `no preference`
- `no staff preference`

Additional production/context aliases accepted only in staff-selection context:

- `any stop`
- `anystop`
- `any stop if i`
- `any stuff`
- `any stuff is fine`
- `any star`
- `any star is fine`
- `available`

Staff-selection context means `lastAskedSlot = staffPreference`, `activeDtmfMenu = staff`, explicit staff/technician language, or a grounded first-available/any-staff phrase in the booking utterance.

Negative guard: `any time is fine` is not converted to `Any staff` unless there is separate grounded staff language.

## 4. Stale Staff Cleanup

Unmatched staff utterances are no longer trusted. The Lambda and API now clear:

- `staffPreference`
- `staffId`
- `selectedStaffId`
- `confirmedStaffId`
- `confirmedStaffName`

Raw unmatched text may be retained only as `unrecognizedStaffUtterance`. It is not published as caller-facing `requestedStaff`.

When Any staff is recognized, the system sets:

- `staffPreference = Any staff`
- `staffResolution.status = explicit_any`

Specific staff IDs are cleared and `staffRecognitionFailureCount`, `invalidStaffPreferenceIgnored`, and `discardedStaleStaff` are reset.

## 5. Known Caller Lookup Timing

Lookup now runs before initial missing-slot selection. On a match it seeds:

- `customerId`
- `recognizedCustomerId`
- `customerName`
- `recognizedCustomerName`
- `customerNameSource = phone_lookup`
- `customerProfileSource = active_customer`
- `knownCallerLookupAttempted = true`
- `knownCallerLookupStatus = FOUND`

Lookup is cached per call with `FOUND`, `NOT_FOUND`, or `ERROR`, so the customer table is not queried every turn. Lookup failures do not delete captured booking fields.

Production note: the historical `+84798171999` customer rows currently visible in production are soft-deleted, so live lookup for that exact phone now returns `NOT_FOUND`. The code path was verified against an active production customer and by regression tests.

## 6. `g p s` Time Normalization

The observed forms are recovered as `3 PM` only in strong time context:

- `at g p s`
- `at g p`
- `g p s`
- `g p`

Allowed contexts:

- `lastAskedSlot = requestedTime`
- the phrase follows `at` in a booking utterance
- the turn is classified as a time request

Negative guard: generic `GPS`, `GP`, or unrelated text such as `Tell me about GPS` is not converted to `3 PM`.

## 7. Operator Prompt Ownership

Lambda/API now owns the single transition prompt:

`Let me check for an available operator.`

The duplicate `Please wait while I connect you.` `MessageParticipant` block was removed from the Human Escalation contact flow. `press 0`, `operator`, `representative`, `human agent`, and voice HumanEscalationIntent paths share the same behavior.

## 8. Real-Time Staffing Implementation

The API attempts Amazon Connect current metrics for:

- `AGENTS_STAFFED`
- `AGENTS_AVAILABLE`
- `AGENTS_ONLINE`

Production EC2 currently cannot load AWS credentials for this SDK call, so the API records `CONNECT_METRICS_DEFERRED_TO_CONNECT_FLOW` and lets the deployed Connect flow make the authoritative live decision.

The Human Escalation contact flow now performs an Amazon Connect `CheckMetricData` gate using `NumberOfAgentsAvailable` on queue `d0f2a5d8-e983-4609-9bbc-efb0881a465d`.

No available agents branch:

1. Do not transfer to queue.
2. Invoke Lambda with `fastAiOperatorQueueOutcome = AGENTS_UNAVAILABLE`.
3. Say exactly once: `All of our operators are currently busy. Please call back later.`
4. Disconnect.

Available agent branch:

1. Set the customer queue flow.
2. Transfer to the operator queue.
3. Do not repeat the wait prompt.

## 9. Queue Maximum Wait

The active customer queue flow `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b` was updated to a bounded queue treatment. The current timeout is approximately 21 seconds. On timeout or flow error, it invokes Lambda with `fastAiOperatorQueueOutcome = QUEUE_WAIT_TIMEOUT`, says the exact busy fallback once, and disconnects.

## 10. Escalation Persistence

Connect callback outcomes close the existing escalation for the call session instead of leaving it queued:

- `status = CLOSED`
- `routingOutcome = CALL_CENTER_ESCALATION`
- `metadata.operatorQueueOutcome = AGENTS_UNAVAILABLE`, `AGENTS_BUSY`, `QUEUE_WAIT_TIMEOUT`, or `CONNECT_FLOW_ERROR`
- call session `finalResolution = All of our operators are currently busy. Please call back later.`

The API keeps one escalation record per call session. No callback request, SMS fallback, or voicemail is created by this fix.

## 11. Connect Flow Exports And Hashes

Rollback/export artifacts were saved under:

`docs/report-artifacts/2026-07-13-any-staff-known-caller-operator-queue/`

Active flow IDs:

- AI Reception: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Human Escalation: `c7386b94-56bb-4382-b517-ee890bbacb51`
- Customer queue flow: `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`

Old content hashes:

- AI Reception: `7e48a7b648636e34cb75888bb4e034baf4b5455a4a8e9035885f8a0545ca39c0`
- Human Escalation: `61b1376244fd725db6e940c3e69d6de748fc8a936789078cd4c28e6d4278f84c`
- Customer queue: `6851ea87ca56cc4f6bdf1405ccfd0a540e60723aa1f36c7d5ca6ee404ab1436e`

New content hashes:

- AI Reception: `022aeea11349b75198c45dbf46451bcc4744be8318947754e71aea406a7d1b22`
- Human Escalation: `a95a238504dc49f98a7a261b63aaae281dffbc61d855021d44fc3e765f57730e`
- Customer queue: `795c83d07816ab31bffbb6ad6fb428b27508e0eca4fbf26095c234e8d4a10e29`

Source JSON and active AWS content matched after deployment.

## 12. Lambda Deployment

Function: `fastaibooking-booking-handler`

Before:

- RevisionId: `e37e66c0-259c-415d-bb62-fb6828792613`
- CodeSha256: `wTDtzsPGzHFnWhK6Vs0quDo98CMceIgWAEKY/KHxv+Q=`
- LastModified: `2026-07-13T06:46:11.000+0000`
- LastUpdateStatus: `Successful`

After:

- RevisionId: `328542d3-9809-431c-9154-a124671649d4`
- CodeSha256: `MeGgCxqBtsJJOeHRqzhFo723+6sVSkKyF66ilDzeT4M=`
- LastModified: `2026-07-13T11:36:27.000+0000`
- LastUpdateStatus: `Successful`

## 13. Lex Status

Bot ID: `KHMIXGA2US`
Prod alias ID: `JVIPIZDYE3`
Prod bot version: `31`
Alias status: `Available`
Lambda hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`

No new Lex version was created. Lambda/API ASR normalization was sufficient. Local Lex export prompt text was updated for source consistency.

## 14. API Deployment

`npm run deploy:ec2` completed. The production smoke script passed after deployment.

## 15. Validation Commands

Passed:

- `node --check infra/lambda/booking-handler/index.mjs`
- `npm run test:lambda`: 108 passed
- `npm run test:api`: 198 passed
- `npm run typecheck:api`
- `npm run typecheck:app`
- `npm run typecheck:admin`
- `npm run build:api`
- `npm run build:app`
- `npm run build:admin`
- `npm test`: 306 passed total
- `git diff --check`

Vite build emitted existing chunk-size warnings only.

## 16. Synthetic Smoke Results

Smoke A, Any staff ASR:

- Staff-context input `any stop`
- Result: `staffResolution.status = explicit_any`, confirmation path, no technician-not-found loop

Smoke B, first available:

- Exact discovered ASR `available`
- Context: staff prompt/menu
- Result: canonical `Any staff`

Smoke C, known caller:

- Active production known-caller fixture resolved before the first missing-slot prompt
- Result: no name question; flow asked the next actual missing booking field

Smoke D, Full Set time:

- Input: `book full set tomorrow at g p s with chang`
- Result: `Full Set`, `2026-07-14`, `3 PM`, `Trang`; no name or time prompt for an active known caller

Smoke E, operator unavailable:

- Synthetic Connect callback for `QUEUE_WAIT_TIMEOUT` closed the existing escalation and set the busy final resolution.
- No appointment was created.

Smoke F, operator available:

- Current live queue metrics observed: `AGENTS_STAFFED = 1`, `AGENTS_AVAILABLE = 1`, `AGENTS_ONLINE = 1`
- Synthetic Lambda/API escalation returned one transition prompt and one queue-transfer path.

## 17. Real Connect Smoke Results

Real Connect flow deployment was verified by exporting active AWS content after update and comparing hashes to source. The live queue was staffed and available at the final check.

No real no-agent PSTN call was executed because there was no controlled zero-agent Connect state available. No controlled logged-in-agent live call was executed in this run. The deployed Connect flow contains the live `CheckMetricData` gate and bounded queue timeout, and synthetic Lambda/API callbacks verified the persistence behavior.

## 18. Cleanup

No synthetic appointment reached explicit confirmation, so no appointment cleanup was required. Synthetic call sessions and escalation callback records used unique synthetic ContactIds. Rollback copies remain in the report artifacts directory and were not staged as source.

## 19. Remaining Risks

1. The production EC2 API runtime currently lacks usable AWS credentials for direct Connect current metrics. The deployed Connect flow is therefore the authoritative real-time gate in production.
2. The historical caller phone from the incident currently maps only to soft-deleted customer rows, so exact-phone live lookup now returns `NOT_FOUND`.
3. A real PSTN no-agent smoke and a real controlled logged-in-agent smoke should be run when agent state can be controlled.

## 20. Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.routes.ts`
- `apps/api/src/modules/call-center/call-center.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/package.json`
- `package-lock.json`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/connect/contact-flows/human-escalation.json`
- `infra/aws/connect/contact-flows/customer-queue-timeout.json`
- `infra/aws/lex/FastAIBookingBot-v7/BotLocales/en_US/Intents/HumanEscalationIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v8/BotLocales/en_US/Intents/HumanEscalationIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/HumanEscalationIntent/Intent.json`
- `docs/AGENT_RUN_REPORT_2026-07-13_any_staff_known_caller_operator_queue.md`

## 21. Git

Commit message: `fix: stabilize any staff and operator availability flow`

This report is part of the fix commit, so the exact final commit hash and push result are recorded in the final operator response after commit creation and push.

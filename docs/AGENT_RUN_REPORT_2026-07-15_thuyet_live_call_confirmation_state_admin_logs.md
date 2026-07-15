# Agent Run Report: Thuyet Live Call Confirmation, State, and Admin Logs

Date: 2026-07-15
Repository: FastAIBooking
Branch: `main`
Salon: `Kiet Nails & Beauty`
Salon ID: `9bd14a12-85ed-418a-af7d-3f5cb329c147`
Called number: `+18483487681`
AWS region: `us-east-1`

## Scope

Fixed the July 15 live-call issues around DTMF/speech coexistence, final confirmation capture, stale turn state, observed ASR variants, duplicate terminal goodbye, admin log canonicalization, Smoke Test defaults, and provider timing diagnostics. Changes were limited to the Lambda voice handler, API AI/call/admin services, admin log UI defaults, Lex service slot synonyms, and the active Connect terminal branch.

## Production Evidence

Affected contacts inspected before code changes:

| Case | CallSession | ContactId | Provider initiated UTC | Provider disconnected UTC | Finding |
| --- | --- | --- | --- | --- | --- |
| A | `2ad84bdb-c345-4bdb-a855-7a292e65f916` | `f0d6b6d6-6b32-440c-9a46-9fa71f48a983` | `2026-07-15T00:16:27.127Z` | `2026-07-15T00:19:33.506Z` | Final confirmation asked, spoken yes not captured; app stayed in confirmation-required state. |
| B | `9e4ee876-0e23-4096-bf04-08ee66cad216` | `14980dd0-c06f-4911-8ff9-9bfddb40d9b3` | `2026-07-15T00:22:02.900Z` | `2026-07-15T00:23:15.678Z` | `fun fact(s)` did not resolve to `Full Set`; caller used DTMF 3; terminal thank-you was audible twice. |
| C | `10d3519f-7643-44d4-b47a-ef901cc8b96d` | `81108a3d-4890-4ae0-b7f5-b08f73a4d7c5` | `2026-07-15T00:23:32.288Z` | `2026-07-15T00:24:37.289Z` | `pay the bill today at two p m with any stop` did not resolve all grounded booking fields. |
| D/E | `6fd0a7dc-a7b2-4bbb-9cbd-90bdcd4185b5` | `8fabe13c-c6b6-478d-8ac5-a1d55fb16665` | `2026-07-15T00:26:25.092Z` | `2026-07-15T00:28:04.846Z` | Spoken `manicure` was accepted while service DTMF was active, then a later stale digit changed the service to Pedicure. |

Amazon Connect `describe-contact` returned `DisconnectReason = null` for these contacts; the flow trace evidence came from the active flow graph and CloudWatch/Lambda logs saved under `docs/report-artifacts/2026-07-15-thuyet-live-call-confirmation-state-admin-logs/`.

## Root Causes

1. Final confirmation used mixed architecture: API/Lambda emitted `ConfirmIntent`, but the active Lex `BookAppointmentIntent` had `intentConfirmationSetting: null`. Lex did not reliably capture spoken confirmation turns in that state.
2. DTMF routing used stale `lastAskedSlot` as a fallback even when `activeDtmfMenu` had been cleared. A delayed digit event could therefore reinterpret the old service menu after spoken service input already closed it.
3. The observed service ASR variants were missing from active layers: `fun fact(s)` for `Full Set` and `pay the bill` for `Pedicure` were absent from the Lambda normalizer/API resolver/Lex service slot type.
4. Contextual Any Staff matching handled exact aliases but not full booking sentences containing `with any stop`.
5. The active Connect flow had two reachable consecutive terminal messages: the booking thank-you node chained into `transfer-return-goodbye`.
6. Provider call timing used first application/Lex turn as `startedAt`; reconciliation only targeted in-progress rows and did not preserve terminal statuses while filling provider timestamps.
7. Admin AI Logs grouped raw rows after pagination, so legacy duplicate AI rows could appear as separate visible records. Smoke Test records were hidden by default in both admin log pages.

## Files Inspected

Key files inspected:

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.routes.ts`
- `apps/api/src/modules/calls/calls.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/modules/admin/admin-debug-export.service.ts`
- `apps/admin/src/pages/calls-page.tsx`
- `apps/admin/src/pages/ai-logs-page.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/role-guards.test.ts`
- `apps/api/test/ui-source-contracts.test.ts`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.routes.ts`
- `apps/api/src/modules/calls/calls.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/modules/admin/admin-debug-export.service.ts`
- `apps/admin/src/pages/calls-page.tsx`
- `apps/admin/src/pages/ai-logs-page.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/role-guards.test.ts`
- `apps/api/test/ui-source-contracts.test.ts`

No database migration was required.

## State and Idempotency Design

- Confirmation is now application-owned. Final confirmation prompts use nonterminal `ElicitIntent`, not native Lex `ConfirmIntent`.
- Accepted confirmation phrases now include `yes`, `yeah`, `yep`, `correct`, `right`, `confirm`, `confirmed`, `go ahead`, `book it`, `that is correct`, `sure`, `ok`, and context-appropriate `okay`.
- Duplicate affirmative events reuse existing appointment creation safeguards and do not create another appointment.
- Empty/no-input confirmation turns reprompt and keep `conversationComplete=false`.
- Lambda writes `providerTurnId`, `lexRequestId`, `turnSequence`, and `lastProviderTurnId` diagnostics into session attributes and logs.
- Bare keypad digits now route only through the active DTMF menu. Speech such as `manicure`, `pedicure`, or `full set` is handled as speech and closes the matching menu.
- A current-turn service answer while `activeDtmfMenu=service` clears the service menu and stale service digit attributes while preserving date/time/staff/customer/exclusions.
- Current-turn booking utterances attempt to extract service, date, time, staff preference, specific staff, and staff exclusions together instead of only the currently elicited slot.

## Voice Recognition Changes

- `fun fact` and `fun facts` resolve to `Full Set` only in service or booking context.
- `pay the bill` resolves to `Pedicure` only in service or booking context.
- Customer-facing service name remains exactly `Full Set`.
- Active exact service matches still win over guarded ASR corrections.
- `with any stop` and related contextual Any Staff phrases are recognized inside full booking sentences, but not outside staff/booking context.
- Lex production service slot type was updated with `pay the bill`, `fun fact`, and `fun facts` synonyms.

## Connect Flow Change

Before: terminal booking thank-you node `67ada978-600a-4d39-9965-6230c52810a9` routed to `transfer-return-goodbye`, causing a second equivalent goodbye.

After: the terminal thank-you node routes directly to `DisconnectParticipant` action `ef8d8054-77ea-40c7-aa4e-800ed784c49c`. The `transfer-return-goodbye` node remains for transfer-return paths only.

## Admin Logs and Export Changes

- Admin Call Logs and AI Logs now default `includeSynthetic=true`.
- UI checkbox label is `Show Smoke Tests` in English and `Hiển thị Smoke Tests` in Vietnamese.
- Admin API query schemas default to `includeSynthetic=true`; users can explicitly pass `false` to hide Smoke Tests.
- AI Logs canonical grouping/deduplication now happens before pagination. `pagination.total` represents canonical calls, not raw AIInteraction rows.
- Call Logs and AI Logs debug exports resolve to equivalent canonical call bundles for the same call.
- GPT debug exports now include compact provider timing, provider turn ID, Lex request ID, turn sequence, latency placeholders/limitations, final branch diagnostics, Lex no-input/no-match/error diagnostics, and stale/duplicate rejection reason fields.

## Provider Timing

Call reconciliation now:

- Uses Amazon Connect `InitiationTimestamp` as `startedAt` when available.
- Uses `DisconnectTimestamp` as `endedAt`.
- Recomputes `durationSeconds` from provider timestamps.
- Stores `rawPayload.providerTiming` with `source=amazon_connect_describe_contact`, provider initiated/disconnected timestamps, application first-seen timestamp, and limitations.
- Does not downgrade terminal call statuses back to `IN_PROGRESS`.
- Leaves `answeredAt=null` because `describe-contact` does not provide a trustworthy answer timestamp for these calls.

Production reconciliation verification after deployment:

| ContactId | Status | startedAt UTC | endedAt UTC | durationSeconds | applicationFirstSeen |
| --- | --- | --- | --- | ---: | --- |
| `14980dd0-c06f-4911-8ff9-9bfddb40d9b3` | `COMPLETED` | `2026-07-15T00:22:02.900Z` | `2026-07-15T00:23:15.678Z` | 73 | `2026-07-15T00:22:14.596Z` |
| `81108a3d-4890-4ae0-b7f5-b08f73a4d7c5` | `COMPLETED` | `2026-07-15T00:23:32.288Z` | `2026-07-15T00:24:37.289Z` | 65 | `2026-07-15T00:23:49.187Z` |
| `8fabe13c-c6b6-478d-8ac5-a1d55fb16665` | `COMPLETED` | `2026-07-15T00:26:25.092Z` | `2026-07-15T00:28:04.846Z` | 100 | `2026-07-15T00:26:41.484Z` |
| `f0d6b6d6-6b32-440c-9a46-9fa71f48a983` | `COMPLETED` | `2026-07-15T00:16:27.127Z` | `2026-07-15T00:19:33.506Z` | 186 | `2026-07-15T00:16:51.368Z` |

## AWS Before and After

Lambda `fastaibooking-booking-handler`:

- Before CodeSha256: `ThAinKBwyK/n1rI9giHkspSDDGfOOs8mmdYFkJxYxyg=`
- After CodeSha256: `OKrUA23kxvYWWLqX2NTxCjMw2C6L9yX3cJz9iPJesUQ=`
- After state/update: `Active` / `Successful`

Lex:

- Bot: `KHMIXGA2US`
- Alias: `JVIPIZDYE3` (`prod`)
- Before version: `31`
- After version: `32`
- After status: `Available`

Amazon Connect:

- Instance: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Phone number ID: `f2e36faa-5264-4955-8a18-e2f53755c102`
- Active flow ID: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Phone number flow association after deploy:
  `arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc/contact-flow/dcccf542-587c-426c-a644-a4c6f24da6e4`
- Final normalized source hash: `d29c79777cc87ce84bf42ad555333c4a5d43339cc96cb3c5f8ff680896493652`
- Final normalized active hash: `d29c79777cc87ce84bf42ad555333c4a5d43339cc96cb3c5f8ff680896493652`

API/admin/app:

- Deployed through `npm run deploy:ec2`.
- Final API image SHA from deploy output: `376519df8e6d3bb6c24e24e91e11fb28d7135e3972546a1620f74989dd29fb56`
- Health:
  - `/health/liveness`: `ok`
  - `/health/readiness`: `ready`

## Production Smoke Results

Production-shaped Lambda smokes were run against the deployed Lambda with synthetic `codex-20260715-live-*` ContactIds and then cleaned up.

| Phrase | Result |
| --- | --- |
| `Pedicure` | Accepted as `Pedicure`, asked for date, no service DTMF fallback. |
| `Full Set today at 2 PM with Amy` | Reached app-owned final confirmation with `ElicitIntent`. |
| `Yes` | Created exactly one Full Set appointment for the synthetic contact, then closed. |
| `fun facts today at two p m with amy` | Resolved service to `Full Set`; no customer-facing rename. |
| `Pedicure today at 2 PM with any staff` | Resolved Pedicure/date/time/Any Staff to eligible staff and asked final confirmation. |
| `pay the bill today at two p m with any stop` | Resolved Pedicure/today/2 PM/Any Staff and asked final confirmation. |
| `I want to book today at 2 PM with Amy` | Retained date/time/staff and asked only for service with service DTMF active. |
| `Manicure` after service menu | Accepted spoken `Manicure`, retained date/time/staff, and closed the service DTMF menu. |
| `0` | Routed only through explicit operator transfer path with `transferToQueue=true`; no automatic transfer from merely mentioning 0. |

Final smoke summary artifact: `production-smoke-summary-final.json`.

## Debug Export Verification

Generated GPT export samples from both Call Logs and AI Logs for call `2ad84bdb-c345-4bdb-a855-7a292e65f916`.

- Call Logs GPT export: schema version 2, 1 canonical record, 22,394 bytes.
- AI Logs GPT export: schema version 2, 1 canonical record, 22,437 bytes.
- Both exports resolve to the same canonical CallSession.
- Coverage: `applicationSessionFound=true`, `providerContactFound=true`, `providerTraceFound=true`.
- Provider timing included `providerInitiatedAt=2026-07-15T00:16:27.127Z`, `providerDisconnectedAt=2026-07-15T00:19:33.506Z`, and `applicationFirstSeenAt=2026-07-15T00:16:51.368Z`.
- Turn snapshots include `providerTurnId`, `lexRequestId`, `turnSequence`, `latencyMetrics`, `stateVersion`, `lexDiagnostics`, and `staleOrDuplicateRejectionReason`.

## Canonical Counts

For the four real July 15 evidence contacts:

- CallSessions found: 4
- AIInteractionLog rows found: 4
- BookingAttempts found: 5
- Each real contact has exactly one CallSession and exactly one aggregated AI log row.

After cleanup:

- Remaining `codex-20260715-live-*` CallSessions: 0
- Remaining `codex-*` CallSessions: 0

## Synthetic Cleanup

Only records with clearly synthetic `codex-20260715-live-*` provider IDs and the synthetic smoke phone/name were deleted.

First cleanup:

- Deleted 7 CallSessions
- Deleted 7 AIInteractionLog rows
- Deleted 7 BookingAttempt rows
- Deleted 9 CallTranscript rows
- Deleted 1 CallEscalation row
- Deleted 1 synthetic Appointment
- Deleted 1 synthetic Customer

Final cleanup after the last recheck smoke:

- Deleted 1 CallSession
- Deleted 1 AIInteractionLog row
- Deleted 1 BookingAttempt row
- Deleted 2 CallTranscript rows
- Deleted 0 appointments/customers

No UUID Amazon Connect ContactIds or real caller data were deleted.

## Tests and Commands

Passed:

- `node --check infra/lambda/booking-handler/index.mjs`
- `node --test --test-concurrency=1 tests/lambda/booking-handler.test.mjs` - 125 tests passed
- `npm --workspace apps/api run typecheck`
- `npm --workspace apps/api test` - 261 tests passed
- `npm --workspace apps/api run build`
- `npm --workspace apps/admin run typecheck`
- `npm --workspace apps/admin run build`
- `npm --workspace apps/app run typecheck`
- `npm --workspace apps/app run build`
- `npm test` - Lambda suite plus 261 API tests passed
- `git diff --check`

Admin build emitted only the existing chunk-size warning.

## Deployment Results

- API/admin/app redeployed to EC2 and passed health checks.
- Lambda code updated and verified active/successful.
- Lex DRAFT service slot type updated, locale rebuilt, version `32` created, prod alias moved to version `32`.
- Connect flow content published and re-exported; normalized source and active hashes match.
- Inbound number `+18483487681` remains associated with the deployed AI Reception flow.

## Remaining Limitations

- Amazon Connect `describe-contact` does not provide a trustworthy answered timestamp, speech-start timestamp, speech endpoint timestamp, or prompt playback timestamps for these records. Debug exports now mark those latency fields unavailable instead of fabricating them.
- The production smokes were deployed Lambda/API shaped invocations with synthetic contacts, not live PSTN calls from the tester’s handset.
- The report file is committed with the source changes; the final self-referential commit SHA and push result are provided in the assistant delivery response after Git creates and pushes the commit.

## Rollback Instructions

1. Revert the delivery commit on `main`.
2. Redeploy API/admin/app with `npm run deploy:ec2`.
3. Repackage and deploy the prior Lambda source; verify CodeSha256 returns to the previous deployment or to the rollback artifact.
4. Move Lex alias `JVIPIZDYE3` back to bot version `31` if rolling back the service synonyms.
5. Publish the previous Connect flow content from `connect-flow-active-before.json` or the reverted source file.
6. Verify phone number `+18483487681` still associates to flow `dcccf542-587c-426c-a644-a4c6f24da6e4`.
7. Run health checks and one synthetic confirmation smoke before returning traffic to normal monitoring.

## Git Delivery

Commit hash: provided in final delivery response after commit creation.
Push result: provided in final delivery response after push.

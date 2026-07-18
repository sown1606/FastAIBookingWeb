# Thuyet Service, Staff Exclusion, and Disconnect Run Report

Date: 2026-07-14
Salon: Kiet Nails & Beauty (`9bd14a12-85ed-418a-af7d-3f5cb329c147`)
Caller: `+********1999` to `+********7681`
Implementation commit: `7b24290` (`fix: stabilize service fallback and staff exclusions`)
Fix commit push result: `c4daf66..7b24290 main -> main`

Artifacts are under `docs/report-artifacts/2026-07-14-thuyet-service-staff-exclusion-disconnect/`.

## Provider Investigation

Amazon Connect `search-contacts` for `2026-07-14T09:02:00Z` to `2026-07-14T09:12:00Z` found eight inbound voice contacts for the caller/called-number pair. Six matched application sessions supplied in the ticket. Two were provider-only contacts with no matching application `CallSession`.

Greeting-only disconnect contact:

- Contact ID: `4d871f26-4169-4b4f-8174-fcee3206ae73`
- Initial contact ID: `4d871f26-4169-4b4f-8174-fcee3206ae73` from attributes; `DescribeContact.InitialContactId` was null
- Initiated: `2026-07-14T09:03:50.542Z`
- Disconnected: `2026-07-14T09:04:02.430Z`
- Duration: about 11.9 seconds
- Initiation method: `INBOUND`
- Queue/agent: none
- Disconnect reason: not returned by `DescribeContact`
- Attributes: caller `+********1999`, called `+********7681`, provider `AMAZON_CONNECT`
- Lambda evidence: no matching app session and no Lambda log event for this contact
- Final old-flow failure mode: initial Lex integration failure could cascade through Lex blocks whose prompts depended on `ConnectParticipantWithLexBot.Text`, then reach goodbye/disconnect without an intervening guaranteed audible recovery message.

Inbound association was verified directly:

- Phone ARN: `arn:aws:connect:us-east-1:197452633989:phone-number/f2e36faa-5264-4955-8a18-e2f53755c102`
- Flow ARN: `arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc/contact-flow/dcccf542-587c-426c-a644-a4c6f24da6e4`
- Flow name: `FastAIBooking AI Reception`

## Root Causes

- Connect recovery depended on chained Lex blocks to speak recovery text. If Lex integration failed, later Lex blocks could fail before prompts were played, allowing a fast goodbye/disconnect.
- `fifty kill` had no collision-safe service-context correction and unresolved service turns waited too long before offering keypad choices.
- `what available` and related ASR variants were treated as possible technician names instead of context-scoped Any staff.
- Staff rejection/exclusion state was not modeled as a deterministic intent. Trang ASR negatives (`jang`, `praying`, `trained`, `train`, `chang`, `dang`) were not sticky through Lambda/API/session merges, menus, availability, and final confirmation corrections.
- Lambda sanitized generic final-confirmation staff-change phrases like `i want another staff` before the API could exclude the current technician.
- GPT debug export lacked compact provider coverage, provider-only contact search, turn-state snapshots, ASR diagnostics, and stale app-call warning context.

## Changes

Source files changed:

- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/admin/admin-debug-export.service.ts`
- `apps/admin/src/components/debug-bulk-actions.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/admin-debug-export.test.ts`

Connect flow:

- Added deterministic audible recovery messages outside Lex before retry/final recovery.
- Added recovery attributes `connectRecoveryStage`, `connectLastErrorBranch`, and `connectFlowSourceVersion`.
- Preserved `conversationComplete=false` on nonterminal outcomes.
- Kept DTMF `0` as the only keypad operator-transfer path.
- Added explicit audible goodbye immediately before disconnect paths.

Service/staff behavior:

- Added service-context `fifty kill` correction to Pedicure only when Pedicure is active and no exact active service conflicts.
- Preserved exact `Manicure` and never renamed `Full Set`.
- Added immediate active-service keypad fallback with stable order: Pedicure, Manicure, Full Set, Dip Powder, then remaining active services.
- Added compact ASR N-best diagnostics.
- Added context-scoped Any-staff variants including `what available`, `who available`, `one available`, `which available`, `first avaiable`, `for available`, `any stop`, and `any stuff`.
- Added deterministic staff-intent parser and sticky `excludedStaffIds` / `excludedStaffNames`.
- In negative staff context, mapped verified Trang ASR negatives only under exclusion governance.
- Applied exclusions before first-available selection, staff menus, alternatives, and final confirmations.
- Later explicit Trang/Amy requests clear that staff from exclusions.

Debug export:

- Added schema v2 GPT `coverage`, compact provider contact summaries, provider-only bounded search, compact turn-state snapshots, compact ASR diagnostics, stale app-call warnings, and canonical deduplication note.
- Provider enrichment is bounded and degrades with `providerTraceUnavailableReason`.

## Deployment

API/admin/app:

- EC2 deploy completed successfully.
- Final API image: `sha256:c06fa562000be74923852126412dec11b042bab1cf4f9e3b4c6e9d011ab3315b`
- Admin image: `sha256:f78eee004f55afff0a6de0cb15b0fbba78084db37d811dd8078cfc1c201ac447`
- App image: `sha256:867d2e5ff5de938db81e2615113c01f35b3f4f7a1429e7259a2d8e724f004562`
- Migrations: no pending migrations
- API container: healthy

Lambda:

- Function: `fastaibooking-booking-handler`
- Last modified: `2026-07-14T14:44:55.000+0000`
- State/update: `Active` / `Successful`
- Code SHA256: `/Jrie6LOEr660QHwgQ+UalDPqTHS4mRBf/Xam/5gVpM=`

Connect:

- Active/source normalized hash: `321d4cd84f370fad0a5745688dfbf336791ed960f8ce3121bcb41b48f19bbb65`
- Active hash matched source after deployment.

Lex:

- Bot: `KHMIXGA2US`
- Alias: `JVIPIZDYE3`
- Alias name/status: `prod` / `Available`
- Version: `31`
- Lex source was not changed.

Health:

- `https://api-new-nail.kendemo.com/health`: ok
- `https://api-new-nail.kendemo.com/api/v1/health`: ok
- `https://admin-new-nail.kendemo.com`: HTTP 200
- `https://app-new-nail.kendemo.com`: HTTP 200

## Verification

Required local commands passed:

- `node --check infra/lambda/booking-handler/index.mjs`
- `npm run test:lambda`: 119/119
- `npm run test:api`: 249/249
- `npm run typecheck:api`
- `npm run typecheck:admin`
- `npm run typecheck:app`
- `npm run build:api`
- `npm run build:admin`
- `npm run build:app`
- `npm test`: Lambda 119/119 and API 249/249
- `git diff --check`

Production-shaped API smoke:

- `fifty kill` resolved to Pedicure.
- Exact `manicure` and `book manicure` remained Manicure.
- `first available`, `what available`, `who available`, `one available`, `which available`, `first avaiable`, `for available`, `any stop`, and `any stuff` reached final confirmation through Any staff in staff context.
- Negative Trang variants excluded Trang and did not select Trang.
- `i want another staff` / `i want another stop` excluded Amy while preserving Trang exclusion and selected Kelly.
- No appointment was created.

Exact multi-turn API sequence:

```text
book manicure today
eleven am
any stop
no i don't want jang
i want another staff
any staff but not praying
```

Result:

- Manicure/date/time stayed sticky.
- `any stop` selected Trang and asked final confirmation.
- `no i don't want jang` excluded Trang and selected Amy.
- `i want another staff` excluded Amy and selected Kelly.
- `any staff but not praying` preserved Trang/Amy exclusions and confirmed Kelly.
- Trang was absent from post-exclusion alternatives and DTMF menus.
- No appointment was created before confirmation.

Deployed Lambda smoke:

- `fifty kill` resolved to Pedicure or service fallback.
- `manicure` remained Manicure.
- `what available` and `any stop` reached Any-staff confirmation.
- `no i don't want jang` and `any staff but not praying` excluded Trang and selected Amy.
- `i want another staff` preserved the Lambda-to-API selected-staff handoff, excluded Amy, kept Trang excluded, and selected Kelly.
- No appointment was created and `conversationComplete` stayed nonterminal.

## GPT Debug Export

Generated `debug-gpt-export-sample.json` from the latest production Lambda smoke sessions.

- Schema version: 2
- Export mode/type: `gpt` / `multi_call_debug`
- Record count: 5
- Size: 27,194 bytes
- Includes top-level `coverage`
- Includes top-level warning on non-finalized application calls
- Includes compact `turnStateSnapshot` fields, including exclusions and conversation completion
- Includes compact ASR diagnostics with `topTranscript`, N-best alternatives, confidence, and input mode
- AI Logs GPT summary confirms canonical deduplication note

Provider enrichment from inside the API container degraded with `Could not load credentials from any providers`; direct AWS artifacts in this run contain the provider contact and provider-only contact evidence.

## Cleanup

Smoke cleanup found one synthetic AI appointment/customer created during verification:

- Appointment `f8df65f0-8ff7-4c2b-bf46-ef8dcc6d3cef`
- Customer `03cd70db-b12a-40fb-9749-6ff0ee807d6f`

Both were deleted after confirming the appointment was synthetic AI smoke data. Final cleanup check:

- Synthetic appointment count: 0
- Recent synthetic customer count for smoke phone: 0
- Cleanup required: false

## Artifact Index

Key artifacts:

- `connect-search-contacts-0902-0912.json`
- `connect-contact-summary.json`
- `contact-detail-4d871f26-4169-4b4f-8174-fcee3206ae73.json`
- `contact-attributes-4d871f26-4169-4b4f-8174-fcee3206ae73.json`
- `connect-ai-reception-active-export-final.json`
- `connect-flow-normalized-hashes-final.json`
- `lambda-get-function-final.json`
- `final-deploy-ec2.log`
- `lambda-smoke-final-after-api-redeploy-summary.json`
- `api-production-smoke-summary.json`
- `api-production-sequence-smoke-summary.json`
- `debug-gpt-export-sample.json`
- `cleanup-check-final.json`

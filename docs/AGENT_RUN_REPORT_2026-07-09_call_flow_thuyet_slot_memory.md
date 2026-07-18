# AI Phone Flow Slot Memory Fix - 2026-07-09

## Scope

Only the Amazon Connect -> Lex -> Lambda -> API AI booking phone flow was changed. No UI, Admin, or CCP files were modified.

## Root Cause

Thuyet's reported loop came from slot memory being too dependent on the current Lex turn. Empty or stale Lex slots could override already-known session attributes, and bare follow-up answers such as `Lee` were not reliably captured as the customer name after a full first utterance.

The known-caller path was also incomplete. Live Connect still had a hardcoded Kiet-only caller branch, while +84 callers had to rely on Lambda/API lookup. Lambda did not check the backend before asking for `customerName`, so a same-phone caller could be asked again even when API data already had a usable name.

Production data also showed a bad historical +84 attempt where the caller name was stored as `three`. Generic memory now rejects DTMF/number-word artifacts such as `three` so this old record is not reused as the caller name.

## Production Findings

Current execution time was `2026-07-09 01:36 EDT` / `2026-07-09 05:36 UTC`, so the requested `2026-07-09 10:49` and `10:54` EDT times had not occurred yet during this run. I still exported the focused production data and the latest relevant +84 record.

Latest real +84 record found:

- Caller: `+********1999`
- Dialed: `+********7681`
- Contact id: `cec28e0b-0c77-4a6e-9506-bbb05fe5072d`
- Created: `2026-07-08T15:07:40.477Z`
- Outcome: `AI_RECEPTION`, not transferred
- Missing field: `staffPreference`
- Stored service in old data: `Acrylic Full Set` from stale historical Lex/API data
- Stored customer name in old data: `three`
- Transfer flags/escalation records: none

Artifacts:

- `docs/live-call-flow-thuyet-slot-memory-data-2026-07-09.json`
- `docs/live-call-flow-thuyet-slot-memory-aws-2026-07-09.txt`
- `docs/live-call-flow-thuyet-slot-memory-deploy-2026-07-09.txt`
- `docs/live-call-flow-thuyet-slot-memory-smoke-2026-07-09.txt`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `docs/AGENT_RUN_REPORT_2026-07-09_call_flow_thuyet_slot_memory.md`

## Fix Applied

- Removed hardcoded Lambda known-caller logic.
- Removed hardcoded Kiet known-caller branch from the active Connect flow JSON.
- Added Lambda customer lookup before eliciting `customerName` when caller phone is known.
- Added generic API caller memory lookup by normalized phone variants:
  - Customer table
  - latest valid BookingAttempt name
  - latest valid CallSession / aiSummary name
- Preserved stable session attributes across turns for `serviceName`, `confirmedServiceName`, date, time, staff, name, and phone.
- Added bare-name capture for answers like `Lee` when the previous prompt asked for customer name.
- Kept DTMF `4` scoped to `lastAskedSlot=serviceName`, resolving to `Full Set`.
- Added reusable-name filtering so bad stored values such as `three` are not used as caller memory.
- Kept operator transfer gated to explicit operator language or DTMF `0`.

## Validation

Required commands passed:

- `npm run test:lambda` - 41 passed
- `npm run test:api` - 72 passed
- `npm run typecheck:api` - passed
- `npm run build:api` - passed
- `git diff --check` - passed

New/updated tests cover:

- Full utterance `Full Set tomorrow at 3 PM with Trang` then `Lee`
- DTMF `4` then name/date follow-up preserving `Full Set`
- +84 caller memory reusing a valid prior name
- Bad historical caller name `three` ignored
- No auto-transfer on backend error/timeout
- Active call-flow scan has no stale unavailable phrase, no `Acrylic Full Set`, and no hardcoded known-caller branch

## Deploy Results

Lambda before this run:

- LastModified: `2026-07-09T02:36:46.000+0000`
- CodeSha256: `9PJ7a/4Cz9IypNCpFjcMtAeJgzFe3mgPO02N6Z3FBg8=`

Lambda final after deploy:

- LastModified: `2026-07-09T05:47:48.000+0000`
- CodeSha256: `Gg4MLxi5miJUwLHTGxVhOBvKbmeNrAZLUHssBesSK6I=`
- Env keys present: `[INTERNAL_TOKEN_ENV]`, `DEFAULT_SALON_ID`, `FASTAIBOOKING_API_BASE_URL`

API final after deploy:

- Image: `sha256:155045083e97d22168570da9eef1d99556171817824b2af2d8c1d3c447252e7a`
- Started: `2026-07-09T05:48:31.404933195Z`
- Health: `healthy`

Connect AI Reception after deploy:

- Flow: `FastAIBooking AI Reception`
- State/status: `ACTIVE` / `PUBLISHED`
- Hardcoded known-caller branch: removed
- `AI services not available`: not present
- `Acrylic Full Set`: not present
- Runtime attributes now route directly to Lex alias `KHMIXGA2US/JVIPIZDYE3`

Lex:

- Bot: `KHMIXGA2US`
- Prod alias: `JVIPIZDYE3`
- Version: `17`
- Lambda hook unchanged: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`

## Live Smokes

Post-deploy smokes passed using the deployed Lex alias and deployed Lambda:

- Lex runtime `I want to book a Full Set tomorrow at 3 PM with Trang.` selected `Full Set` and `Trang`, asked for `customerName`, and did not transfer.
- Lambda direct DTMF `4` with `lastAskedSlot=serviceName` set `serviceName=Full Set` and `confirmedServiceName=Full Set`.
- Lambda direct follow-up `My name is Thuyet` preserved `Full Set`, filled `customerName=Thuyet`, and did not transfer.
- Lambda direct follow-up `Tomorrow at 3 PM` preserved `Full Set`, filled date/time, and did not transfer.
- Lambda direct full utterance then `Lee` preserved `Full Set`, tomorrow date, `3 PM`, `Trang`, filled `customerName=Lee`, and delegated instead of asking service/date/time again.

The smoke used validation contact ids `codex-slot-memory-smoke` and `codex-slot-memory-lex-smoke`; no operator queue escalation smoke was run.

## Remaining Risk

Historical production records still contain old text such as `Acrylic Full Set` and the bad caller name `three`; these were not deleted or rewritten. The active code now canonicalizes customer-facing service wording to `Full Set` and ignores number-word caller names for memory.

I did not place a real phone call from Thuyet's device in this run. The deployed Lex/Lambda/API path was verified through AWS runtime and Lambda invocation.

## Manual Retest For Thuyet

1. Call `+********7681` from `+********1999`.
2. Say: `I want to book a Full Set tomorrow at 3 PM with Trang.`
3. If asked for name, say: `Lee`.
4. Expected: AI must not ask service/date/time/staff again and must not transfer.
5. New call after a successful name turn: AI should reuse the valid name from the same caller phone.
6. DTMF path: say service unclearly, press `4`, then say `My name is Thuyet` or `Tomorrow at 3 PM`.
7. Expected: AI keeps `Full Set`, continues booking, and transfers only if caller presses `0` or explicitly asks for a person/operator.

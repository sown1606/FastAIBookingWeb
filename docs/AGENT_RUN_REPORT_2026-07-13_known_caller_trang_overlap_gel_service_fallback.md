# Agent Run Report: Known Caller, Trang Overlap, Gel Service Fallback

Date: 2026-07-13
Scope: production P0/P1 hardening for Amazon Connect -> Lex Lambda -> internal AI booking API.

## Root Causes

1. Known caller naming was a feature, but the UX was inconsistent. The API could recognize a returning customer by phone and set the booking name, while the Lambda could replace the backend Lex response during slot elicitation. This made the "Welcome back" acknowledgement inconsistent and did not give callers a clear current-booking name correction path.
2. Trang speech recognition missed the observed ASR variant `dang`. At the same time, staff extraction allowed too many short phrases in non-staff contexts, so the fix needed to be scoped rather than a broad alias.
3. Availability failures were being surfaced too generically in some paths. The API needed stable internal reason codes so staff-not-recognized, not-mapped, not-bookable, outside-hours, salon-closed, and appointment-overlap cases stay distinct.
4. Generic `I want ...` phrases could be interpreted as staff requests. Unsupported services such as `haircut` and `gel` could become fake staff candidates instead of service clarification.
5. Unsupported service fallback depended on the API dynamic service menu, but the Lambda response layer could overwrite API-provided service DTMF options with the static operator-only fallback.

## Production Evidence

- Returning caller phone: `+84798171999`.
- Known-caller evidence showed `recognizedCustomerId=9e917db5-ef1c-4ebd-92d1-14c57564cafb`, `recognizedCustomerName=lee`, `customerProfileSource=active_customer`.
- Trang ASR call: session `6da41235-5b24-4641-99fe-c45bc8e9534d`, ContactId `d91f98a5-0a43-4494-8c61-c1ee325b073b`, repeated transcript `dang`.
- Unsupported service call: session `fa7561c3-6f20-407c-9998-f2b4f4435158`, transcript `i want haircut`, previously produced `requestedStaff=haircut`.

## Known-Caller Behavior

Phone-based recognition remains enabled. When a reusable active customer is found, the API sets the current booking name and the Lambda preserves the backend acknowledgement:

- First acknowledgement per call: `Welcome back, Lee...`
- Later turns do not repeat `Welcome back`.
- Name correction phrases such as `My name is Thuyet`, `Call me Thuyet`, and `That's not me` now affect only the current booking state.
- The persisted customer profile is not silently overwritten.

## Trang Recognition

Added `dang` as a Trang alias in both Lambda and API, scoped to staff contexts only:

- `lastAskedSlot=staffPreference`
- `activeDtmfMenu=staff`
- explicit staff wording such as `with dang`, `I want dang`, or technician-change phrasing

Forbidden mappings remain blocked: `change`, `change it to two PM`, `check`, `ten`, `time`, and `today` do not map to Trang.

## Availability Reason Codes

`validateAppointmentSlot` now returns stable reason codes:

- `AVAILABLE`
- `SALON_CLOSED`
- `OUTSIDE_BUSINESS_HOURS`
- `STAFF_NOT_FOUND`
- `STAFF_NOT_BOOKABLE`
- `STAFF_NOT_MAPPED`
- `APPOINTMENT_OVERLAP`
- `SERVICE_UNAVAILABLE`

Caller-facing messages preserve the distinction. For an overlap, the production smoke response was:

`Trang already has an appointment at 1 PM.`

The booking attempt persisted `availabilityReasonCode=APPOINTMENT_OVERLAP`.

## Service Classification

Bare `I want ...` is no longer a staff cue. Unmatched staff extraction is allowed only in staff slot/menu context or with explicit staff/technician wording. Unsupported services now stay in the service path:

- `I want gel`
- `I want gel nails`
- `I want haircut`
- `I want a facial`

These do not set `staffPreference`, `staffId`, or selected staff IDs.

## Gel Fallback

Generic gel requests are treated as service-category requests. If no exact active `Gel Manicure` exists, the API explains that and activates the active service DTMF menu. If exactly one active gel-related alternative exists, it asks for confirmation instead of auto-selecting it.

Production active service menu in smoke:

1. Full Set
2. Builder Gel Fill Update
3. Pedicure
4. Manicure
5. Dip Powder
6. Filter

`Gel Manicure` was not listed.

## DTMF Stability

Staff and service DTMF options now preserve dynamic API-provided mappings. Staff menu mapping is stable across retry turns and only regenerates when relevant booking context changes.

Production smoke kept Trang on digit `2` across repeated invalid staff utterances, then selected Trang with the original digit.

## Production Data Audit

- Salon: Kiet Nails & Beauty, `9bd14a12-85ed-418a-af7d-3f5cb329c147`, timezone `America/New_York`.
- Known caller `+84798171999`: one active matching customer record; deleted historical duplicates exist.
- Trang: `903511ee-4849-43dd-85fb-73595e79a233`, active, bookable, not deleted.
- Full Set: `41241879-49bf-42ba-a6d1-d7da9809d334`, active, duration 100 minutes.
- Trang is mapped to Full Set.
- Blocking statuses: `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`.
- `Gel Manicure`: absent/inactive in production catalog.
- `Builder Gel Fill Update`: active, duration 30 minutes.
- `Filter`: active owner-configured service record, duration 30 minutes. It was reported only; not renamed or deleted.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/availability/availability.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `docs/AGENT_RUN_REPORT_2026-07-13_known_caller_trang_overlap_gel_service_fallback.md`

## Tests Added

- Known caller acknowledgement once and current-booking name correction.
- Known caller rejection asks for name while preserving booking fields.
- Scoped `dang -> Trang`, including negative cases for `change it to two PM`, `check`, and `ten`.
- Trang overlap via `dang` returns `APPOINTMENT_OVERLAP`; canceled overlap does not block.
- Stable staff DTMF mapping across failed recognition retries.
- Unsupported service requests activate service DTMF and do not become staff.
- Generic gel asks before selecting `Builder Gel Fill Update`.
- Lambda regression for backend dynamic service DTMF options preservation.

## Validation Results

Required validation command passed:

```bash
node --check infra/lambda/booking-handler/index.mjs
npm run test:lambda
npm run test:api
npm run typecheck:api
npm run typecheck:app
npm run typecheck:admin
npm run build:api
npm run build:app
npm run build:admin
npm test
git diff --check
```

Totals:

- Lambda tests: 102 passed.
- API tests: 192 passed.
- Aggregate `npm test`: 294 passed.
- API/app/admin typechecks passed.
- API/app/admin builds passed.
- `git diff --check` passed.

## Deployment

Lambda:

- Function: `fastaibooking-booking-handler`
- Pre-deploy RevisionId: `ba0fc394-d93d-4f0a-856b-2eeae76aa103`
- Pre-deploy CodeSha256: `9UHCJwwuC4f2ax9t24bd81Ml2cb2U6RzuyyTKcsiPTs=`
- Pre-deploy LastModified: `2026-07-13T06:31:28.000+0000`
- Post-deploy RevisionId: `e37e66c0-259c-415d-bb62-fb6828792613`
- Post-deploy CodeSha256: `wTDtzsPGzHFnWhK6Vs0quDo98CMceIgWAEKY/KHxv+Q=`
- Post-deploy LastModified: `2026-07-13T06:46:11.000+0000`
- LastUpdateStatus: `Successful`

Lex:

- Bot ID: `KHMIXGA2US`
- Prod alias ID: `JVIPIZDYE3`
- Version before/after: `31`
- Locale: `en_US`, status `Built`
- Alias status: `Available`
- Lambda code hook unchanged: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- No Lex version was created because no Lex source/slot configuration changed.

API/EC2:

- `npm run deploy:ec2` completed successfully.
- API image: `sha256:6bbada74342bab42bcd5584e78824824731e43adc2fc4d0d66c013decd62506f`
- App image: `sha256:a0ed740b6b636a8ee888d46743626e0c660c587b5e55556ae5eaf1c3c20be572`
- Admin image: `sha256:749c35ca1a309cbcc38540e4d374af3b6524c0ec04f6e1925e0171b160018490`
- Prisma migrations: no pending migrations.
- API container: healthy.

Production health smoke:

- Admin frontend: 200
- App frontend: 200
- API liveness/readiness: 200
- Versioned API liveness/readiness: 200

## Synthetic Production Smoke

Run ID: `1783925315334`

Contact IDs:

- Known caller: `codex-smoke-known-caller-1783925315334`
- Gel fallback: `codex-smoke-gel-1783925315334`
- Trang overlap: `codex-smoke-trang-dang-1783925315334`
- Menu stability: `codex-smoke-menu-stability-1783925315334`

Results:

- Known caller: recognized `lee`, spoke `Welcome back` once, did not ask for name again, later turn did not repeat welcome.
- Gel: no `staffPreference=gel`, no staff ID, service DTMF active with active services only, no `Gel Manicure` listed, no appointment created.
- Trang: `dang` resolved to Trang ID `903511ee-4849-43dd-85fb-73595e79a233`; overlap message was specific; no technician-not-found wording; no appointment created.
- Menu stability: staff options stayed stable across retry turns; Trang remained digit `2`; pressing digit `2` selected Trang and reached confirmation.

Smoke persistence:

- Each synthetic contact created one call session, one booking attempt, and one AI interaction.
- Trang smoke booking attempt status: `NO_AVAILABILITY`.
- Trang smoke reason code: `APPOINTMENT_OVERLAP`.
- No smoke flow created a booking appointment.

## Cleanup

Temporary conflict appointment:

- Appointment ID: `a7f8ecde-e7db-4310-a532-f48c1849868d`
- Staff: Trang
- Start: `2026-07-14T17:00:00.000Z`
- End: `2026-07-14T18:40:00.000Z`
- Cleanup status: `CANCELED`
- Cleanup reason: `Codex synthetic smoke cleanup`

## Rollback References

- Lambda rollback CodeSha256 before final deploy: `9UHCJwwuC4f2ax9t24bd81Ml2cb2U6RzuyyTKcsiPTs=`
- Earlier pre-run Lambda CodeSha256: `d7bCvLZsjt6ya40ND8nm691T91/kXtRYgugXfc0GoKw=`
- Lex rollback not needed; prod alias remains version `31`.
- API rollback reference: previous deployed image before this run was the same final API image already deployed during the run, `sha256:6bbada74342bab42bcd5584e78824824731e43adc2fc4d0d66c013decd62506f`.

## Remaining Risks

- The service named `Filter` is active in production and appears in the active service menu. It was not changed because it is owner-configured data.
- `dang` is intentionally scoped. If ASR produces new Trang variants outside staff context, they will not resolve until explicitly added.
- No live PSTN call was performed; smoke testing was synthetic Lambda/API production invocation.

## Git

- Commit hash: recorded in final response after commit.
- Push result: recorded in final response after push.

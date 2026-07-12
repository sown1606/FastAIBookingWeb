# Agent Run Report - Customer delete UI, appointment deep link, voice interruption, and goodbye routing

Date: 2026-07-12
Repository: FastAIBooking
Branch: main
Implementation commit: `2e253a82847da691f66e9159402586d562d725cc`

## 1. Pre-change repository state

- `git status --short` before work showed pre-existing dirty `fastaibooking-current-state.zip` and pre-existing untracked `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`.
- Current branch: `main`.
- Previous HEAD before implementation: `42bb6bf docs: record full set production run`.
- Remote: `origin git@github.com-sown1606:sown1606/FastAIBookingWeb.git`.
- The pre-existing dirty zip and untracked older report were not staged, reverted, or committed.

## 2. Documents inspected

- `docs/AGENT_RUN_REPORT_2026-07-12_full_set_service_name_sticky.md`
- `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`
- `docs/AGENT_RUN_REPORT_2026-07-11_booking_change_lex_debug_copy.md`
- `docs/p0-call-state-repair-report-2026-07-10.md`

## 3. Root causes

- Customer page delete: `deleteCustomer()` cleared React selection and then called `load()`. Because React state updates are async, the `load()` closure could still see the deleted customer and fetch `/api/v1/customers/:deletedId/appointments`, turning `CUSTOMER_NOT_FOUND` into a full-page error.
- Customer history stale 404: selected-customer history errors were treated like list-load errors, so a deleted or stale selected customer could kill the whole Customers page instead of clearing only the selection.
- Appointment deep link: `/appointments?appointmentId=...` only searched the currently loaded date/status list. Historical, canceled, completed, or out-of-range appointments were not fetched by ID, leaving the page in a blank or misleading state.
- Owner appointment layout: cards from both columns were direct children of the same CSS grid. Left-column height created shared grid rows and pushed right-column cards down.
- Early voice interruption: Connect/Lex end-of-speech timeouts were too short for natural pauses, and partial fragments such as `i want to book` were handled as complete turns, causing greeting/retry responses while the caller was still speaking.
- Full Set variants: scoped ASR variants `boom set`, `book a set`, `want a set`, and `a nail set` were missing. No bare `set` alias was added.
- Goodbye routing: the recovery Lex block routed `NoMatchingCondition` and `NoMatchingError` to the static success goodbye message. Fallback/error is not a completed booking.
- Staff consistency: Call A evidence did not show an Amy/Trang mismatch. The smaller hardening was to build success voice/session output from the persisted appointment staff and to log/recover if persisted staff ever differs from the confirmation snapshot.

## 4. Production call evidence

- Call A, Vietnam time about 2026-07-12 16:25:
  - CallSession `6789bcd9-9fcf-4bee-9c4f-a130a64ce163`
  - ContactId `1afabf2e-0a9d-44ae-b9a0-6a57ed66ff2c`
  - Appointment `721baef2-b5d4-489c-8729-ca9ddaa50a4a`
  - Transcript: `i want to book full set tomorrow at one p m with amy`, `my name is lee`, `yeah alright`
  - Service `Full Set`; staff phrase `Amy`; Lex service `Full Set`; Lex staff `Amy`; selected/final staff ID `e75b9b6d-ad6a-4060-b945-43f1358e3a79`; API appointment staff `Amy`.
  - Conclusion: consistent Amy end to end. No evidence that this call selected Trang.
- Call B, Vietnam time about 2026-07-12 16:32:
  - CallSession `213b75b5-5d26-494c-a861-981281ce8c45`
  - ContactId `1aa1f2ac-8a54-4591-bcbe-691651b2f4d5`
  - Appointment `36a5ba0e-e810-481c-b317-580f9751ecbb`
  - First turn transcript only captured `i want to book`, then the system greeted again while the caller continued. Final booking succeeded with Kelly at 11 AM.
  - Regression covered by longer end-of-speech timeouts and partial-fragment handling.
- Call C, Vietnam time about 2026-07-12 16:34-16:35:
  - CallSession `bdcee27d-2542-48bf-bcd1-18ae9159474f`
  - ContactId `b4cb6c1f-a781-4993-b904-9ea9e6846c3a`
  - Current transcript `hi i want to hi i want to book a set today at`; historical initial transcript `one two book boom set`
  - Previous outcome: service unresolved and full service menu read.
  - Regression covered by scoped Full Set aliases and short service prompt.
- Call D, Vietnam time about 2026-07-12 16:36:
  - CallSession `8e17bb87-d720-4159-b81b-98bd660202b6`
  - ContactId `541daaa1-deef-41e4-bac0-62ff324b84c8`
  - Transcript `hi i want to book pedicure tomorrow at two pm with emmy`
  - AI result `NEEDS_INPUT`, missing staff, no booking success, no `conversationComplete=true`.
  - If the caller heard success goodbye, that was a Connect recovery/error route, not the booking API result.

## 5. Production data dry-run

- Salon: `9bd14a12-85ed-418a-af7d-3f5cb329c147`.
- Phone: `+84798171999`.
- Active matching customer:
  - `2cf44fef-9c45-411a-8ddd-160c0c6fcb9b`
  - firstName `lee`
  - lastName empty
  - created/updated `2026-07-12 09:25:51.732 UTC`
  - deletedAt null
  - appointment count 2, active appointment count 2.
- Deleted historical matching customers include `47fac230-a53a-43ff-855a-7aeb3039eb3d` with firstName `lee`, lastName `Phan`, deletedAt `2026-07-11 03:15:23.687 UTC`.
- Appointment `721baef2-b5d4-489c-8729-ca9ddaa50a4a` uses active customer `2cf44fef-9c45-411a-8ddd-160c0c6fcb9b`, staff Amy, service Full Set.
- Appointment `36a5ba0e-e810-481c-b317-580f9751ecbb` uses the same active customer, staff Kelly, service Pedicure.
- Audit showed `CUSTOMER_CREATED` for active customer `2cf44fef-9c45-411a-8ddd-160c0c6fcb9b` at `2026-07-12 09:25:51.735 UTC`.
- Conclusion: spoken booking name `Lee` created/uses an active profile with empty lastName. Deleted historical `Lee Phan` was not resurrected into the active profile. No production customer data was mutated.

## 6. Active production service records

- `Full Set` `41241879-49bf-42ba-a6d1-d7da9809d334`, active, duration 100, price 8500.
- `Builder Gel Fill Update` `4f84e086-a80d-4ccf-b2f7-38a6b26c39c6`, active, duration 30, price 650.
- `Pedicure` `f64deeb4-3138-429d-8d16-452d2e33d976`, active, duration 45, price 4500.
- `Manicure` `30ec9d22-cdd9-41fb-91ee-b46baf770364`, active, duration 40, price 3500.
- `Dip Powder` `28136123-3d1a-4e6e-a45a-2eea81f6590f`, active, duration 70, price 5800.
- `Filter` `f87d655b-fc37-49a1-ab36-1814af061a72`, active, duration 30, price 3000.
- `Other Services` `449fb885-caf1-4eda-a76c-b3152379e04b`, active, duration 60, price 300.
- No service records were changed. `Filter`, `Builder Gel Fill Update`, and `Other Services` were left untouched because they are active production data and no owner confirmation was available.

## 7. Staff consistency verification

- Production active staff includes Amy and Trang, plus Alex, Kelly, Kevin, Linh, and Thien Le. No active staff named Emmy was found.
- Call A invariant was consistent:
  - transcript staff phrase `amy`
  - Lex original/interpreted staff `Amy`
  - `staffPreference` `Amy`
  - `selectedStaffId` `e75b9b6d-ad6a-4060-b945-43f1358e3a79`
  - `confirmedStaffId` `e75b9b6d-ad6a-4060-b945-43f1358e3a79`
  - final appointment staff ID `e75b9b6d-ad6a-4060-b945-43f1358e3a79`
  - API appointment staff `Amy`
  - success voice staff `Amy`
- Success response now uses persisted appointment service/staff fields.
- A persisted staff mismatch logs a structured error and returns `NEEDS_INPUT` instead of success. Because appointment creation uses the confirmed staff ID, such a mismatch should only occur if lower layers mutate the staff during persistence.
- Confirmation/session debug was extended with staff IDs and persisted customer fields.

## 8. Files changed

- `apps/app/src/pages/customers-page.tsx`
- `apps/app/src/pages/appointments-page.tsx`
- `apps/app/src/styles.css`
- `apps/app/src/lib/api.ts`
- `apps/app/src/lib/api-error-messages.ts`
- `apps/app/src/lib/i18n.tsx`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/ui-source-contracts.test.ts`
- `infra/lambda/booking-handler/index.mjs`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/*.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `tests/lambda/booking-handler.test.mjs`

## 9. Implemented behavior

- Customer delete clears selected customer immediately and reloads the customer list without fetching history for the deleted ID.
- Selected-history `CUSTOMER_NOT_FOUND` clears selection and shows a localized toast, while preserving the loaded customer list.
- True customer list load failures still render `ErrorBlock`.
- Appointment deep links search all loaded lists, fetch missing appointment details by ID, set the date from salon timezone, and remove stale `appointmentId` if the record is gone.
- Owner appointment desktop layout now uses independent left/right stacks: `owner-appointments-workspace`, `owner-appointments-main`, and `owner-appointments-sidebar`.
- Debug fields added: `spokenCustomerName`, `persistedCustomerFirstName`, `persistedCustomerLastName`, `recognizedCustomerId`, `customerNameSource`, `customerProfileSource`.
- Full Set deterministic aliases added: `boom set`, `book a set`, `want a set`, `a nail set`.
- Bare aliases `set`, `book`, `full`, and bare `food` were not added.
- First service retry prompt changed to `Sure. Which service would you like?`.
- Partial fragments such as `i want to book`, `book a`, `with`, and `change it to` no longer trigger a new welcome greeting or full service menu.

## 10. Timeout changes

- Connect session attributes:
  - Global/default end timeout: `1300ms` to `2400ms`.
  - `serviceName`: `1300ms` to `2200ms`.
  - `requestedTime`: `1100ms` to `1600ms`.
  - `staffPreference`: `1100ms` to `1600ms`.
  - `customerName`: `1500ms` to `2000ms`.
  - Max audio length unchanged at `20000ms`.
  - Barge-in / allow interrupt remains enabled.
- Lex slot prompt attempts:
  - `serviceName`: `2200ms`.
  - `requestedDate`: `2400ms`.
  - `requestedTime`: `1600ms`.
  - `staffPreference`: `1600ms`.
  - `customerName`: `2000ms`.
  - `customerPhone`: `2000ms`.

## 11. Goodbye path fix

- Initial and recovery Lex blocks now include `FallbackIntent` and `AMAZON.FallbackIntent` routes to the state-check block.
- Recovery `NoMatchingCondition` now routes to the technical trouble message, not success goodbye.
- Recovery `NoMatchingError` now routes to the technical trouble message, not success goodbye.
- Static success goodbye remains reachable through `conversationComplete=true`.
- `transferToQueue=true` still routes to operator.
- DTMF `0` behavior was not changed.
- Production active-flow graph validation:
  - recovery fallback routes to `check-transfer-to-queue`.
  - recovery `NoMatchingCondition` and `NoMatchingError` route to `41e3f239-5b57-4363-92fc-9d594579fa98`.
  - recovery no-match to success goodbye: false.
  - `conversationComplete=true` to success goodbye: true.

## 12. Test results

- `npm run test:lambda`: passed, 86 tests.
- `npm run test:api`: passed, 169 tests.
- `npm run typecheck:api`: passed.
- `npm run typecheck:app`: passed.
- `npm run typecheck:admin`: passed.
- `npm run build:api`: passed.
- `npm run build:app`: passed, Vite chunk-size warning only.
- `npm run build:admin`: passed, Vite chunk-size warning only.
- `npm test`: passed, lambda 86 tests and API 169 tests.
- `git diff --check`: passed before commit.

Regression coverage added or updated for:

- Delete selected customer without fetching deleted history.
- Selected-history 404 does not break the whole customer page.
- Appointment deep link fetches appointment outside selected day.
- Owner appointment columns stack independently.
- Spoken Lee does not synthesize surname Phan.
- Legitimate Lee Phan is not silently overwritten.
- Staff confirmation/persisted appointment invariant and mismatch recovery.
- Partial `i want to book` does not greet again.
- Longer timeout configuration for slow caller pauses.
- `boom set` and `book a set` resolve to Full Set in scoped booking context.
- Fallback/error paths do not route directly to success goodbye.

## 13. Deployment

- EC2/App/API deploy succeeded with `./infra/scripts/deploy_remote_ec2.sh`.
- Lambda package updated from `infra/lambda/booking-handler/index.mjs`.
- Lex DRAFT was updated, built, versioned, and prod alias moved.
- Connect contact flow content was updated and published.
- No database migrations were added or run.
- No production customer/service data cleanup was performed.

## 14. Production versions

Before deploy:

- API/App source commit: `42bb6bf`.
- App image: `sha256:5044bbe98c8eff23bc5618e4cc8dd7bff0256fe21d2b9ef71b78c270368ee731`.
- API image: `sha256:70ec5b273f2ab5738dcfd329c45233b47e8a31506d26c75f6351f690a5cb47fa`.
- Admin image: `sha256:749c35ca1a309cbcc38540e4d374af3b6524c0ec04f6e1925e0171b160018490`.
- Nginx image: `sha256:6769dc3a703c719c1d2756bda113659be28ae16cf0da58dd5fd823d6b9a050ea`.
- Lambda CodeSha256: `mtrMtfyUQTk+mO7MFJwa7YAQZV0GEHoVYs7lMQRTzhg=`.
- Lambda RevisionId: `c130100c-c264-4097-b0bf-c6fe3cbd5453`.
- Lambda LastModified: `2026-07-12T06:53:50.000+0000`.
- Lex bot ID: `KHMIXGA2US`.
- Lex prod alias ID: `JVIPIZDYE3`.
- Lex prod alias version: `30`.
- Connect flow ID: `dcccf542-587c-426c-a644-a4c6f24da6e4`.
- Connect flow status: `ACTIVE` / `PUBLISHED`.

After deploy:

- Implementation commit: `2e253a82847da691f66e9159402586d562d725cc`.
- App image: `sha256:a0ed740b6b636a8ee888d46743626e0c660c587b5e55556ae5eaf1c3c20be572`.
- API image: `sha256:fd36d5cc9437635ec9a1cb487fbb46e33ad42d0ecf9344726623f46033206f37`.
- Admin image: unchanged `sha256:749c35ca1a309cbcc38540e4d374af3b6524c0ec04f6e1925e0171b160018490`.
- Nginx image: unchanged `sha256:6769dc3a703c719c1d2756bda113659be28ae16cf0da58dd5fd823d6b9a050ea`.
- Lambda CodeSha256: `Fd+OlHCVlhlgvj7jazYrQqApwgNVLVtssqHbQ3TQfC8=`.
- Lambda RevisionId: `96a6fc66-2fd2-4689-bfc1-2315f8c72808`.
- Lambda LastModified: `2026-07-12T10:30:48.000+0000`.
- Lambda State / LastUpdateStatus: `Active` / `Successful`.
- Lex prod alias version: `31`.
- Lex alias status: `Available`.
- Lex version 31 locale: `en_US`, `Built`.
- Lex version 31 last build: `2026-07-12T06:32:50.914000-04:00`.
- Connect flow: `dcccf542-587c-426c-a644-a4c6f24da6e4`, `ACTIVE` / `PUBLISHED`.

## 15. Production smoke

- `./infra/scripts/smoke_test_production.sh`: passed.
  - Admin frontend: 200.
  - App frontend: 200.
  - `/health/liveness`: 200.
  - `/health/readiness`: 200.
  - `/api/v1/health/liveness`: 200.
  - `/api/v1/health/readiness`: 200.
- Lambda post-deploy configuration: `Active` and `Successful`.
- Lex prod alias: `JVIPIZDYE3` now points to version `31`, status `Available`.
- Lex version 31 locale: `Built`.
- Connect active-flow graph validation passed for fallback/no-match/goodbye routing.
- Live PSTN voice smoke was not performed because no authorized outbound/inbound test call destination was available in this run. No new live ContactIds were generated by smoke.

## 16. Rollback references

- Revert implementation commit: `2e253a82847da691f66e9159402586d562d725cc`.
- EC2 images before deploy:
  - App `sha256:5044bbe98c8eff23bc5618e4cc8dd7bff0256fe21d2b9ef71b78c270368ee731`.
  - API `sha256:70ec5b273f2ab5738dcfd329c45233b47e8a31506d26c75f6351f690a5cb47fa`.
  - Admin `sha256:749c35ca1a309cbcc38540e4d374af3b6524c0ec04f6e1925e0171b160018490`.
  - Nginx `sha256:6769dc3a703c719c1d2756bda113659be28ae16cf0da58dd5fd823d6b9a050ea`.
- Lambda rollback target:
  - CodeSha256 `mtrMtfyUQTk+mO7MFJwa7YAQZV0GEHoVYs7lMQRTzhg=`.
  - RevisionId `c130100c-c264-4097-b0bf-c6fe3cbd5453`.
  - LastModified `2026-07-12T06:53:50.000+0000`.
- Lex rollback target: prod alias version `30`.
- Connect rollback target: previous committed flow content from `42bb6bf`.

## 17. Remaining risks and intentionally unchanged

- Browser-authenticated UI delete/deep-link smoke was not run against production because no authenticated browser session was available. UI behavior is covered by source-contract tests, typecheck, app build, and production frontend health.
- Live PSTN voice smoke was not run, so the audio-level timeout improvement was verified by deployed configuration and tests rather than by a new real call.
- Active services `Builder Gel Fill Update`, `Filter`, and `Other Services` remain active. They were not modified without owner confirmation.
- Staff mismatch recovery is defensive. Since appointment creation is called with the confirmed staff ID, a persisted mismatch should not occur unless lower layers mutate the staff. If it occurs, the system does not speak success and does not create a duplicate on retry.
- Business hours, salon timezone, service durations, reschedule, cancel, DTMF `0`, and operator routing were intentionally left unchanged.

## 18. Commit and push

- Implementation commit: `2e253a82847da691f66e9159402586d562d725cc`.
- Report commit: created after this file.
- Push result: pushed to `origin/main`.

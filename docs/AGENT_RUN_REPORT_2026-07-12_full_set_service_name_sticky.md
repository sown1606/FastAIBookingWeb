# Agent Run Report - Full Set service recognition and sticky customer name

Date: 2026-07-12
Repository: FastAIBooking
Branch: main

## 1. Root causes

- The call flow still trusted stale generic service values from session state. Values such as `service` and `test service` could survive as `serviceName` / `confirmedServiceName` and block a current-turn service correction.
- `Full Set` deterministic aliases did not include production ASR variants observed in the new calls, especially `food set`, `fool set`, `foot set`, `fullsat`, and `set of nails`.
- Service DTMF fallback in Lambda and API still had a static demo menu that included `Gel Manicure`. Production salon services no longer include `Gel Manicure`, so the prompt and DTMF mapping could diverge from active services.
- Customer-name merge logic could downgrade a current-turn explicit name back to phone fallback / review state, or clear it on later date/time/staff turns because the current turn did not include a name slot.

## 2. Production evidence

- Call session `b45b8fce-72d6-401d-87f9-274accaba1b2`, Contact ID `d85cb9f1-e748-4cc9-bcbb-52b24031a6be`: transcript `food set` did not resolve to `Full Set`; stale `test service` stayed trusted; DTMF prompt contained `Gel Manicure`.
- Call session `6e9850c2-10e5-4030-918c-bb703c513fd8`, Contact ID `ad54f814-dee2-4417-9261-bb4f2da40498`: generic `service` was treated as a complete service.
- Call session `243a8499-28ed-4759-b47c-031ff1ce4c7e`, Contact ID `93071888-0d2d-47ed-ade9-6a342a81bf0c`: explicit name `Pham` was accepted, then removed after `first available` and time-change turns.
- Call session `ba006d8f-c654-4790-b4d8-3c0a9935358d`, Contact ID `15893bd8-4d7e-4b2b-a5c2-76e2d398245d`: explicit name `thee` was removed after `the first available`.

## 3. Snapshot inspection

- Requested snapshot `fastaibooking-current-state(13).zip` was not present in the workspace.
- Existing `fastaibooking-current-state.zip` was already dirty before this run. It was extracted only to `/tmp/fastaibooking-current-state-inspect` for inspection and was not deployed, edited, staged, or committed.

## 4. Files changed

- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `docs/AGENT_RUN_REPORT_2026-07-12_full_set_service_name_sticky.md`

## 5. Minimal-diff explanation

- Added a shared invalid-service placeholder check for generic values such as `service`, `services`, `test service`, `other service`, and `other services`.
- Added deterministic `Full Set` aliases for the observed ASR variants.
- Removed static service digits from fallback source of truth. Service digits now come from active salon service menu attributes; fallback only preserves `0` for operator.
- API service prompt / DTMF menu now builds from active salon services and filters placeholder service names. Menu prompt, DTMF mapping, active service IDs, active service names, and menu version are generated together.
- Lambda sanitizer now clears stale placeholder service state but lets a current recognized service such as `food set` win.
- Customer names accepted from explicit current-turn patterns remain sticky through date/time/staff/service corrections, `first available`, and empty turns unless the caller explicitly changes the name.

## 6. Behavior after fix

- `food set`, `pool set`, `fool set`, `foot set`, `fullsat`, and `set of nails` resolve to `Full Set` only when `Full Set` is active / recognized in the current scoped service list.
- `service`, `services`, `a service`, `some service`, `nail service`, `test service`, `sample service`, `unknown service`, `other service`, and `other services` are not accepted as real services.
- Stale `test service` can no longer override a current-turn `Full Set` alias.
- Service menu and service DTMF mapping are generated from the same active-service payload. Production smoke observed no `Gel Manicure` and no `Other Services` in the service menu attributes.
- A caller-provided valid name such as `Pham` remains present after `first available` and after changing time.
- `Guest ending in` is not spoken when the phone suffix is blank.

## 7. Lex inspection and deployment

- Bot ID: `KHMIXGA2US`
- Alias ID: `JVIPIZDYE3`
- Alias name: `prod`
- Old prod alias version before deploy: `29`
- Latest numeric version before deploy: `29`
- New deployed prod alias version: `30`
- Locale: `en_US`
- Version 30 locale status: `Built`
- Lambda code hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- Version 30 `NailServiceType` values: `Pedicure`, `Manicure`, `Full Set`, `Dip Powder`
- `Gel Manicure` and `Other Services` were removed from the production Lex slot type version.

## 8. Deployment versions

- Lambda before deploy:
  - Function: `fastaibooking-booking-handler`
  - Version: `$LATEST`
  - RevisionId: `9a8a9fa5-287e-43ea-a6fc-4f44c9ea1a07`
  - CodeSha256: `LBcVAlZ9Ev3eQkr40yHoh1t1ZmfMhvB31Lm5Gb8MyQo=`
  - LastModified: `2026-07-12T04:35:17.000+0000`
- Lambda after deploy:
  - Version: `$LATEST`
  - RevisionId: `c130100c-c264-4097-b0bf-c6fe3cbd5453`
  - CodeSha256: `mtrMtfyUQTk+mO7MFJwa7YAQZV0GEHoVYs7lMQRTzhg=`
  - LastModified: `2026-07-12T06:53:50.000+0000`
  - State: `Active`
  - LastUpdateStatus: `Successful`
- API/EC2 deploy:
  - Command: `npm run deploy:ec2`
  - Result: succeeded
  - API image rebuilt and container recreated successfully
- Connect flow:
  - Not changed
  - Existing flow continues to use Lex alias `KHMIXGA2US/JVIPIZDYE3`

## 9. Test results

- `npm run test:lambda`: passed, 86 tests
- `npm run test:api -- apps/api/test/ai-internal.test.ts`: passed, 163 tests
- `npm run typecheck:api`: passed
- `npm run typecheck:app`: passed
- `npm run typecheck:admin`: passed
- `npm run build:api`: passed
- `npm run build:app`: passed, Vite chunk-size warnings only
- `npm run build:admin`: passed, Vite chunk-size warnings only
- `npm run test:api`: passed, 163 tests
- `npm test`: passed, lambda 86 tests and API 163 tests
- `git diff --check`: passed before report creation

## 10. Production smoke tests

- `./infra/scripts/smoke_test_production.sh`: passed
  - Admin frontend: 200
  - App frontend: 200
  - `/health/liveness`: 200
  - `/health/readiness`: 200
  - `/api/v1/health/liveness`: 200
  - `/api/v1/health/readiness`: 200
- Direct Lambda smoke:
  - Input: current turn `food set`, stale previous `test service`
  - Result: `serviceName = Full Set`, `confirmedServiceName = Full Set`, next slot `requestedDate`
- Internal production API smoke:
  - Placeholder `test service` / `service`: rejected, elicited `serviceName`
  - Active menu attributes excluded `Gel Manicure` and `Other Services`
  - Current `food set` over stale `test service`: resolved `Full Set`
  - `my name is Pham` then `first available`: kept `customerName = Pham`
  - Time change `change it to eleven a m`: kept `customerName = Pham`, updated `requestedTime = 11:00`
  - No final confirmation was sent; no appointment was created by these smoke turns.
- Lex runtime smoke:
  - Text: `I want to book food set`
  - Intent: `BookAppointmentIntent`
  - Service slot: `Full Set`
  - Next slot: `customerName`

## 11. Rollback references

- Lambda rollback target:
  - Previous CodeSha256: `LBcVAlZ9Ev3eQkr40yHoh1t1ZmfMhvB31Lm5Gb8MyQo=`
  - Previous RevisionId: `9a8a9fa5-287e-43ea-a6fc-4f44c9ea1a07`
- Lex rollback target:
  - Previous prod alias version: `29`
  - Current prod alias version after deploy: `30`
- Connect rollback:
  - No Connect flow deployment was performed.

## 12. Remaining risks / intentionally unchanged

- Production DB currently has active non-placeholder services beyond the four Lex slot values, including `Builder Gel Fill Update` and `Filter`; the API prompt uses active services as source of truth, so those can appear in the dynamic menu. `Other Services` is filtered as an invalid placeholder.
- Business hours, timezone, service duration, appointment creation logic, operator flow, DTMF 0, and Connect flow were not changed.
- No dependency upgrades, database schema changes, or migrations were added.
- The pre-existing dirty `fastaibooking-current-state.zip` and untracked older report were not touched for commit scope.

## 13. Commit and push

- Implementation commit: `ac60eb4ef926f8a99c852445012af70bdd94c93a`
- Push result: pushed to `origin/main`

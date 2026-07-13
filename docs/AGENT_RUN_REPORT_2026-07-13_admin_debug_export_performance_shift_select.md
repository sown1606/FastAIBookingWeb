# Admin Debug Export Performance And Shift Selection Report

Date: 2026-07-13

## 1. Exact Root Causes

- Quadratic turn-history duplication: each normalized turn previously carried the full `requestPayload` and `responsePayload`; `responsePayload.turnHistory` could itself contain all turns.
- AI bulk duplication: AI Logs bulk export returned both `aiCallDebug` and `fullCallDebug`, plus duplicated `timeline` and `turnHistories`.
- Appointment duplication: call bulk export repeated appointment objects under both `bookingAttempts[].appointment` and `appointmentReferences`.
- Raw debug duplication: `responsePayload.turnHistory`, `responsePayload.timeline`, and nested `lexTurnDebug` trees were repeated where normalized top-level `turnHistories` already carried the useful fields.
- Client overhead: the Admin copied/downloaded by re-sanitizing and re-stringifying an already server-sanitized response.
- Nginx deployment detail: API JSON gzip was not enabled in the active API server block, and the deploy script only reloaded nginx after replacing a bind-mounted config file.

## 2. Existing Sample Measurement

- Confirmed supplied production export: `fastaibooking-call-debug-15-records-2026-07-13T17-14-32-628Z.json`.
- Size: `9,937,485` bytes, approximately 9.5 MB.
- Reported largest single call contribution: approximately 3.2 MB for a 15-turn call.

## 3. Largest-Record And Turn-History Analysis

- Old shape produced near-quadratic growth: 15 top-level turn entries each embedded the same full response payload, and that response payload embedded all 15 turns.
- New compact turn entries keep only normalized turn-specific debugging fields, including transcript, ContactId, intent, input mode, response text, slot decisions, DTMF diagnostics/routing, trusted slots, session attributes before/after, ignored slots/noise, and timestamps.

## 4. Old Versus New JSON Schemas

- Old bulk schema: `schemaVersion: 1`, `multi_call_debug` / `multi_ai_call_debug`, with duplicated raw payload trees.
- New bulk schema: `schemaVersion: 2`, `exportMode: "compact" | "full"`, canonical records with `exportType: "call_debug_compact"` or `call_debug_full`.
- AI Logs now exports the same canonical call-debug record shape as Call Logs.

## 5. Fields Removed Only As Duplicates

- `turnHistories[].requestPayload`
- `turnHistories[].responsePayload`
- `responsePayload.turnHistory`
- `responsePayload.timeline`
- `appointmentReferences`
- duplicate `aiCallDebug` / `fullCallDebug`
- compact `bookingAttempt.rawInput.attributes.lexTurnDebug` when represented in normalized `turnHistories`

## 6. Compact Versus Full Behavior

- Bulk UI defaults to compact mode.
- Copy JSON uses compact mode only.
- Export compact JSON uses the regular JSON API response.
- Export full JSON uses `?download=true` and downloads the server response as a Blob without parsing a large object in the browser.
- Single-record detail exports remain available.

## 7. Query Timing

- Production Call Logs compact 15-record export:
  - `callSessionQueryDurationMs`: `69.51`
  - `databaseDurationMs`: `69.51`
- Production AI Logs compact 10-grouped-row export:
  - `selectedAIQueryDurationMs`: `46.2179`
  - `callSessionQueryDurationMs`: `50.94`
  - `databaseDurationMs`: `97.19`

## 8. Build/Serialization Timing

- Production Call Logs compact 15-record export:
  - `buildDurationMs`: `22.5`
  - `serializationDurationMs`: `5.61`
  - `responseBytes`: `1,322,093`
- Production AI Logs compact 10-record export:
  - `buildDurationMs`: `15.51`
  - `serializationDurationMs`: `3.23`
  - `responseBytes`: `913,714`

## 9. Before/After Payload Sizes

- Before: `9,937,485` bytes for 15 call records.
- After production compact Call Logs: `1,322,093` bytes for 15 call records.
- After production compact AI Logs: `913,714` bytes for 10 grouped AI call records.
- Synthetic 15-turn regression fixture asserts compact output is smaller than full output and less than 35% of the old duplicated representation.

## 10. Before/After Production Duration

- Before: browser canceled at the Admin Axios default timeout, `20,000ms`.
- After: production compact 15-call export completed in `926ms` on the timing run and `1,038ms` on the gzip run.
- After: production compact 10-row AI export completed in `1,043ms` on the timing run and `542ms` on the gzip run.

## 11. Axios Timeout Behavior

- Global Admin Axios timeout remains `20_000`.
- Bulk debug-export calls pass `timeout: 120_000`.
- Timeout toast:
  - English: `Debug export took too long. Try selecting fewer records or use compact export.`
  - Vietnamese: `Quá trình xuất dữ liệu mất quá nhiều thời gian. Hãy chọn ít nhật ký hơn hoặc sử dụng bản rút gọn.`

## 12. Nginx Gzip Result

- Added gzip to the API server config:
  - `gzip on;`
  - `gzip_comp_level 5;`
  - `gzip_min_length 1024;`
  - `gzip_types application/json application/problem+json text/plain;`
- Active production nginx config verified with `nginx -T`; syntax check passed.
- Compact Call Logs and AI Logs debug responses returned `content-encoding: gzip`.
- Updated `infra/scripts/deploy_ec2.sh` to force-recreate nginx and run `nginx -t` so bind-mounted config changes are remounted, not only reloaded.

## 13. Shift-Click Implementation

- `useRowSelection` now tracks an anchor row.
- Normal click toggles one row and updates the anchor.
- Shift-click selects the inclusive visible range from anchor to target.
- Filter/data reconciliation clears hidden selection and invalid anchors.
- Select All Visible and Clear update/reset the anchor safely.
- Production headless Chrome QA:
  - Call Logs: first checkbox then Shift-click fifteenth selected 15 contiguous rows.
  - AI Logs: first grouped row then Shift-click fifth selected 5 contiguous grouped rows.

## 14. Files Changed

- `apps/api/src/modules/admin/admin-debug-export.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/admin-debug-export.test.ts`
- `apps/api/test/ui-source-contracts.test.ts`
- `apps/admin/src/components/debug-bulk-actions.tsx`
- `apps/admin/src/lib/api.ts`
- `apps/admin/src/lib/debug-export.ts`
- `apps/admin/src/lib/download-json.ts`
- `apps/admin/src/lib/i18n.tsx`
- `apps/admin/src/lib/use-row-selection.ts`
- `apps/admin/src/pages/ai-log-detail-page.tsx`
- `apps/admin/src/pages/calls-page.tsx`
- `apps/admin/src/pages/ai-logs-page.tsx`
- `infra/nginx/default.conf`
- `infra/nginx/default-ssl.conf`
- `infra/scripts/deploy_ec2.sh`
- This report.

## 15. Tests And Totals

- `npm run typecheck:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run typecheck:app`: passed.
- `npm run test:api`: passed, 223 tests.
- `npm run test:lambda`: passed, 108 tests.
- `npm test`: passed, 331 tests total.
- `npm run build:api`: passed.
- `npm run build:admin`: passed, existing Vite chunk-size warning only.
- `npm run build:app`: passed, existing Vite chunk-size warning only.
- `git diff --check`: passed.
- `bash -n infra/scripts/deploy_ec2.sh infra/scripts/deploy_remote_ec2.sh infra/scripts/smoke_test_production.sh`: passed.

## 16. Deployment Result

- `npm run deploy:ec2`: passed.
- First deploy rebuilt API/Admin and reloaded nginx.
- Second deploy, after deploy-script correction, force-recreated nginx, ran `nginx -t`, reloaded nginx, and completed successfully.
- Prisma migrate deploy reported 16 migrations and no pending migrations.

## 17. Production QA

- `./infra/scripts/smoke_test_production.sh`: passed after each deploy.
- Admin login: passed.
- Call Logs loaded: total `118`, visible `50`.
- AI Logs loaded: total `120`, visible `50`, grouped visible `50`.
- Compact Call Logs endpoint: 15 records, `1,322,093` bytes, gzip, no duplicate turn payload fields, no `appointmentReferences`.
- Compact AI Logs endpoint: 10 grouped records, `913,714` bytes, gzip, no `aiCallDebug`, `fullCallDebug`, or `timeline`.
- Full direct-download endpoint: status `200`, `X-Debug-Export-Mode: full`, `X-Debug-Export-Records: 1`, attachment filename header present.
- Admin production bundle contains compact labels, full-download path, toolbar class, and Shift-key handling.
- Security marker scan of compact production bundles found none of: `Bearer`, `accessToken`, `refreshToken`, `password`, `AWS_SECRET`, `Authorization`, `Cookie`.
- Browser failure-path behavior was not force-induced against production; code paths keep selection on API failure and do not download when prepare fails.

## 18. Remaining Risks

- Full exports can still be large by design; the UI routes them through Blob direct download rather than copy or JSON parsing.
- Production data shape can change; compact serializer keeps normalized fields and important payload outcomes but intentionally removes duplicate raw trees.
- Forced production timeout/failure was not induced to avoid disruptive testing, but timeout/error handling is implemented in the list pages and covered by source contracts.

## 19. Commit Hash

- Final commit hash is created after this report is committed and is recorded in the final response.

## 20. Push Result

- Push result is recorded in the final response after `git push`.

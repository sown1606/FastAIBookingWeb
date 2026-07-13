# Admin Multi Debug Export Run Report - 2026-07-13

## 1. Scope
- Implemented Admin/API-only multi-select debug export for Admin -> Nhat ky goi / Call Logs and Admin -> Nhat ky AI / AI Logs.
- No Amazon Connect call flows, Lex configuration, Booking Lambda behavior, appointment logic, voice recognition, or call-state behavior were modified.

## 2. Existing Single-Record Behavior Found
- `apps/admin/src/pages/call-detail-page.tsx` already exported a full single-call debug payload with call session, transcripts, booking attempts, AI interactions, turn histories, escalation records, and final resolution.
- `apps/admin/src/pages/ai-log-detail-page.tsx` already loaded `GET /api/v1/admin/ai-logs/:id/debug` and supported copy/export of linked call debug data.

## 3. UI Changes
- Added checkbox selection to `calls-page.tsx` and grouped-row selection to `ai-logs-page.tsx`.
- Added reusable `DebugBulkActions` toolbar with Copy debug JSON, Export JSON, and Clear actions.
- Added responsive cream/gold Admin styling for the toolbar, checkbox column, and selected rows.
- Preserved existing Open detail links.

## 4. API Endpoints Added
- `POST /api/v1/admin/calls/debug-export`
- `POST /api/v1/admin/ai-logs/debug-export`
- Both routes require platform admin authentication through the existing admin router guard.

## 5. Selection Behavior
- Select All applies only to currently visible rows.
- Header checkbox supports indeterminate state.
- Selection reconciles against the loaded visible IDs when filters/data change.
- Empty selection disables bulk actions and reports "No records selected" if invoked.

## 6. AI Call Deduplication Behavior
- AI Logs remain grouped by call in the UI.
- Bulk AI export uses each grouped row's latest AI interaction ID.
- Server-side AI export deduplicates records by any matching `callSessionId`, `providerCallId`, or Amazon Connect ContactId.

## 7. Debug Bundle Schemas
- Calls bundle: `schemaVersion`, `exportedAt`, `exportType: multi_call_debug`, `requestedCount`, `recordCount`, `notFoundIds`, `sourcePage: call_logs`, `selection`, `records`.
- AI bundle: `schemaVersion`, `exportedAt`, `exportType: multi_ai_call_debug`, `requestedCount`, `recordCount`, `deduplicatedCount`, `notFoundIds`, `sourcePage: ai_logs`, `selection`, `records`.
- Filenames follow:
  - `fastaibooking-call-debug-N-records-<timestamp>.json`
  - `fastaibooking-ai-debug-N-calls-<timestamp>.json`

## 8. Sanitization Policy
- Server and client redact values for normalized case-insensitive keys containing:
  `authorization`, `cookie`, `set-cookie`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `password`, `sessionToken`, `privateKey`, `clientSecret`.
- Redaction uses `[REDACTED]`.
- Debug identifiers such as `callSessionId`, `providerCallId`, `contactId`, `callerPhone`, `salonId`, `bookingAttemptId`, `appointmentId`, transcripts, turn history, and slot decisions are preserved.

## 9. Files Inspected
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/modules/calls/calls.service.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/test/ui-source-contracts.test.ts`
- `apps/admin/src/pages/call-detail-page.tsx`
- `apps/admin/src/pages/ai-log-detail-page.tsx`
- `apps/admin/src/pages/calls-page.tsx`
- `apps/admin/src/pages/ai-logs-page.tsx`
- `apps/admin/src/lib/api.ts`
- `apps/admin/src/lib/download-json.ts`
- `apps/admin/src/lib/i18n.tsx`
- `apps/admin/src/styles.css`
- `infra/scripts/deploy_remote_ec2.sh`
- `infra/scripts/deploy_ec2.sh`
- `infra/scripts/smoke_test_production.sh`

## 10. Files Changed
- `apps/api/src/modules/admin/admin-debug-export.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/admin-debug-export.test.ts`
- `apps/api/test/ui-source-contracts.test.ts`
- `apps/admin/src/components/debug-bulk-actions.tsx`
- `apps/admin/src/lib/clipboard.ts`
- `apps/admin/src/lib/debug-export.ts`
- `apps/admin/src/lib/download-json.ts`
- `apps/admin/src/lib/i18n.tsx`
- `apps/admin/src/lib/use-row-selection.ts`
- `apps/admin/src/pages/call-detail-page.tsx`
- `apps/admin/src/pages/ai-log-detail-page.tsx`
- `apps/admin/src/pages/calls-page.tsx`
- `apps/admin/src/pages/ai-logs-page.tsx`
- `apps/admin/src/styles.css`
- `docs/AGENT_RUN_REPORT_2026-07-13_admin_multi_debug_export.md`

## 11. Tests Added
- Added `apps/api/test/admin-debug-export.test.ts` with endpoint coverage for calls and AI debug export.
- Updated `apps/api/test/ui-source-contracts.test.ts` with source contracts for row selection, indeterminate header checkbox, bulk actions, new endpoints, shared copy/export sanitization, and detail-page compatibility.

## 12. Validation Command Results
- `npm run typecheck:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run typecheck:app`: passed.
- `npm run test:api`: passed, 217 tests.
- `npm run test:lambda`: passed, 108 tests.
- `npm test`: passed, Lambda 108 tests plus API 217 tests.
- `git diff --check`: passed.

## 13. Build Results
- `npm run build:api`: passed.
- `npm run build:admin`: passed; Vite chunk-size warning only.
- `npm run build:app`: passed; Vite chunk-size warning only.

## 14. Deployment Result
- `npm run deploy:ec2`: passed.
- Docker rebuilt API/Admin/App images as applicable.
- Prisma migrate deploy reported no pending migrations.
- API and Admin containers were recreated.
- API container reported healthy and nginx reloaded.

## 15. Production Smoke Results
- `./infra/scripts/smoke_test_production.sh`: passed.
- Admin frontend reachable: 200.
- App frontend reachable: 200.
- Root and `/api/v1` health liveness/readiness: 200.
- Additional production admin smoke:
  - Platform admin login: ok.
  - Call Logs loaded: 118 total, 1 visible in smoke request.
  - AI Logs loaded: 120 total, 1 visible in smoke request.
  - Calls bulk endpoint returned 1 record, 0 not found.
  - AI bulk endpoint returned 1 record, 0 not found.
  - Deployed Admin JS bundle contains both new bulk endpoints and toolbar/control markers.

## 16. Manual QA Results
- Production bundle QA against deployed Admin API passed:
  - One selected call copy/export strings matched after using the same sanitized bundle.
  - Five selected calls exported a bundle containing 5 records.
  - One grouped AI row exported linked call debug with timeline/transcripts.
  - Three grouped AI rows exported one deduplicated bundle with 3 records from this data sample.
  - AI `includeSynthetic` filter state was recorded in the bundle.
  - Security search across exported production bundles found no `Bearer`, `accessToken`, `refreshToken`, `password`, `AWS_SECRET`, `Authorization`, or `Cookie` markers.
- A headless browser harness was attempted for full click-through coverage, but the local DevTools capture was unstable for multi-record downloads. The exported JSON content and production endpoints were verified directly through deployed API/bundle checks.

## 17. Remaining Risks
- Browser-native clipboard/download permission behavior can vary by browser, but the UI uses `navigator.clipboard.writeText` with the existing textarea fallback and shows a clear export recommendation if copy fails.
- Very large exports may be slow; the UI disables duplicate clicks while preparing bundles and limits requests to 50 IDs.

## 18. Commit Hash
- Recorded in the final response after commit creation.

## 19. Push Result
- Recorded in the final response after pushing the current branch.

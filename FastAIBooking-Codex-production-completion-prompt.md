# FastAIBooking production completion prompt for Codex

You are Codex working at the root of the current FastAIBooking repository.

This is a **production stabilization and completion pass**, not a redesign. Execute the work end to end: inspect the current uncommitted changes, inspect the live EC2/AWS/DB state, make the smallest safe changes, add regression tests, deploy, verify production, clean only proven smoke data, and commit/push. Do not stop at an audit and do not ask questions that can be answered from the repository, production server, database, CloudWatch, Amazon Connect, Lex, Lambda, or Firebase configuration.

## 0. Non-negotiable constraints

1. Preserve all current uncommitted work. Start with `git status`, `git diff`, and the recent P0 diagnostics. Do not reset, checkout, or overwrite the call-flow fixes already in progress.
2. Prioritize in this order:
   - P0: live call flow and live salon data integration.
   - P0: DTMF 0/operator routing, queue wait prompt, and hold music.
   - P1: real call-center-agent provisioning plus safe smoke-agent deletion.
   - P1: service/staff CRUD and push notifications end to end.
   - P1: Adminer `/db.php` routing and security.
   - P2: only the reported admin UI bugs: overflow, autofill, and double nav highlight.
3. Make the smallest coherent patch. Do not rewrite the app, replace the state machine, change the visual design system, upgrade unrelated dependencies, reformat unrelated files, or introduce a new platform.
4. Never run the production seed. Never leave temporary smoke users, services, staff, appointments, calls, or AI logs behind.
5. Back up the production database before migrations or cleanup. All cleanup must support dry-run first and must report exact IDs/counts.
6. Never expose database credentials, AWS keys, Firebase private keys, JWTs, `.env`, or passwords in Git, terminal reports, diagnostics, or screenshots.
7. DTMF digit **0 is globally reserved for a human operator**. It must never be assigned to a service or staff member.
8. Do not auto-transfer because of ASR failure, no input, service mismatch, Lambda/API timeout, or unavailable appointment. Transfer only after explicit `0` or an explicit human/operator request.
9. Preserve the current one-AI-log-per-real-call invariant and synthetic-log filtering. Do not regress the recent `full set`/FallbackIntent fixes.
10. If a production change fails verification, roll it back or fix it before declaring success.

## 1. Verify these known current-state problems before editing

Inspect the exact current source and live deployment. The uploaded repository snapshot indicates these likely gaps; confirm them rather than assuming:

- `infra/lambda/booking-handler/index.mjs` still contains hard-coded `DEMO_SERVICE_NAMES`, `SERVICE_DTMF_OPTIONS`, static service prompts, and static fallback staff names.
- `apps/api/src/modules/ai/ai.service.ts` still contains hard-coded service DTMF options and prompts; `getServicePromptNames()` can truncate to five services, and staff speech can truncate after four names.
- Service matching does query active services from PostgreSQL, but the spoken/keypad catalog is not fully driven by the salon’s current data.
- `apps/api/src/modules/admin/admin.service.ts#createCallCenterAgentForAdmin()` creates only a local PostgreSQL `User`; it does not provision a real Amazon Connect user.
- `apps/admin/src/pages/call-center-agents-page.tsx` has create/list but no safe delete or cleanup action.
- `docker-compose.yml` already has an `adminer` container on internal/localhost port 8080, but `infra/nginx/default.conf` and `default-ssl.conf` send all admin-domain traffic to the static React admin. `apps/admin/nginx.conf` falls back to `/index.html`, so `/db.php` is currently the SPA, not PHP/Adminer.
- Production shows both `/salons` and `/salons/new` highlighted at once, even though the source has custom active-route logic. Determine whether this is a logic bug, stale frontend artifact, cache issue, or failed deployment.
- The call-center-agent card grid overflows horizontally and long email/phone strings do not wrap cleanly.
- Browser credential autofill is placing the platform-admin email/password into “create salon owner” or “create operator” fields.

Record the pre-fix evidence in `diagnostics/codex-run/commands.log`, but keep the file compact and redact secrets.

## 2. P0 — Make the phone menu fully data-driven from the salon database

### 2.1 Source of truth

For every real call, resolve the salon from the actual called Amazon Connect phone number, then load the current catalog from PostgreSQL:

- Services: `salonId`, `isActive = true`, `deletedAt IS NULL`.
- Staff: same salon, `status = ACTIVE`, `isBookable = true`, `deletedAt IS NULL`.
- When a service has been selected, staff options must be limited to staff who can perform that service through `StaffService`, plus “Any staff/first available”.

The next call after a service/staff create, edit, reorder, activation, deactivation, or deletion must use the new data **without rebuilding Lex** and without editing static prompt text.

### 2.2 Stable ordering

Use one deterministic order everywhere: owner app list, admin detail, spoken menu, DTMF mapping, matching diagnostics, and booking result.

Prefer the smallest additive design:

- If an explicit service/staff voice-menu order already exists, use it.
- Otherwise add a small integer order field with a safe migration and simple move-up/move-down or order-number controls in the existing owner UI.
- Stable fallback order must be `sortOrder ASC`, then normalized name ASC, then creation time/ID ASC.
- Do not hard-code demo names such as Trang/Amy/Kelly or Pedicure/Manicure as the authoritative order.

### 2.3 Service DTMF contract

Build the service keypad map at runtime and carry it in Lex session attributes. Use IDs as well as display names, for example:

- `serviceDtmfOptions`: digit -> exact customer-facing service name.
- `serviceDtmfServiceIds`: digit -> service UUID.
- `serviceDtmfPromptText`: the exact generated SSML/text.
- `activeDtmfMenu = "service"`.
- `activeDtmfOptionsJson`: runtime map including `"0": "__operator__"`.
- A catalog/version marker if useful for diagnostics.

Rules:

1. Digits 1 through 9 are available for services.
2. Digit 0 is always operator and is never included in service ordering.
3. If the salon has exactly 9 active services, the AI must read and map **all 9**, in the configured order.
4. If it has fewer than 9, read only the active services; do not invent missing demo services.
5. If it has more than 9, voice recognition must still accept every active service name. The keypad may expose the first 9 in configured order, with a concise instruction to say any other service name. Do not silently pretend the remaining services do not exist and do not use 0 for pagination.
6. A selected digit must resolve by service UUID first, then verify that the service is still active before booking.
7. Names must be escaped for SSML and spoken exactly as customer-facing DB names.
8. “Other Services” is not special unless it exists as an active service record.

Remove static service names from the live greeting, Lambda fallback, API prompt, Lex slot prompt, and Amazon Connect flow. A tiny emergency fallback may remain only for total API/catalog failure, but it must not override valid runtime session attributes and must not present stale salon-specific names.

### 2.4 Staff DTMF contract

Make staff options runtime-driven too:

- Use active, bookable, service-qualified staff only.
- Carry digit -> staff name and digit -> staff UUID in session attributes.
- Keep “Any staff/first available” explicit.
- Keep 0 for operator.
- Never let a staff digit contaminate service, date, or time slots.
- Never let a service digit be interpreted as staff.
- If keypad capacity is exceeded, keep all names available by speech and use a concise deterministic keypad policy; do not silently drop staff from speech recognition.

### 2.5 Dynamic recognition, not Lex rebuilds

Do not rely on a static Lex custom-slot list as the source of truth. The Lambda/API must be able to recognize a valid current DB service or staff name from `inputTranscript`, including when Lex sends `FallbackIntent`, and route it back to `BookAppointmentIntent` with the correct UUID/name.

Retain alias handling for common ASR errors, but aliases must resolve against the active salon catalog. A hard-coded alias may help recognize “full said” as “Full Set”, but it must not make an inactive/nonexistent service bookable.

### 2.6 Natural, calm conversation

Use concise, calm phone language and SSML pauses. Avoid duplicate greetings and avoid repeating the whole menu after every miss.

Initial example, generated from live data:

`Hi, thanks for calling {salonName}. I can help book an appointment. You can say the service name, or press 1 for ..., 2 for ..., through 9 for .... Press 0 for a person.`

Requirements:

- When there are 9 active services, enumerate all 9 once.
- After a valid selection, say only a short implicit confirmation, e.g. `Got it, Full Set. What day works best?`
- Support multi-slot speech such as `full set tomorrow at three with anyone` and ask only for missing information.
- Support corrections without clearing unrelated confirmed fields.
- First recognition miss: confirm the nearest valid candidate when confidence is sufficient.
- Second miss: provide a short narrowed choice or the dynamic keypad menu.
- Third miss: offer `press 0 for a person`, but do not transfer automatically.
- No endless `I didn't catch the service` loop.
- Enable barge-in where appropriate so callers can interrupt prompts.
- Inspect live Lex/Connect speech settings and increase end-of-speech patience enough that slow callers are not cut off. Keep changes conservative and test with realistic phone-shaped events.

### 2.7 Wait prompts, queue, and hold music

Verify the complete live path, not only JSON source files:

- Before an actually slow availability lookup or booking creation, say one short prompt such as `One moment while I check availability.` Do not play a wait message for every fast local query.
- On explicit 0/human request, say exactly one calm prompt such as `Please wait while I connect you.`
- Then route to the correct Amazon Connect queue.
- Configure/verify a customer queue flow that produces audible hold music or a periodic hold message. There must be no dead air, no repeated transfer prompt, and no loop back to Lex.
- Confirm agent routing profile, queue association, hours, queue flow, and operator availability in live AWS.
- Preserve the rule that backend failure/no-match does not auto-transfer.

## 3. P1 — Real call-center agents in both FastAIBooking and Amazon Connect

### 3.1 Inspect the live Connect identity model first

Use the configured AWS profile/role and inspect:

- Connect instance ID and `IdentityManagementType`.
- Existing real users.
- Operator security profile(s).
- Operator routing profile and queue assignments.
- Username/password requirements.

Do not hard-code IDs already discoverable from environment/configuration. Add only the minimum required environment variables and validate them at startup.

### 3.2 Provision a linked real account

The admin “Create operator” action must create a usable FastAIBooking account and, when the Connect instance is Connect-managed, a real Amazon Connect user linked to it.

Implement the smallest reliable provisioning model:

- Add the AWS Connect SDK dependency only if it is not already available.
- Store the Connect user ID/ARN/username and a provisioning status/error on the local user or a small dedicated mapping table.
- Never store plaintext passwords.
- Use a safe external-operation workflow with compensation: no state where UI says success while AWS creation failed. If AWS succeeds and DB fails, delete/rollback the AWS user. If DB exists and AWS fails, mark provisioning failed and expose Retry; do not silently return success.
- For Connect-managed identity, use a valid one-time password and show it only once after creation. It may be the same admin-provided initial password only if that is the smallest secure compatible approach; never log it.
- For SAML/external-directory identity, implement the correct supported linkage behavior and clearly display that Connect authentication is externally managed. Do not fake a Connect-managed password.
- Assign the verified operator security profile, routing profile, and phone configuration.
- Return/display a clear status badge: `App active`, `Connect active`, `Provisioning failed`, or `Not applicable/external identity`.
- Verify a newly created real operator can sign in to the FastAIBooking operator app and open/sign in to the correct CCP.

### 3.3 Safe delete and smoke cleanup

Add:

- A per-agent delete/deactivate action with confirmation and assignment count.
- A platform-admin-only `Clean test agents` action with dry-run preview, exact count, and explicit confirmation.
- A backend dry-run/apply cleanup service or script that can also be run from CLI.

Legacy test detection must be strict. Use an explicit `isSynthetic` flag for new test data if an additive field is the smallest durable fix. For legacy rows, only classify records that match strong markers such as all/most of:

- exact display name `Smoke Agent`,
- email matching `agent.<digits>@fastaibooking.test` or the exact known test domain,
- known smoke phone,
- no real activity outside synthetic data.

Do not delete Anna Vo or `agent.demo@fastaibooking.local` merely because it is a demo login. Do not delete any unrecognized real operator.

When deleting a linked test agent:

1. Dry-run and list local user ID, Connect user ID, assignments, tokens, and related synthetic records.
2. Remove or safely reassign call-center assignments.
3. Delete the Amazon Connect user when one exists.
4. Revoke local refresh/push tokens and remove/deactivate the local user safely.
5. Remove only synthetic AI/call/test records that are already explicitly marked or match the established strict synthetic key; never blanket-delete real calls.
6. Report exact deleted/skipped counts and IDs.

Do not leave any `Smoke Agent` cards in the production admin after cleanup.

## 4. P1 — Service/staff CRUD and AI integration verification

Do not merely verify HTTP 200. Prove that CRUD changes affect booking behavior:

### Services

- Create, list, edit name/duration/price/order, activate/deactivate, map to staff, delete/soft-delete.
- Prevent duplicate/confusing names within one salon after normalization.
- Deactivated/deleted services disappear from the next call menu and cannot be booked.
- A renamed service is spoken under the new name on the next call and maps to the same/expected record.
- An active ninth service receives digit 9; 0 remains operator.

### Staff

- Create, edit, order, activate/deactivate, bookable toggle, service mapping, login/reset access, delete/soft-delete.
- Active/bookable/service-qualified staff appear in the next call.
- Inactive, deleted, non-bookable, or unqualified staff do not appear and cannot receive an appointment.
- “Any staff” resolves to a real eligible staff UUID after availability checks.

Use local/integration tests for temporary records. If one live production verification record is unavoidable, create it with a unique marker and remove it in a guaranteed cleanup/finally step. Do not leave smoke data.

## 5. P1 — Push notifications end to end

Inspect the current Firebase Admin configuration, web service worker, token registration, token lifecycle, notification inbox, and all send call sites. Keep the current architecture.

Required production behavior:

- Browser permission and service-worker registration are observable; failures are not silently swallowed without diagnostics.
- Token registration is idempotent and updates `lastSeenAt`.
- Logout removes the current token safely.
- Invalid/expired FCM tokens are removed after send failures.
- Foreground notifications show a toast and refresh the in-app inbox.
- Background notifications open the correct absolute same-origin app route.
- Appointment create/reschedule/cancel/status changes notify the correct owner/staff recipients.
- Human escalation/callback/queue events notify assigned call-center agents or fallback operators exactly once.
- No duplicate push for one domain event.
- Push failure must not roll back a valid appointment, but it must be logged and visible in health/diagnostics.
- Provide or verify an existing admin/owner `Send test notification` path that returns attempted/success/failure/disabled counts.

Perform one controlled production push test to an existing authorized test device/account if a valid registered token exists. Do not create fake permanent users just to test push.

## 6. P1 — Fix `/db.php` correctly and securely

Do not try to execute PHP inside the static React admin Nginx container. Use the existing `adminer` service.

Implement the smallest secure routing fix:

- Add an exact/prefix route for `https://admin-new-nail.kendemo.com/db.php` in both `infra/nginx/default.conf` and `infra/nginx/default-ssl.conf` that proxies to `http://adminer:8080/` with the correct rewrite/proxy headers.
- Ensure edge Nginx can resolve/reach the Adminer container and depends on it as needed.
- Keep all other admin paths routed to the React admin.
- Protect `/db.php` with HTTP Basic Auth and/or a narrow trusted-IP allowlist. Prefer Basic Auth plus TLS so changing client IP does not break access. Store the htpasswd/secret only on the server or in a Docker secret/ignored file; never commit it.
- Add `noindex`, no-cache, frame/content-type protections as appropriate.
- Do not embed or auto-fill the DB password in the page.
- Keep PostgreSQL off the public network.

Verification:

- Unauthenticated `curl -I https://admin-new-nail.kendemo.com/db.php` returns `401` if Basic Auth is used, not React HTML.
- Authenticated request returns Adminer/PHP HTML, not the FastAIBooking `Initializing session` page.
- Adminer can connect to server `postgres` from its container using credentials entered manually.
- Normal `/`, `/salons/new`, and other SPA routes still work.

## 7. P2 — Fix only the reported admin UX defects

### 7.1 Exactly one active nav item

For `/salons/new`, only `Tạo tiệm/Create salon` is active. For `/salons/:id`, only `Tiệm nail/Salons` is active. Other detail pages activate only their own parent item.

Use explicit route matching (`end` or the existing helper) and verify the live built artifact. If source is already correct, diagnose stale deployment/cache and fix the release path instead of rewriting navigation.

### 7.2 Agent page overflow

At 1280, 1440, 1728, 1920, tablet, and mobile widths:

- No page-level horizontal scrollbar.
- Agent cards wrap to new rows.
- Every grid child has `min-width: 0` where needed.
- Long email/phone/salon names use safe wrapping.
- Create-agent fields and button wrap cleanly rather than forcing one oversized row.
- Preserve the existing visual style.

### 7.3 Prevent admin credential autofill

The create-salon owner form and create-agent form must open blank and must not inherit the logged-in platform-admin email/password. Use correct unique `name` and `autocomplete` attributes, especially `new-password`, and avoid misleading prefilled values.

### 7.4 Make create salon fast and compact

Keep the API behavior, but simplify the current page:

- Essential first section: salon name, timezone, owner name, owner email, initial owner password.
- Optional salon phone/contact and address fields inside a collapsed `Optional/Advanced` section.
- Reuse owner email/phone as defaults server-side where already supported; do not make users enter the same value repeatedly.
- Use a single clear submit action with loading protection against double submission.
- On success, go directly to the salon detail/setup checklist and show what remains for live calling: Connect number mapping, services, staff, hours, and operator assignment.
- Do not automatically claim/purchase an AWS phone number. If an existing claimed number can be safely assigned, expose the current mapping clearly and validate uniqueness.

## 8. Automated tests required

Add focused regression tests, not broad snapshots.

### Call/Lambda/API

1. Runtime DB catalog with 1, 5, and 9 active services produces digits 1..N in deterministic order.
2. Nine services are all present in prompt and maps; `0` is operator and never a service.
3. A tenth service remains voice-recognizable even if not in the first keypad page/map.
4. Add/edit/deactivate/delete service changes the next generated call catalog without Lex rebuild.
5. Service DTMF digit resolves to the exact service UUID and name.
6. Dynamic staff list is service-qualified, active, and bookable.
7. Service menu digit 4 and staff menu digit 4 remain correctly scoped.
8. Explicit 0 routes to operator, says the wait phrase once, and does not write service/staff data.
9. FallbackIntent plus a valid current DB service name becomes `BookAppointmentIntent` and advances to the next missing slot.
10. No-match/no-input/API timeout does not auto-transfer.
11. Multi-slot speech and correction preserve confirmed fields.
12. Queue/hold path attributes are correct.

### Agent provisioning/cleanup

13. AWS create success + DB success produces a linked active agent.
14. AWS create failure does not report success and leaves a retryable/clean state.
15. DB failure after AWS creation triggers compensation.
16. Delete removes the mapped Connect user and local test account safely.
17. Cleanup dry-run finds strict smoke rows only.
18. Cleanup never selects a real/demo agent such as Anna Vo or `agent.demo@fastaibooking.local`.

### CRUD/push/admin

19. Service and staff CRUD authorization and soft-delete invariants.
20. Push token registration/logout/invalid-token cleanup and one-event-one-push behavior.
21. Create-salon request is idempotently protected against double submit at the UI level and creates owner/settings/hours correctly.
22. Navigation active-route helper tests if feasible without adding a heavy UI test framework.
23. Admin API delete/cleanup routes require platform admin.

Run:

```bash
npm ci
npm --prefix apps/api run prisma:generate
npm run test:lambda
npm run test:api
npm run typecheck:api
npm run build:api
npm run typecheck:admin
npm run build:admin
npm run typecheck:app
npm run build:app
node --check infra/lambda/booking-handler/index.mjs
docker compose config
git diff --check
```

Also run Nginx configuration validation against the actual container/config after editing.

## 9. Production deployment and verification

Before deploy:

- Back up PostgreSQL with timestamp and verify backup size.
- Record current API/admin/app image IDs, migration state, Lambda SHA, Lex alias/version, and Connect flow versions.
- Run cleanup in dry-run mode and save the exact preview.

Deploy only the changed components in dependency order:

1. additive DB migration,
2. API,
3. admin/app frontends,
4. Lambda,
5. Lex version/alias only if truly required,
6. Connect flow/queue flow,
7. edge Nginx/Adminer route.

After deploy, verify live resources, not repository files:

1. DB active service/staff counts for the target salon.
2. Runtime generated service menu equals DB order and IDs.
3. Nine-service fixture/test proves 1..9 and 0 operator.
4. Speech service and DTMF service both advance to date, not repeat service.
5. Explicit 0 says the wait prompt, enters the correct queue, and produces audible hold music.
6. No-input/no-match stays in AI flow and offers, but does not force, operator.
7. Create one controlled agent only if needed; prove local login + Connect user/CCP, then either keep it only when it is an intended real account or delete it completely.
8. Apply strict smoke-agent cleanup and confirm no `Smoke Agent` remains.
9. Create/edit/deactivate/delete service and staff in a non-persistent integration test; verify AI catalog refresh.
10. Controlled push test returns success to an authorized registered device, or clearly documents a real missing-token/config blocker with server evidence.
11. `/db.php` returns protected Adminer, while normal admin SPA routes still work.
12. `/salons/new` highlights one nav item only.
13. Agent page has no horizontal overflow at common desktop widths.
14. Production health endpoints, login, and key CRUD flows work for platform admin, salon owner, staff, and call-center agent.
15. No new synthetic AI/call log is visible by default.

## 10. Compact diagnostics and final report

Create only these three compact files so the result can be zipped and reviewed quickly:

- `diagnostics/codex-run/commands.log` — important commands, UTC timestamps, exit codes, concise relevant output; no secrets and no huge CloudWatch dumps.
- `diagnostics/codex-run/verification.json` — valid JSON containing deployed resource IDs/versions, DB counts, call-flow assertions, agent cleanup counts, push result, Adminer HTTP result, and UI verification notes.
- `diagnostics/codex-run/99-final-report.md` — final report in Vietnamese.

The Vietnamese final report must include:

1. Root causes found.
2. Exact files changed and why.
3. Database migration and backup result.
4. Dynamic service/staff menu proof, including the 9-service/0-operator assertion.
5. Natural speech, wait prompt, queue, and hold-music verification.
6. Agent DB/AWS provisioning behavior and live IDs/status, without passwords.
7. Smoke cleanup dry-run and applied counts; confirmation that real agents/calls were not deleted.
8. Push notification test result.
9. Adminer security and HTTP verification.
10. Admin/app CRUD smoke matrix.
11. Every test/build command and pass/fail count.
12. Deployed image/resource versions.
13. Commit hash, branch, and push result.
14. Any remaining blocker, with exact evidence and the smallest next action.

Do not say “fixed” unless production evidence satisfies the acceptance criteria. Keep the work focused on call flow, push notifications, and reliable create/edit/delete operations.

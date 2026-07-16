# Silent Disconnect, Latency, Any Staff Run Report - 2026-07-16

## Scope

Production target:

- Phone: `+18483487681`
- Caller: `+84798171999`
- Salon timezone: `America/New_York`
- Connect flow: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Lex bot/alias: `KHMIXGA2US / JVIPIZDYE3`
- Lambda: `fastaibooking-booking-handler`

Changed only the requested surfaces: Amazon Connect AI Reception flow, Lex v10 runtime/config source, booking-handler Lambda, API call-state/log reconciliation, Admin debug export, and regression tests.

## 15:16-15:28 Contacts

Full exported investigation: `docs/live-thuyet-silent-disconnect-2026-07-16.json`.

| ContactId | UTC window | Disconnect reason | Lambda/API | Result |
| --- | --- | --- | --- | --- |
| `6edfc3a6-89a2-44ba-a151-32b2bbe53b19` | 08:15:44-08:15:55 | not returned by Connect | no Lambda, no API log | stopped in Connect/Lex prompt path |
| `ef194542-01bb-4133-a639-a2ab33c363bc` | 08:16:19-08:16:30 | not returned by Connect | no Lambda, no API log | stopped in Connect/Lex prompt path |
| `8f9938a7-72c7-4d37-bbd2-af85234b62cd` | 08:16:39-08:17:29 | not returned by Connect | invoked | booked Full Set today 3 PM with Amy |
| `9e1fb594-2a72-42ba-b2d3-728b87c21d40` | 08:17:41-08:18:24 | `CUSTOMER_DISCONNECT` from tester/provider debug | invoked | corrupted nonterminal state: `3 PM at 3 PM` |
| `57b5d7cf-1206-4b5a-8990-ac706e8f9bc3` | 08:21:50-08:22:41 | not returned by Connect | no Lambda, no API log | likely 15:22 call; stopped in Connect/Lex prompt path |
| `df6c4ae8-35f0-44a0-baa4-f964960d394b` | 08:23:02-08:23:53 | not returned by Connect | invoked | booked Full Set today 3 PM with Amy |
| `cf5225c5-85ad-4a75-bd12-85e51d5cf310` | 08:24:20-08:25:30 | not returned by Connect | invoked | nonterminal service recovery; caller/provider disconnected |
| `bea48eb5-368d-4011-97f4-7fba2d126a1f` | 08:26:36-08:27:11 | `CUSTOMER_DISCONNECT` from tester/provider debug | invoked | any-staff ASR miss, then stale empty turn after disconnect |
| `b1a7727b-254a-451c-9332-1087aa7f773f` | 08:27:45-08:28:39 | not returned by Connect | no Lambda, no API log | stopped in Connect/Lex prompt path |
| `7992ea20-deff-452e-ad0d-27e9698f2174` | 08:28:47-08:30:11 | not returned by Connect | invoked | booked Full Set today 3 PM with Trang |

The contact beginning at `08:30:18Z`, `d5b163d9-666f-457a-8ace-94caad0b8b3d`, was included in the exported file because it started inside the query window, but it disconnected after the requested end time.

## 15:22 Investigation

Likely 15:22 Vietnam-time ContactId: `57b5d7cf-1206-4b5a-8990-ac706e8f9bc3`.

Where it stopped: `Connect/Lex prompt path before booking-handler Lambda`.

Evidence:

- Amazon Connect returned the contact in the requested `2026-07-16T08:15:00Z` through `2026-07-16T08:30:30Z` search.
- No booking-handler Lambda log event contains the ContactId.
- No production API `CallSession` or `AIInteraction` exists for the ContactId.
- No transcript exists in Lambda/API logs.
- Connect flow logging is enabled, but `/aws/connect/fastaibooking` had no events for the window, so exact Connect action playback/error branch was not observable from CloudWatch.

## Root Causes

`3 PM at 3 PM`: date/time reconciliation accepted a time phrase as `requestedDate`. The formatter then rendered the invalid date as if it were a date and repeated the same value as time. Fix: strict date normalization now accepts only ISO dates, salon-timezone `today`/`tomorrow`, or resolved weekdays; invalid dates are cleared and never rendered.

Any-staff miss: production ASR transformed `any staff is fine` into tails such as `and it's top five` and `and it's thirty five`. Lex had exact any-staff aliases, but runtime code did not safely recover these distorted staff-tail forms. Fix: Lex custom vocabulary and staff synonyms were expanded, runtime hints include the exact phrases, and guarded contextual recovery maps observed tails to `Any staff` only when service/date/time are present and staff is the only missing field.

Silent/ambiguous disconnect risk: the Connect flow trusted `conversationComplete` alone and final recovery could head toward disconnect after Lex errors. Fix: Connect now also checks `conversationOutcome in BOOKED, RESCHEDULED, CANCELED, CALLER_GOODBYE`; Lex error/no-match recovery returns to Lex with preserved attributes and no Lex error transition points directly to disconnect.

Stale post-disconnect turn: the `bea48...` empty turn arrived after provider disconnect. Fix: API reconciliation rejects post-provider-disconnect turns with `staleOrDuplicateRejectionReason=provider_disconnected`, does not mutate booking state/counters/final resolution, and reconciles the `CallSession` to `COMPLETED`.

## Endpointing Before/After

Connect session attributes before:

- global start timeout `7000`
- global end timeout `2400`
- max audio `20000`
- service slot end timeout `2200`
- requested date did not have a slot-specific override
- requested time `1600`, staff `1600`, customer name `2000`

Connect session attributes after:

- global start timeout `8000`
- initial/free-form global end timeout `3200`
- max audio `20000`
- service slot end timeout `1800`
- requested date `1600`
- requested time `1600`
- staff `1600`
- customer name `2000`

Lex v38 slot prompt timing after:

- `serviceName`: start `8000`, end `1800`, max `20000`
- `requestedDate`: start `8000`, end `1600`, max `20000`
- `requestedTime`: start `8000`, end `1600`, max `20000`
- `staffPreference`: start `8000`, end `1600`, max `20000`
- `customerName` and `customerPhone`: start `8000`, end `2000`, max `20000`

## AWS Deploy Verification

- API/admin/app: `npm run deploy:ec2` completed; API container rebuilt as `sha256:a6ea583bcf2b73f9d9392ee0a9a8076583c770614f12bacdeec96d394f8fac76`; migrations had no pending changes; production smoke script passed.
- Lambda before: LastModified `2026-07-15T17:40:04.000+0000`, CodeSha256 `Ulj4wXWXPmwq0AKmgg53oEbag2STrU7IUH9So2M7nDI=`.
- Lambda after: LastModified `2026-07-16T10:07:25.000+0000`, State `Active`, LastUpdateStatus `Successful`, CodeSha256 `yAAMzgfUpDjzjOeZ7Y86G5DK+7uwK9wMB3UZwKkphx4=`.
- Lex alias before: `prod` version `37`.
- Lex alias after: `prod` version `38`, status `Available`, Lambda hook unchanged.
- Lex v38 custom vocabulary: `Full Set`, `Any staff`, `Any staff is fine`, `First available`, `Whoever is available`.
- Lex v38 service synonyms include guarded `cool set`.
- Connect flow deployed and active/published. Canonical local/remote hash: `f442d49c68aa34ec00ec046cc8f73d14d262e4a0a730e64dd272f1efb0288410`.
- Phone association verified by `list-flow-associations`: phone ARN for `f2e36faa-5264-4955-8a18-e2f53755c102` maps to flow ARN ending `dcccf542-587c-426c-a644-a4c6f24da6e4`.
- Connect flow logging attribute: `CONTACTFLOW_LOGS=true`.

## Tests

- `node --check infra/lambda/booking-handler/index.mjs`: pass
- `npm run test:lambda`: pass, 139/139
- `npm run test:api`: pass, 283/283
- `npm run typecheck:api`: pass
- `npm run build:api`: pass
- `npm run typecheck:admin`: pass
- `npm run build:admin`: pass, with existing Vite chunk-size warning
- `git diff --check`: pass before report creation; rerun before commit
- `./infra/scripts/smoke_test_production.sh`: pass

New regression coverage includes nonterminal never-disconnect cases, terminal success, backend failure, invalid date clearing, clipped partial utterances, slow segmented booking, exact and observed any-staff variants, negative requested-time context, stale post-disconnect rejection, no question before disconnect, and active-booking final recovery preservation.

## Deployed Runtime Smokes

Artifacts: `docs/report-artifacts/2026-07-16-silent-disconnect-latency-any-staff/lex-smokes/`.

- `codex-smoke-20260716-exact`: `Full Set today at 3 PM with Amy.` -> confirmation for Full Set today 3 PM with Amy, `conversationComplete=false`.
- `codex-smoke-20260716-any-staff`: `Full Set today at 3 PM, any staff is fine.` -> selected Kevin and confirmed Full Set today 3 PM, `conversationComplete=false`.
- `codex-smoke-20260716-any-top-five`: `full set today at three pm and it's top five` -> selected Kevin and confirmed Full Set today 3 PM, `conversationComplete=false`.
- `codex-smoke-20260716-at-3-amy`: `At 3 PM with Amy.` -> `I caught 3 PM with Amy. What day and service would you like?`, date unset, `conversationComplete=false`.
- `codex-smoke-20260716-slow-segmented`: `Full Set` -> `today at 3 PM` -> `with Amy` preserved state and reached confirmation for Full Set today 3 PM with Amy.

No final `yes` was sent in these smokes, so no smoke appointment booking was intentionally completed.

## Live ViberOut Acceptance

Real ViberOut/PSTN calls cannot be originated from this Codex environment. I did not claim final handset acceptance based only on typed Lex/runtime tests. The six requested acceptance calls still need to be placed from the tester device or another real caller path and captured with ContactId, transcript, turn processing time, disconnect reason, final Connect branch, and final appointment status.

## Commit

- Pushed branch: `main`
- Commit hash: assigned after this report is committed; final pushed hash is reported in the agent final response.

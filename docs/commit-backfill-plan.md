# FastAIBooking Commit Backfill Plan

This plan was created as the review artifact for rebuilding the FastAIBooking history
into smaller, believable commits. It was reviewed and then executed on 2026-04-17.

Execution note: the final backfill was consolidated into 40 chronological commits.
Some planned Vietnamese localization and UI polish groups were folded into the commits
that introduced the affected screens because the final working tree already contained
the Vietnamese-first copy and empty-state behavior at those file boundaries.

## Repository Observations

- Current branch: `main`, tracking `origin/main`.
- Existing history has only three broad commits:
  - `bb093c8` on 2026-03-30: `init code`
  - `2ddad7e` on 2026-04-03: `update admin and app`
  - `94fab97` on 2026-04-13: `update vietnamese and call center feature`
- The current worktree has additional modified and untracked source files.
- Current monorepo apps:
  - `apps/api`: Express, TypeScript, Prisma, PostgreSQL backend.
  - `apps/admin`: React/Vite platform admin.
  - `apps/app`: React/Vite shared business app for owner, staff, and call center agent/operator.
- Current backend domains include auth, salon, staff, services, business hours, customers,
  appointments, availability, billing, admin, calls, AI logs, alerts, messages, feedback,
  and call center.
- Current frontend direction is Vietnamese-first, with real API wiring and role-guarded
  owner, staff, and operator flows.
- `apps.zip` is untracked and appears to be a generated/archive artifact. It should not be
  included in the backfilled product history unless explicitly requested.
- `fastAibooking.pem` is ignored and should remain untracked.

## Backfill Strategy

- Rebuild history from 2026-03-30 through the current working state as of 2026-04-17.
- Keep the configured Git author identity unchanged.
- Preserve business meaning over cosmetic history shaping.
- Prefer whole-file commits when a file maps cleanly to one concern.
- Use hunk-level staging only where a file clearly contains separate, safe concerns.
- Do not split a file into commits that would leave missing imports, undeclared variables,
  or obviously broken intermediate flows.
- Treat the plan file itself as a review artifact until review is complete. After approval,
  it can be committed as the final documentation commit for traceability.
- Exclude generated archives and local secrets from all planned commits.

## Proposed Day-by-Day Timeline

### Day 01 - 2026-03-30

Summary: Initialize the repository, workspace metadata, and deployable service skeleton.

Planned commits:

1. `bootstrap monorepo workspace and repository metadata`
2. `add Docker Compose and Nginx deployment scaffold`
3. `configure Express API shell with health checks and request middleware`

### Day 02 - 2026-03-31

Summary: Establish the initial Prisma domain and reusable API foundation.

Planned commits:

1. `add Prisma schema for salon booking core models`
2. `add demo seed data for salon onboarding workflows`
3. `add API environment, logging, error, auth, and response utilities`

### Day 03 - 2026-04-01

Summary: Build the first authenticated owner and salon backend flows.

Planned commits:

1. `implement owner authentication and password reset APIs`
2. `add salon profile and settings APIs`
3. `add staff, services, and business hours APIs`

### Day 04 - 2026-04-02

Summary: Add the booking domain and billing usage rule.

Planned commits:

1. `implement customer management APIs`
2. `add appointment scheduling, status history, and availability checks`
3. `add billing usage calculation for free and billable staff`

### Day 05 - 2026-04-03

Summary: Add platform admin backend coverage and API validation assets.

Planned commits:

1. `add platform admin auth, salon listing, and overview APIs`
2. `add admin salon detail APIs for profile, staff, services, hours, customers, and appointments`
3. `add Postman collection and API environment examples`

### Day 06 - 2026-04-04

Summary: Scaffold the admin web app and connect it to real admin APIs.

Planned commits:

1. `scaffold platform admin React app with auth and API client`
2. `add admin layout, guards, shared states, and toast components`
3. `add admin dashboard, salon list, salon create, and salon detail screens`

### Day 07 - 2026-04-05

Summary: Scaffold the shared business app and owner authentication experience.

Planned commits:

1. `scaffold shared business React app with session-aware API client`
2. `implement owner register, login, forgot password, and reset password screens`
3. `add owner dashboard and salon profile screens wired to API`

### Day 08 - 2026-04-06

Summary: Fill in core owner web workflows.

Planned commits:

1. `add owner staff and services management screens`
2. `add owner business hours, customers, appointments, and availability screens`
3. `add owner billing page for active staff usage`

### Day 09 - 2026-04-07

Summary: Add staff role support and protected staff app behavior.

Planned commits:

1. `add staff role support to auth tokens and Prisma user links`
2. `enforce staff account and salon access checks in API middleware`
3. `add staff login, dashboard, appointment, availability, and profile flows`

### Day 10 - 2026-04-08

Summary: Wire frontend deployment and production infrastructure around the monorepo.

Planned commits:

1. `add Docker builds for admin and shared business frontends`
2. `wire workspace build, typecheck, migration, and seed scripts`
3. `document local development, domains, and EC2 deployment workflow`

### Day 11 - 2026-04-09

Summary: Add call ingestion and AI booking groundwork after the core salon flows.

Planned commits:

1. `add CallRail, transcript, booking attempt, AI log, and integration config models`
2. `implement CallRail provider and webhook ingestion route`
3. `add Vertex AI provider, booking extraction prompts, and AI interaction logging`

### Day 12 - 2026-04-10

Summary: Expose call and AI operations to owners and admins.

Planned commits:

1. `add owner call log and AI log APIs`
2. `add admin call log, call detail, and AI log APIs`
3. `add call and AI log screens to admin and owner apps`

### Day 13 - 2026-04-11

Summary: Move booking workflows toward demo-ready salon operations.

Planned commits:

1. `add demo-ready booking migration for work sessions, reminders, alerts, messages, and feedback`
2. `support multi-service appointments, duration tracking, and staff work states`
3. `add alerts, messages, feedback, and SMS notification APIs`

### Day 14 - 2026-04-12

Summary: Wire the new operational workflows into the shared app.

Planned commits:

1. `wire appointment start, extend, done, reminder, and feedback flows in the app`
2. `add owner and staff alerts, messages, and feedback screens`
3. `update seed data and smoke tests for demo booking workflows`

### Day 15 - 2026-04-13

Summary: Add call center agent support and assignment-managed operator APIs.

Planned commits:

1. `add call center agent role, login route, and salon assignment model`
2. `implement call center APIs for assigned salons, customers, staff, services, and appointments`
3. `add admin call center agent management and salon assignment controls`

### Day 16 - 2026-04-14

Summary: Add the operator workspace and separate owner, staff, and call center navigation.

Planned commits:

1. `add operator workspace for assigned salon booking workflows`
2. `wire operator create, update, reschedule, and cancel appointment actions`
3. `separate owner, staff, and call center menus with role guards`

### Day 17 - 2026-04-15

Summary: Prioritize Vietnamese-first UI copy and clean up dashboard interactions.

Planned commits:

1. `localize admin navigation and dashboard copy to Vietnamese`
2. `localize owner, staff, auth, and operator workflows to Vietnamese`
3. `add reusable form dialogs for appointment and salon edit actions`

### Day 18 - 2026-04-16

Summary: Add final integration and deployment polish present in the current worktree.

Planned commits:

1. `add Amazon Connect as an external provider option`
2. `expose Amazon Connect in salon integration settings`
3. `add remote EC2 deploy script and workspace deploy command`

### Day 19 - 2026-04-17

Summary: Land final UI state handling and documentation alignment for the current state.

Planned commits:

1. `add empty states and filters to appointment and operator queues`
2. `polish admin and app dashboard layouts for Vietnamese demo workflows`
3. `update README with current API coverage and remote deployment notes`

## Risk Notes and Ambiguities

- The current Git history is too coarse to recover exact original development order. The
  proposed order is inferred from migrations, route/module shape, page structure, and the
  existing commit timestamps.
- `202604010001_callrail_vertex_integration` appears early by migration filename, while
  product guidance says call center groundwork should come later. The plan places call
  ingestion and AI groundwork after core salon and web flows. If migration filenames must
  strictly match commit dates, that portion should move earlier.
- `202604160001_amazon_connect_provider` is currently untracked. The plan treats it as a
  late integration-groundwork commit because it only adds the `AMAZON_CONNECT` provider enum.
- Several files contain many concerns, especially `apps/admin/src/pages/salon-detail-page.tsx`,
  `apps/app/src/pages/appointments-page.tsx`, and `apps/app/src/pages/call-center-page.tsx`.
  During backfill, these should only be split by hunks when imports and intermediate behavior
  remain coherent.
- The existing repository tracks `.idea` files from the initial commit. The backfill can
  preserve them in the bootstrap commit for fidelity, but removing them would be a separate
  cleanup decision and would change the tracked final state.
- `apps.zip` is untracked and should be excluded from commit history as a generated artifact.
- The saved plan file is intentionally uncommitted for review. If the reviewer wants it
  preserved in history, add a final docs commit such as `document commit backfill plan`.
  That final docs commit was included after approval.

## Planned Verification After Backfill

Run these checks after reconstructing the commits:

1. `npm --workspace @fastaibooking/api run typecheck`
2. `npm --workspace @fastaibooking/admin run typecheck`
3. `npm --workspace @fastaibooking/app run typecheck`
4. `npm --workspace @fastaibooking/api run build`
5. `npm --workspace @fastaibooking/admin run build`
6. `npm --workspace @fastaibooking/app run build`
7. `git status --short --branch`

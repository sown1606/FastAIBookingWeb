# Demo Test Plan

## URLs

- Owner / Staff / Operator app: `https://app-new-nail.kendemo.com/login`
- Platform admin: `https://admin-new-nail.kendemo.com/login`
- API base: `https://api-new-nail.kendemo.com`

## Demo Accounts

- Platform admin: `admin@fastaibooking.local / Admin123!`
- Salon owner: `owner.demo@fastaibooking.local /`` Owner123!`
- Staff: `staff.demo@fastaibooking.local / Staff123!`
- Call center agent: `agent.demo@fastaibooking.local / Agent123!`
- Extra owner for call-center scenario: `owner.callcenter.demo@fastaibooking.local / Owner123!`

## Admin Smoke Test

1. Log in at `/login` with `admin@fastaibooking.local`.
2. Open Dashboard and confirm metrics cards render.
3. Open Salons and confirm at least one seeded salon appears.
4. Open the seeded salon detail page.
5. Verify each section loads:
   - profile
   - settings
   - staff
   - services
   - business hours
   - customers
   - appointments
   - billing usage
   - integrations
   - AI Reception
   - Call Center assignments
   - call logs
6. Save a small profile update and revert it if needed.
7. Open Call Center Agents and confirm the seeded agent appears.
8. Open Calls and AI Logs and confirm list data is visible.
9. Open Health and confirm readiness cards show truthful provider state.

## Owner Smoke Test

1. Log in at `/login` with `owner.demo@fastaibooking.local`.
2. Confirm the sidebar includes:
   - dashboard
   - salon profile
   - staff
   - services
   - business hours
   - customers
   - appointments
   - availability
   - messages
   - alerts
   - calls
   - AI logs
   - billing
3. Open Salon Profile.
4. Confirm profile fields load.
5. Save a salon profile change with a valid US phone number format.
6. Confirm AI Reception settings load and save:
   - `aiReceptionEnabled`
   - `aiTransferRingCount`
   - `aiGreetingPrompt`
   - `callerLanguage`
   - `voicemailEnabled`
   - `callbackRequestEnabled`
   - `smsFallbackEnabled`
   - `notificationRecipients`
   - `callLogVisibility`
7. Confirm Human Call Center settings load and save:
   - `callCenterEnabled`
   - `callCenterRoutingNumber`
   - `callCenterRoutingNote`
8. Confirm there is no UI text implying a separate `afterHoursAiEnabled` toggle.
9. Open Calls and AI Logs and confirm seeded call records are visible.

## Staff Smoke Test

1. Log in at `/login` with `staff.demo@fastaibooking.local`.
2. Confirm the sidebar includes only:
   - dashboard
   - appointments
   - availability
   - messages
   - my profile
3. Confirm owner-only pages are not shown in navigation.
4. Open Appointments and confirm only appointments assigned to this staff member are listed.
5. Update an allowed appointment action such as status or work start/done.
6. Open My Profile and confirm profile update works.
7. Change the password and confirm the request succeeds.
8. Manually open an owner-only route such as `/staff` or `/billing` and confirm redirect does not loop.

## Operator Smoke Test

1. Log in at `/login` with `agent.demo@fastaibooking.local`.
2. Confirm the sidebar includes only:
   - dashboard
   - call center
3. Open Call Center and confirm the queue is not empty after seed.
4. Open the newest escalation detail and verify:
   - transcript
   - AI summary
   - booking attempts
   - customer matches
   - salon context
5. Confirm runtime shows Amazon Connect readiness.
6. If Amazon Connect is not configured, confirm the page shows disabled/setup state truthfully.
7. Accept the escalation.
8. Update operator notes.
9. Update QA notes.
10. Complete the escalation.
11. Create a callback request.
12. Capture voicemail metadata.
13. Trigger SMS fallback and confirm the app shows request state, not fake delivery.

## Operator Appointment Workflow Test

1. Stay logged in as `agent.demo@fastaibooking.local`.
2. In Call Center, select the seeded salon.
3. Create a customer.
4. Create an appointment for that customer.
5. Update the appointment status.
6. Reschedule the appointment.
7. Cancel the appointment.
8. Confirm each action updates the detail panel without authorization errors.

## AI Creates Booking From Transcript Test

1. Log in as owner.
2. Open Calls or AI Logs.
3. Find the seeded booking call with provider call id `demo-call-booking-1`.
4. Confirm the transcript summary describes a gel manicure booking request.
5. Confirm a booking attempt exists with success status.
6. Confirm the linked appointment exists and is associated with the seeded customer and staff member.

## AI Escalates To Operator Test

1. Log in as operator.
2. Open Call Center queue.
3. Find the seeded escalation tied to provider call id `demo-call-escalation-1`.
4. Confirm the routing outcome is call center escalation.
5. Confirm the assigned operator is the seeded demo agent.
6. Confirm the transcript shows a live-person request.

## Integration Readiness Test

1. Log in as admin.
2. Open Health.
3. Confirm CallRail readiness shows configured only when env and active config are sufficient.
4. Confirm Amazon Connect readiness shows configured only when env and active config are sufficient.
5. Confirm Vertex readiness shows configured only when project and credentials are sufficient.
6. Confirm each not-ready integration lists the missing requirements clearly.

## Expected Current External Limitations

- Amazon Connect live softphone is unavailable until valid env vars and an active `AMAZON_CONNECT` integration config are present.
- CallRail live routing is unavailable until valid env vars and an active `CALLRAIL` integration config are present.
- Vertex live AI is unavailable until valid credentials are configured.
- SMS fallback is currently stub/log-only.

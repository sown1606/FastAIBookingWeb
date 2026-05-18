# Demo Test Plan

## URLs

- Owner / Staff / Operator app: `https://app-new-nail.kendemo.com/login`
- Platform admin: `https://admin-new-nail.kendemo.com/login`
- API base: `https://api-new-nail.kendemo.com`

## Live Amazon Connect Demo Number

- Demo number: `+1 848-348-7681`
- Expected first experience: Amazon Connect answers, sets voice, plays the AI greeting, then enters Amazon Lex `FastAIBookingBot`.
- Caller should not hear queue or hold music at entry.
- Queue music is expected only after the caller explicitly asks for a human and `HumanEscalationIntent` routes to `Set working queue -> Transfer to queue`.
- Current web AI ON/OFF setting is saved in the backend/admin app, but the AWS Connect inbound flow does not read that setting before Lex yet.

## Demo Accounts

- Platform admin: `admin@fastaibooking.local / Admin123!`
- Salon owner: `owner.demo@fastaibooking.local / Owner123!`
- Staff: `staff.demo@fastaibooking.local / Staff123!`
- Call center agent: `agent.demo@fastaibooking.local / Agent123!`
- Extra owner for call-center scenario: `owner.callcenter.demo@fastaibooking.local / Owner123!`

## Amazon Connect Demo Scenarios

### Demo Scenario 1: Direct Call Into Amazon Connect

1. Customer calls demo number `+1 848-348-7681`.
2. Amazon Connect Contact Flow answers the call.
3. Flow sets text-to-speech voice.
4. Flow plays the FastAIBooking AI greeting.
5. Flow enters Lex `FastAIBookingBot`.
6. Dashboard records or displays the contact/call session if the backend integration exists.

### Demo Scenario 2: AI Booking

1. Customer calls demo number `+1 848-348-7681`.
2. Amazon Connect runs the AI Booking Reception flow.
3. Customer can start with: "Hi, I want to book a pedicure appointment tomorrow at five PM."
4. Amazon Lex Booking Bot and the booking backend collect only missing details:
   - customer name
   - customer phone
   - service
   - requested date/time
   - staff preference if any
5. "Tomorrow" and "five PM" are interpreted in the salon timezone. For the New Jersey demo salon, this is `America/New_York`.
6. If the caller says "pedicure" or a close ASR variant such as "bettercure", the backend should match or confirm the closest active service instead of transferring immediately.
7. If the caller asks for a staff member, for example "Trang", the backend checks that staff member's availability before booking.
8. Booking Lambda or FastAIBooking Backend API checks services, staff, business hours, and availability.
9. Backend creates a real appointment, sends SMS confirmation when SMS is configured, and safely logs a skipped SMS when config is missing.
10. Owner sees the new appointment in the dashboard at the local salon time.
11. Assigned Staff sees the appointment in their schedule.

### Demo Scenario 2A: Staff Preference

1. Customer says: "Hi, I want to book a pedicure with Trang tomorrow at five PM."
2. Expected result:
   - service resolves to `Pedicure`
   - staff preference resolves to `Trang`
   - requested time resolves to 5:00 PM in `America/New_York`
   - if Trang is available, the appointment is booked with Trang
   - if Trang is busy, AI suggests a short alternative such as another staff member at 5:00 PM or Trang's nearest available time

### Demo Scenario 2B: Misheard Service

1. Simulate or say: "bettercure tomorrow at five PM."
2. Expected result: AI asks a service clarification such as "Did you mean Pedicure?"
3. Caller should not be transferred to the operator queue after the first service mismatch.

### Demo Scenario 3: Human Escalation

1. Customer calls demo number `+1 848-348-7681`.
2. Customer first hears the AI greeting and Lex prompt, not queue music.
3. Customer says they want to speak with a real person.
4. AI says: "No problem. Please hold while I connect you to our team."
5. Amazon Connect transfers the call to the Operator Queue.
6. Operator answers using Amazon Connect CCP/browser softphone.
7. Operator manages the booking in the FastAIBooking operator dashboard.
8. Owner/Admin can see call status and result.

### Demo Scenario 4: No Operator Available

1. Customer waits in the Operator Queue.
2. If timeout happens, system offers voicemail, callback request, or SMS link fallback if enabled.
3. Dashboard records fallback status.

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

## Kịch bản demo Admin

1. Đăng nhập Admin tại `https://admin-new-nail.kendemo.com/login`.
2. Mở Dashboard và kiểm tra số liệu tổng quan.
3. Mở Salons, chọn salon demo, kiểm tra hồ sơ, dịch vụ, nhân viên, lịch làm việc, appointments, integrations, AI Reception và Call Center.
4. Mở Calls và AI Logs để xác nhận cuộc gọi/booking từ Amazon Connect được ghi nhận.
5. Mở Health để xác nhận Amazon Connect, Lex, Lambda và API đang hiển thị đúng trạng thái cấu hình.

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
   - call center
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
9. Open Call Center and confirm the owner monitoring view shows:
   - assigned operator list
   - queue metrics
   - fallback states
   - selected escalation detail
10. Open Calls and AI Logs and confirm seeded call records are visible.

## Kịch bản demo Owner

1. Đăng nhập Owner tại `https://app-new-nail.kendemo.com/login`.
2. Mở Salon Profile, kiểm tra thông tin salon, dịch vụ, nhân viên và giờ làm việc.
3. Mở Appointments để xác nhận appointment mới từ AI xuất hiện sau cuộc gọi demo.
4. Mở Calls hoặc AI Logs để kiểm tra transcript, booking attempt, call session và kết quả booking.
5. Mở Call Center để xem trạng thái escalation nếu khách yêu cầu gặp người thật.

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

## Kịch bản demo Operator

1. Đăng nhập Operator tại `https://app-new-nail.kendemo.com/login`.
2. Mở Call Center và để Amazon Connect CCP/browser softphone ở trạng thái Available.
3. Khi khách nói muốn gặp người thật, xác nhận CCP đổ chuông sau khi AI nhận `HumanEscalationIntent`.
4. Nhận cuộc gọi, mở escalation detail, kiểm tra transcript, AI summary, booking attempts và customer context.
5. Ghi chú cuộc gọi, cập nhật trạng thái xử lý và hoàn tất escalation.

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
3. Find the seeded booking call with provider call id `demo-forwarding-call-1`.
4. Confirm the transcript summary describes a gel manicure booking request.
5. Confirm a booking attempt exists with success status.
6. Confirm the linked appointment exists and is associated with the seeded customer and staff member.

## AI Escalates To Operator Test

1. Log in as operator.
2. Open Call Center queue.
3. Find the seeded escalation tied to provider call id `demo-escalation-open-1`.
4. Confirm the queue item is still open and the routing state is queued for operator handling.
5. Confirm the assigned operator pool includes the seeded demo agent.
6. Confirm the transcript shows a live-person request.

## Integration Readiness Test

1. Log in as admin.
2. Open Health.
3. Confirm Amazon Connect readiness shows configured only when env and active config are sufficient.
4. Confirm Amazon Lex / Amazon AI readiness is represented by the configured bot, alias, locale, and intent values in the deployment checklist.
5. Confirm each not-ready integration lists the missing requirements clearly.

## Expected Current External Limitations

- Amazon Connect live demo number is `+1 848-348-7681`; it should enter AI reception first.
- Amazon Connect live softphone requires valid env vars, an assigned phone number, and an active `AMAZON_CONNECT` integration config.
- Amazon Lex Booking Bot and Booking Lambda require the bot, alias, intents, Lambda function, and backend internal token to stay configured.
- Queue music should only happen after explicit human escalation.
- Web AI ON/OFF is saved in the backend/admin app, but the AWS Connect inbound flow does not read it before Lex yet.
- SMS confirmation sends only when SMS provider config is available; booking should still succeed and log a safe skip when config is missing.

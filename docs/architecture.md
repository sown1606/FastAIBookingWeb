# Architecture

## Target Demo Architecture

FastAIBooking now uses Amazon Connect directly as the main telephony, AI call flow, queue, and human escalation layer.

```text
Salon original number: 848-702-9493
  -> Amazon Connect phone number
  -> Amazon Connect Contact Flow
  -> Amazon Lex Booking Bot
  -> Booking Lambda or FastAIBooking Backend API
  -> real appointment
  -> Owner dashboard and assigned Staff schedule
  -> Operator Queue if human help is requested or required
```

CallRail is not part of the main call flow and is not required for the current demo.

## AI Booking Reception

- Customer calls the salon original number, `848-702-9493`.
- The salon carrier forwards the call directly to the Amazon Connect phone number.
- Amazon Connect runs the inbound Amazon Connect Contact Flow.
- Amazon Lex Booking Bot asks for booking details.
- AI collects service, date, time, customer phone/name, and staff preference if any.
- Booking Lambda or FastAIBooking Backend API checks real services, staff, business hours, and availability.
- FastAIBooking Backend API creates a real appointment.
- Owner sees the appointment in the dashboard.
- Assigned Staff sees the appointment in their schedule.

## Human Call Center

- If the caller asks for a real person, AI says: "Please wait while I connect you."
- Amazon Connect transfers the call to the Operator Queue.
- Operator uses Amazon Connect CCP/browser softphone.
- Operator uses the FastAIBooking operator dashboard to create, update, reschedule, cancel bookings, and add notes.
- Data syncs back to the Owner/Admin dashboard.

## Fallback Behavior

If no operator is available, fallback behavior should stay configurable:

- voicemail
- callback request
- SMS link

The dashboard should record the fallback status so Owner/Admin users can follow up.

## Next Implementation Checklist

Backend:

- Add or verify Amazon Connect contact session model if needed.
- Add endpoint for Booking Lambda to create appointment.
- Add internal auth token validation for Lambda.
- Add endpoint to record contact flow result.
- Add appointment creation from AI payload.
- Ensure Owner and assigned Staff can see created appointment.

Amazon Connect:

- Claim or assign Amazon Connect phone number.
- Assign AI Booking Reception contact flow to the number.
- Configure Amazon Lex Booking Bot in the Get customer input block.
- Configure Lambda invocation for booking availability and creation.
- Configure Transfer to queue block for human escalation.
- Configure operator user, queue, routing profile, and CCP access.

Frontend:

- Owner dashboard shows new appointments.
- Staff dashboard shows assigned appointments.
- Operator dashboard shows call center queue/request context.
- Admin dashboard shows integration health.

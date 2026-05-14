# Telephony

## Primary Provider

Amazon Connect is the primary phone, AI call flow, Operator Queue, and human escalation provider for the current demo.

Use these provider values:

```dotenv
CALL_PROVIDER=amazon_connect
AI_PROVIDER=amazon
```

`AI_PROVIDER=lex` is accepted as an Amazon Lex alias for the same live demo path.

## Main Call Flow

```text
Salon original number: 848-702-9493
  -> carrier forwards directly to Amazon Connect phone number
  -> Amazon Connect Contact Flow answers
  -> Amazon Lex Booking Bot collects booking details
  -> Booking Lambda or FastAIBooking Backend API checks availability
  -> FastAIBooking Backend API creates appointment
  -> Owner dashboard and assigned Staff schedule show the appointment
```

Do not route the current demo through CallRail.

## Human Escalation

If the caller asks for a real person or the AI cannot handle the case:

- AI says: "Please wait while I connect you."
- Amazon Connect transfers the contact to the Operator Queue.
- Operator answers in Amazon Connect CCP/browser softphone.
- Operator uses the FastAIBooking operator dashboard to manage the booking and notes.

## No Operator Available

If queue timeout or no operator availability occurs, fallback options are:

- voicemail
- callback request
- SMS link

These should stay configurable where the product already supports them.

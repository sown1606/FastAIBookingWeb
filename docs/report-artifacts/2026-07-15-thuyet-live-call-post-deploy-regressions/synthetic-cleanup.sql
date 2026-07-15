BEGIN;

CREATE TEMP TABLE _postreg_synthetic_calls AS
SELECT id
FROM "CallSession"
WHERE "providerCallId" LIKE 'codex-20260715-postreg-%';

CREATE TEMP TABLE _postreg_synthetic_customers AS
SELECT id
FROM "Customer"
WHERE "salonId" = '9bd14a12-85ed-418a-af7d-3f5cb329c147'
  AND phone LIKE '+155520672%'
  AND notes LIKE 'Synthetic Lex runtime validation 2026-07-15 post-deploy regressions%';

CREATE TEMP TABLE _postreg_synthetic_appointments AS
SELECT DISTINCT a.id
FROM "Appointment" a
LEFT JOIN "BookingAttempt" ba ON ba."appointmentId" = a.id
LEFT JOIN _postreg_synthetic_calls sc ON sc.id = ba."callSessionId"
WHERE sc.id IS NOT NULL
   OR a."customerId" IN (SELECT id FROM _postreg_synthetic_customers);

SELECT
  (SELECT count(*) FROM _postreg_synthetic_calls) AS call_sessions,
  (SELECT count(*) FROM "AIInteractionLog" WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls)) AS ai_logs,
  (SELECT count(*) FROM "BookingAttempt" WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls)) AS booking_attempts,
  (SELECT count(*) FROM "CallTranscript" WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls)) AS transcripts,
  (SELECT count(*) FROM "CallEscalation" WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls)) AS escalations,
  (SELECT count(*) FROM "CallEvent" WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls)) AS events,
  (SELECT count(*) FROM _postreg_synthetic_appointments) AS appointments,
  (SELECT count(*) FROM _postreg_synthetic_customers) AS customers;

DELETE FROM "AIInteractionLog"
WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls);

DELETE FROM "CallEscalation"
WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls);

DELETE FROM "BookingAttempt"
WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls);

DELETE FROM "CallTranscript"
WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls);

DELETE FROM "CallEvent"
WHERE "callSessionId" IN (SELECT id FROM _postreg_synthetic_calls);

DELETE FROM "CallSession"
WHERE id IN (SELECT id FROM _postreg_synthetic_calls);

DELETE FROM "CustomerFeedback"
WHERE "appointmentId" IN (SELECT id FROM _postreg_synthetic_appointments);

DELETE FROM "StaffReminder"
WHERE "appointmentId" IN (SELECT id FROM _postreg_synthetic_appointments);

DELETE FROM "StaffWorkSession"
WHERE "appointmentId" IN (SELECT id FROM _postreg_synthetic_appointments);

DELETE FROM "AppointmentStatusHistory"
WHERE "appointmentId" IN (SELECT id FROM _postreg_synthetic_appointments);

DELETE FROM "AppointmentService"
WHERE "appointmentId" IN (SELECT id FROM _postreg_synthetic_appointments);

DELETE FROM "Appointment"
WHERE id IN (SELECT id FROM _postreg_synthetic_appointments);

DELETE FROM "Customer"
WHERE id IN (SELECT id FROM _postreg_synthetic_customers);

SELECT
  (SELECT count(*) FROM "CallSession" WHERE "providerCallId" LIKE 'codex-20260715-postreg-%') AS remaining_call_sessions,
  (SELECT count(*) FROM "Customer" WHERE "salonId" = '9bd14a12-85ed-418a-af7d-3f5cb329c147' AND phone LIKE '+155520672%' AND notes LIKE 'Synthetic Lex runtime validation 2026-07-15 post-deploy regressions%') AS remaining_customers;

COMMIT;

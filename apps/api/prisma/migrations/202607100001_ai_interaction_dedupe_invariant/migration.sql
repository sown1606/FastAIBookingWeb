ALTER TABLE "AIInteractionLog" ADD COLUMN "interactionKey" TEXT;
ALTER TABLE "AIInteractionLog" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

UPDATE "AIInteractionLog" log
SET "isSynthetic" = true
FROM "CallSession" call
WHERE log."callSessionId" = call."id"
  AND (
    call."providerCallId" ILIKE 'codex-%'
    OR log."requestPayload"->>'amazonConnectContactId' ILIKE 'codex-%'
    OR log."requestPayload"->>'contactId' ILIKE 'codex-%'
    OR log."requestPayload"->'attributes'->>'AmazonConnectContactId' ILIKE 'codex-%'
    OR log."requestPayload"->'attributes'->>'contactId' ILIKE 'codex-%'
  );

UPDATE "AIInteractionLog" log
SET "isSynthetic" = true
WHERE log."isSynthetic" = false
  AND (
    log."requestPayload"->>'amazonConnectContactId' ILIKE 'codex-%'
    OR log."requestPayload"->>'contactId' ILIKE 'codex-%'
    OR log."requestPayload"->'attributes'->>'AmazonConnectContactId' ILIKE 'codex-%'
    OR log."requestPayload"->'attributes'->>'contactId' ILIKE 'codex-%'
  );

DO $$
DECLARE
  duplicate_groups integer := 0;
  duplicate_rows integer := 0;
BEGIN
  WITH keyed AS (
    SELECT
      log."id",
      'AMAZON_CONNECT:amazon_connect_booking_fulfillment:' ||
        COALESCE(
          NULLIF(call."providerCallId", ''),
          NULLIF(log."callSessionId", ''),
          NULLIF(log."requestPayload"->>'amazonConnectContactId', ''),
          NULLIF(log."requestPayload"->>'contactId', ''),
          NULLIF(log."requestPayload"->'attributes'->>'AmazonConnectContactId', ''),
          NULLIF(log."requestPayload"->'attributes'->>'contactId', '')
        ) AS key
    FROM "AIInteractionLog" log
    LEFT JOIN "CallSession" call ON call."id" = log."callSessionId"
    WHERE log."provider" = 'AMAZON_CONNECT'
      AND log."taskType" = 'amazon_connect_booking_fulfillment'
  ),
  groups AS (
    SELECT key, count(*) AS count
    FROM keyed
    WHERE key IS NOT NULL
    GROUP BY key
    HAVING count(*) > 1
  )
  SELECT count(*), COALESCE(sum(count - 1), 0)
  INTO duplicate_groups, duplicate_rows
  FROM groups;

  RAISE NOTICE 'AIInteractionLog duplicate groups before merge: %, duplicate rows: %',
    duplicate_groups, duplicate_rows;
END $$;

WITH keyed AS (
  SELECT
    log.*,
    'AMAZON_CONNECT:amazon_connect_booking_fulfillment:' ||
      COALESCE(
        NULLIF(call."providerCallId", ''),
        NULLIF(log."callSessionId", ''),
        NULLIF(log."requestPayload"->>'amazonConnectContactId', ''),
        NULLIF(log."requestPayload"->>'contactId', ''),
        NULLIF(log."requestPayload"->'attributes'->>'AmazonConnectContactId', ''),
        NULLIF(log."requestPayload"->'attributes'->>'contactId', '')
      ) AS key
  FROM "AIInteractionLog" log
  LEFT JOIN "CallSession" call ON call."id" = log."callSessionId"
  WHERE log."provider" = 'AMAZON_CONNECT'
    AND log."taskType" = 'amazon_connect_booking_fulfillment'
),
duplicate_keys AS (
  SELECT key
  FROM keyed
  WHERE key IS NOT NULL
  GROUP BY key
  HAVING count(*) > 1
),
canonical AS (
  SELECT DISTINCT ON (key) key, id
  FROM keyed
  WHERE key IN (SELECT key FROM duplicate_keys)
  ORDER BY key, "createdAt" ASC, id ASC
),
latest AS (
  SELECT DISTINCT ON (key)
    key,
    "requestText",
    "requestPayload",
    "responseText",
    "responsePayload",
    "parsedOutput",
    "isValid",
    "validationErrors",
    "confidence",
    "transcriptId",
    "bookingAttemptId",
    "createdByUserId"
  FROM keyed
  WHERE key IN (SELECT key FROM duplicate_keys)
  ORDER BY key, "createdAt" DESC, id DESC
),
expanded_turns AS (
  SELECT
    keyed.key,
    turn.value AS turn,
    COALESCE(
      turn.value->>'idempotencyKey',
      md5(concat_ws('|',
        turn.value->>'currentTurnTranscript',
        turn.value->>'lastAskedSlotBefore',
        turn.value->>'lastAskedSlotAfter',
        turn.value->>'activeDtmfMenuBefore',
        turn.value->>'slotToElicit'
      ))
    ) AS turn_key,
    COALESCE(NULLIF(turn.value->>'createdAt', '')::timestamptz, keyed."createdAt") AS turn_time,
    keyed."createdAt" AS row_time,
    turn.ordinality
  FROM keyed
  JOIN duplicate_keys ON duplicate_keys.key = keyed.key
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(keyed."responsePayload"->'turnHistory') = 'array'
        THEN keyed."responsePayload"->'turnHistory'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS turn(value, ordinality)
),
deduped_turns AS (
  SELECT DISTINCT ON (key, turn_key)
    key,
    turn,
    turn_time,
    row_time,
    ordinality
  FROM expanded_turns
  ORDER BY key, turn_key, turn_time ASC, row_time ASC, ordinality ASC
),
merged_history AS (
  SELECT
    key,
    jsonb_agg(turn ORDER BY turn_time ASC, row_time ASC, ordinality ASC) AS turn_history
  FROM deduped_turns
  GROUP BY key
),
updated_payload AS (
  SELECT
    canonical.id,
    canonical.key,
    latest."requestText",
    latest."requestPayload",
    latest."responseText",
    latest."parsedOutput",
    latest."isValid",
    latest."validationErrors",
    latest."confidence",
    latest."transcriptId",
    latest."bookingAttemptId",
    latest."createdByUserId",
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(latest."responsePayload", '{}'::jsonb),
          '{turnHistory}',
          COALESCE(merged_history.turn_history, '[]'::jsonb),
          true
        ),
        '{turnCount}',
        to_jsonb(jsonb_array_length(COALESCE(merged_history.turn_history, '[]'::jsonb))),
        true
      ),
      '{latestTurn}',
      COALESCE(
        merged_history.turn_history->(jsonb_array_length(merged_history.turn_history) - 1),
        'null'::jsonb
      ),
      true
    ) AS "responsePayload"
  FROM canonical
  JOIN latest ON latest.key = canonical.key
  LEFT JOIN merged_history ON merged_history.key = canonical.key
)
UPDATE "AIInteractionLog" log
SET
  "interactionKey" = updated_payload.key,
  "requestText" = updated_payload."requestText",
  "requestPayload" = updated_payload."requestPayload",
  "responseText" = updated_payload."responseText",
  "responsePayload" = updated_payload."responsePayload",
  "parsedOutput" = updated_payload."parsedOutput",
  "isValid" = updated_payload."isValid",
  "validationErrors" = updated_payload."validationErrors",
  "confidence" = updated_payload."confidence",
  "transcriptId" = updated_payload."transcriptId",
  "bookingAttemptId" = updated_payload."bookingAttemptId",
  "createdByUserId" = updated_payload."createdByUserId"
FROM updated_payload
WHERE log."id" = updated_payload.id;

WITH keyed AS (
  SELECT
    log."id",
    log."createdAt",
    'AMAZON_CONNECT:amazon_connect_booking_fulfillment:' ||
      COALESCE(
        NULLIF(call."providerCallId", ''),
        NULLIF(log."callSessionId", ''),
        NULLIF(log."requestPayload"->>'amazonConnectContactId', ''),
        NULLIF(log."requestPayload"->>'contactId', ''),
        NULLIF(log."requestPayload"->'attributes'->>'AmazonConnectContactId', ''),
        NULLIF(log."requestPayload"->'attributes'->>'contactId', '')
      ) AS key
  FROM "AIInteractionLog" log
  LEFT JOIN "CallSession" call ON call."id" = log."callSessionId"
  WHERE log."provider" = 'AMAZON_CONNECT'
    AND log."taskType" = 'amazon_connect_booking_fulfillment'
),
canonical AS (
  SELECT DISTINCT ON (key) key, id
  FROM keyed
  WHERE key IS NOT NULL
  ORDER BY key, "createdAt" ASC, id ASC
)
DELETE FROM "AIInteractionLog" log
USING keyed, canonical
WHERE log."id" = keyed.id
  AND keyed.key = canonical.key
  AND log."id" <> canonical.id;

UPDATE "AIInteractionLog" log
SET "interactionKey" =
  'AMAZON_CONNECT:amazon_connect_booking_fulfillment:' ||
  COALESCE(
    NULLIF(call."providerCallId", ''),
    NULLIF(log."callSessionId", ''),
    NULLIF(log."requestPayload"->>'amazonConnectContactId', ''),
    NULLIF(log."requestPayload"->>'contactId', ''),
    NULLIF(log."requestPayload"->'attributes'->>'AmazonConnectContactId', ''),
    NULLIF(log."requestPayload"->'attributes'->>'contactId', '')
  )
FROM "CallSession" call
WHERE log."callSessionId" = call."id"
  AND log."provider" = 'AMAZON_CONNECT'
  AND log."taskType" = 'amazon_connect_booking_fulfillment'
  AND log."interactionKey" IS NULL;

UPDATE "AIInteractionLog" log
SET "interactionKey" =
  'AMAZON_CONNECT:amazon_connect_booking_fulfillment:' ||
  COALESCE(
    NULLIF(log."callSessionId", ''),
    NULLIF(log."requestPayload"->>'amazonConnectContactId', ''),
    NULLIF(log."requestPayload"->>'contactId', ''),
    NULLIF(log."requestPayload"->'attributes'->>'AmazonConnectContactId', ''),
    NULLIF(log."requestPayload"->'attributes'->>'contactId', '')
  )
WHERE log."provider" = 'AMAZON_CONNECT'
  AND log."taskType" = 'amazon_connect_booking_fulfillment'
  AND log."interactionKey" IS NULL
  AND COALESCE(
    NULLIF(log."callSessionId", ''),
    NULLIF(log."requestPayload"->>'amazonConnectContactId', ''),
    NULLIF(log."requestPayload"->>'contactId', ''),
    NULLIF(log."requestPayload"->'attributes'->>'AmazonConnectContactId', ''),
    NULLIF(log."requestPayload"->'attributes'->>'contactId', '')
  ) IS NOT NULL;

CREATE UNIQUE INDEX "AIInteractionLog_interactionKey_key" ON "AIInteractionLog"("interactionKey");
CREATE INDEX "AIInteractionLog_isSynthetic_createdAt_idx" ON "AIInteractionLog"("isSynthetic", "createdAt");

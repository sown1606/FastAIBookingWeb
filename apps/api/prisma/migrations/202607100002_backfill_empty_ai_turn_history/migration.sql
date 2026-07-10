UPDATE "AIInteractionLog" log
SET "responsePayload" = jsonb_set(
  jsonb_set(
    jsonb_set(
      COALESCE(log."responsePayload", '{}'::jsonb),
      '{turnHistory}',
      jsonb_build_array(
        jsonb_build_object(
          'index', 1,
          'createdAt', log."createdAt",
          'idempotencyKey', md5(log."id"),
          'currentTurnTranscript', COALESCE(
            log."responsePayload"->>'currentTurnTranscript',
            log."requestPayload"->>'currentTurnTranscript',
            log."requestPayload"->>'text',
            log."requestPayload"->>'transcript',
            log."requestText"
          ),
          'aggregatedBookingTranscript', COALESCE(
            log."responsePayload"->>'aggregatedBookingTranscript',
            log."requestPayload"->>'aggregatedBookingTranscript',
            log."requestPayload"->>'transcript',
            log."requestText"
          ),
          'responseText', log."responseText",
          'intentName', log."requestPayload"->>'intentName',
          'inputMode', log."responsePayload"->'lexTurnDebug'->>'inputMode',
          'lastAskedSlotBefore', COALESCE(
            log."responsePayload"->'lexTurnDebug'->>'lastAskedSlotBefore',
            log."requestPayload"->'attributes'->>'lastAskedSlot'
          ),
          'lastAskedSlotAfter', COALESCE(
            log."responsePayload"->'lexTurnDebug'->>'lastAskedSlotAfter',
            log."responsePayload"->'sessionAttributes'->>'lastAskedSlot'
          ),
          'activeDtmfMenuBefore', COALESCE(
            log."responsePayload"->'lexTurnDebug'->>'activeDtmfMenuBefore',
            log."requestPayload"->'attributes'->>'activeDtmfMenu'
          ),
          'activeDtmfMenuAfter', COALESCE(
            log."responsePayload"->'lexTurnDebug'->>'activeDtmfMenuAfter',
            log."responsePayload"->'sessionAttributes'->>'activeDtmfMenu'
          ),
          'sessionAttributesBefore', COALESCE(
            log."responsePayload"->'lexTurnDebug'->'sessionAttributesBefore',
            log."responsePayload"->'lexTurnDebug'->'attributesBefore',
            log."requestPayload"->'attributes',
            '{}'::jsonb
          ),
          'sessionAttributesAfter', COALESCE(
            log."responsePayload"->'lexTurnDebug'->'sessionAttributesAfter',
            log."responsePayload"->'lexTurnDebug'->'attributesAfter',
            log."responsePayload"->'sessionAttributes',
            '{}'::jsonb
          ),
          'slotToElicit', COALESCE(
            log."responsePayload"->'lexTurnDebug'->>'slotToElicit',
            log."responsePayload"->>'slotToElicit'
          ),
          'transferToQueue', COALESCE(
            log."responsePayload"->'sessionAttributes'->>'transferToQueue',
            log."responsePayload"->>'transferToQueue'
          ),
          'forceHumanEscalation', COALESCE(
            log."responsePayload"->'sessionAttributes'->>'forceHumanEscalation',
            log."responsePayload"->>'forceHumanEscalation'
          )
        )
      ),
      true
    ),
    '{turnCount}',
    '1'::jsonb,
    true
  ),
  '{latestTurn}',
  jsonb_build_object(
    'index', 1,
    'createdAt', log."createdAt",
    'idempotencyKey', md5(log."id"),
    'currentTurnTranscript', COALESCE(
      log."responsePayload"->>'currentTurnTranscript',
      log."requestPayload"->>'currentTurnTranscript',
      log."requestPayload"->>'text',
      log."requestPayload"->>'transcript',
      log."requestText"
    ),
    'responseText', log."responseText"
  ),
  true
)
WHERE log."provider" = 'AMAZON_CONNECT'
  AND log."taskType" = 'amazon_connect_booking_fulfillment'
  AND (
    log."responsePayload"->'turnHistory' IS NULL
    OR jsonb_typeof(log."responsePayload"->'turnHistory') <> 'array'
    OR jsonb_array_length(log."responsePayload"->'turnHistory') = 0
  );

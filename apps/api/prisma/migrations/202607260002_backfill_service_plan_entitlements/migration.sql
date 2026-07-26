-- Preserve explicit legacy service configuration when plan entitlements become
-- enforceable. New self-service subscriptions are always assigned by Stripe.
UPDATE "Subscription" AS subscription
SET
    "planCode" = 'human_reception',
    "basePriceCents" = 49900
FROM "SalonSetting" AS settings
WHERE settings."salonId" = subscription."salonId"
  AND settings."callCenterEnabled" = true
  AND subscription."planCode" NOT IN ('ai_reception', 'human_reception');

UPDATE "Salon" AS salon
SET "planName" = 'human_reception'
FROM "SalonSetting" AS settings
WHERE settings."salonId" = salon."id"
  AND settings."callCenterEnabled" = true
  AND salon."planName" NOT IN ('ai_reception', 'human_reception');

UPDATE "Subscription" AS subscription
SET
    "planCode" = 'ai_reception',
    "basePriceCents" = 8900
FROM "SalonSetting" AS settings
WHERE settings."salonId" = subscription."salonId"
  AND settings."aiReceptionEnabled" = true
  AND settings."callCenterEnabled" = false
  AND subscription."planCode" NOT IN ('ai_reception', 'human_reception');

UPDATE "Salon" AS salon
SET "planName" = 'ai_reception'
FROM "SalonSetting" AS settings
WHERE settings."salonId" = salon."id"
  AND settings."aiReceptionEnabled" = true
  AND settings."callCenterEnabled" = false
  AND salon."planName" NOT IN ('ai_reception', 'human_reception');

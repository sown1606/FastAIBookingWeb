ALTER TABLE "SalonSetting"
ADD COLUMN "callCenterEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "SalonSetting"
SET "callCenterEnabled" = true
WHERE "callCenterRoutingNumber" IS NOT NULL
  AND length(trim("callCenterRoutingNumber")) > 0;

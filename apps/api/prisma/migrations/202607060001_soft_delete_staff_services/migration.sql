ALTER TABLE "Staff" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Service" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Staff_salonId_deletedAt_idx" ON "Staff"("salonId", "deletedAt");
CREATE INDEX "Service_salonId_deletedAt_idx" ON "Service"("salonId", "deletedAt");

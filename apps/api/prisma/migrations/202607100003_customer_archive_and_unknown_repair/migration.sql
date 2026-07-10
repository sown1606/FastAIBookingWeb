ALTER TABLE "Customer" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Customer_salonId_deletedAt_idx" ON "Customer"("salonId", "deletedAt");

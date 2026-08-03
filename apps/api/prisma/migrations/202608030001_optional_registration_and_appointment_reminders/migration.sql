ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT' BEFORE 'TRIAL';

CREATE TYPE "RegistrationLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

ALTER TABLE "SalonSetting"
ADD COLUMN "appointmentReminderMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "ownerUpcomingReminderEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "RegistrationLead" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB_CALLBACK',
    "status" "RegistrationLeadStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegistrationLead_status_createdAt_idx" ON "RegistrationLead"("status", "createdAt");
CREATE INDEX "RegistrationLead_phone_createdAt_idx" ON "RegistrationLead"("phone", "createdAt");
CREATE INDEX "StaffReminder_deliveredAt_reminderType_remindAt_idx" ON "StaffReminder"("deliveredAt", "reminderType", "remindAt");

UPDATE "StaffReminder" AS reminder
SET "remindAt" = appointment."startTime" - INTERVAL '1 hour',
    "message" = 'Your appointment starts in 1 hour.'
FROM "Appointment" AS appointment
WHERE reminder."appointmentId" = appointment."id"
  AND reminder."reminderType" = 'BEFORE_BOOKING'
  AND reminder."deliveredAt" IS NULL;

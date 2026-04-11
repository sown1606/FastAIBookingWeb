ALTER TYPE "Role" ADD VALUE 'CALL_CENTER_AGENT';
ALTER TYPE "AppointmentStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "AppointmentSource" ADD VALUE 'CALL_CENTER';

CREATE TYPE "StaffWorkStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'IN_PROGRESS', 'DONE');

ALTER TABLE "Salon"
ADD COLUMN "originalPhoneNumber" TEXT,
ADD COLUMN "customerIncomingPhoneNumber" TEXT,
ADD COLUMN "notificationPhoneNumber" TEXT;

ALTER TABLE "SalonSetting"
ALTER COLUMN "locale" SET DEFAULT 'vi-VN',
ADD COLUMN "aiForwardingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "aiTransferRingCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "callCenterRoutingNumber" TEXT,
ADD COLUMN "callCenterRoutingNote" TEXT;

UPDATE "SalonSetting"
SET "locale" = 'vi-VN'
WHERE "locale" = 'en-US';

ALTER TABLE "Staff"
ADD COLUMN "currentWorkStatus" "StaffWorkStatus" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN "activeAppointmentId" TEXT;

ALTER TABLE "Appointment"
ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "feedbackToken" TEXT;

UPDATE "Appointment"
SET "durationMinutes" = ROUND(EXTRACT(EPOCH FROM ("endTime" - "startTime")) / 60)::INTEGER
WHERE "durationMinutes" = 0;

CREATE UNIQUE INDEX "Appointment_feedbackToken_key" ON "Appointment"("feedbackToken");

CREATE TABLE "AppointmentService" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentService_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppointmentService" ("id", "salonId", "appointmentId", "serviceId", "durationMinutes", "priceCents")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT || appointment."id"), appointment."salonId", appointment."id", appointment."serviceId", service."durationMinutes", service."priceCents"
FROM "Appointment" appointment
JOIN "Service" service ON service."id" = appointment."serviceId"
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "AppointmentService_appointmentId_serviceId_key" ON "AppointmentService"("appointmentId", "serviceId");
CREATE INDEX "AppointmentService_salonId_appointmentId_idx" ON "AppointmentService"("salonId", "appointmentId");

CREATE TABLE "StaffWorkSession" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "status" "StaffWorkStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedEndAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "extendedMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffWorkSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffWorkSession_salonId_staffId_status_idx" ON "StaffWorkSession"("salonId", "staffId", "status");
CREATE INDEX "StaffWorkSession_appointmentId_startedAt_idx" ON "StaffWorkSession"("appointmentId", "startedAt");

CREATE TABLE "StaffReminder" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffReminder_salonId_staffId_remindAt_idx" ON "StaffReminder"("salonId", "staffId", "remindAt");
CREATE INDEX "StaffReminder_appointmentId_reminderType_idx" ON "StaffReminder"("appointmentId", "reminderType");

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_salonId_staffId_createdAt_idx" ON "ChatMessage"("salonId", "staffId", "createdAt");
CREATE INDEX "ChatMessage_senderUserId_createdAt_idx" ON "ChatMessage"("senderUserId", "createdAt");

CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "notificationPhone" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Alert_salonId_readAt_createdAt_idx" ON "Alert"("salonId", "readAt", "createdAt");
CREATE INDEX "Alert_alertType_createdAt_idx" ON "Alert"("alertType", "createdAt");

CREATE TABLE "CustomerFeedback" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerFeedback_appointmentId_key" ON "CustomerFeedback"("appointmentId");
CREATE INDEX "CustomerFeedback_salonId_rating_createdAt_idx" ON "CustomerFeedback"("salonId", "rating", "createdAt");

CREATE TABLE "CallCenterSalonAssignment" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallCenterSalonAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallCenterSalonAssignment_salonId_agentUserId_key" ON "CallCenterSalonAssignment"("salonId", "agentUserId");
CREATE INDEX "CallCenterSalonAssignment_agentUserId_idx" ON "CallCenterSalonAssignment"("agentUserId");

ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StaffWorkSession" ADD CONSTRAINT "StaffWorkSession_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffWorkSession" ADD CONSTRAINT "StaffWorkSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffWorkSession" ADD CONSTRAINT "StaffWorkSession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffReminder" ADD CONSTRAINT "StaffReminder_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffReminder" ADD CONSTRAINT "StaffReminder_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffReminder" ADD CONSTRAINT "StaffReminder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallCenterSalonAssignment" ADD CONSTRAINT "CallCenterSalonAssignment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallCenterSalonAssignment" ADD CONSTRAINT "CallCenterSalonAssignment_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallCenterSalonAssignment" ADD CONSTRAINT "CallCenterSalonAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ExternalProvider" AS ENUM ('CALLRAIL', 'VERTEX');

-- CreateEnum
CREATE TYPE "CallSessionStatus" AS ENUM ('RECEIVED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'FAILED', 'CANCELED', 'VOICEMAIL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BookingAttemptStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'NEEDS_INPUT', 'NO_AVAILABILITY');

-- CreateTable
CREATE TABLE "CallSession" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "provider" "ExternalProvider" NOT NULL,
    "providerCallId" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "providerCompanyId" TEXT,
    "callerPhone" TEXT,
    "dialedPhone" TEXT,
    "trackingNumber" TEXT,
    "sourceName" TEXT,
    "campaignName" TEXT,
    "status" "CallSessionStatus" NOT NULL DEFAULT 'RECEIVED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "transcriptSummary" TEXT,
    "bookingResult" JSONB,
    "failureReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallEvent" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "callSessionId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "providerEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventTimestamp" TIMESTAMP(3),
    "statusBefore" "CallSessionStatus",
    "statusAfter" "CallSessionStatus",
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processError" TEXT,

    CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallTranscript" (
    "id" TEXT NOT NULL,
    "salonId" TEXT,
    "callSessionId" TEXT NOT NULL,
    "transcriptSource" TEXT NOT NULL DEFAULT 'unknown',
    "transcriptText" TEXT NOT NULL,
    "transcriptSummary" TEXT,
    "speakerMap" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAttempt" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "callSessionId" TEXT,
    "transcriptId" TEXT,
    "appointmentId" TEXT,
    "status" "BookingAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "requestedService" TEXT,
    "requestedStaff" TEXT,
    "requestedDateTimeText" TEXT,
    "normalizedRequest" JSONB,
    "alternativeSlots" JSONB,
    "failureReason" TEXT,
    "rawInput" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInteractionLog" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "model" TEXT,
    "taskType" TEXT NOT NULL,
    "requestText" TEXT,
    "requestPayload" JSONB,
    "responseText" TEXT,
    "responsePayload" JSONB,
    "parsedOutput" JSONB,
    "isValid" BOOLEAN NOT NULL DEFAULT false,
    "validationErrors" JSONB,
    "confidence" DOUBLE PRECISION,
    "callSessionId" TEXT,
    "transcriptId" TEXT,
    "bookingAttemptId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "configKey" TEXT NOT NULL,
    "configValue" TEXT NOT NULL,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallSession_provider_providerCallId_key" ON "CallSession"("provider", "providerCallId");

-- CreateIndex
CREATE INDEX "CallSession_salonId_createdAt_idx" ON "CallSession"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "CallSession_provider_status_idx" ON "CallSession"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CallEvent_provider_providerEventId_key" ON "CallEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CallEvent_callSessionId_payloadHash_key" ON "CallEvent"("callSessionId", "payloadHash");

-- CreateIndex
CREATE INDEX "CallEvent_callSessionId_receivedAt_idx" ON "CallEvent"("callSessionId", "receivedAt");

-- CreateIndex
CREATE INDEX "CallEvent_salonId_receivedAt_idx" ON "CallEvent"("salonId", "receivedAt");

-- CreateIndex
CREATE INDEX "CallTranscript_callSessionId_createdAt_idx" ON "CallTranscript"("callSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CallTranscript_salonId_createdAt_idx" ON "CallTranscript"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingAttempt_salonId_createdAt_idx" ON "BookingAttempt"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingAttempt_callSessionId_createdAt_idx" ON "BookingAttempt"("callSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingAttempt_status_createdAt_idx" ON "BookingAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AIInteractionLog_salonId_createdAt_idx" ON "AIInteractionLog"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "AIInteractionLog_callSessionId_createdAt_idx" ON "AIInteractionLog"("callSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AIInteractionLog_bookingAttemptId_createdAt_idx" ON "AIInteractionLog"("bookingAttemptId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationConfig_provider_configKey_configValue_idx" ON "IntegrationConfig"("provider", "configKey", "configValue");

-- CreateIndex
CREATE INDEX "IntegrationConfig_salonId_provider_isActive_idx" ON "IntegrationConfig"("salonId", "provider", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_provider_salonId_configKey_configValue_key" ON "IntegrationConfig"("provider", "salonId", "configKey", "configValue");

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallEvent" ADD CONSTRAINT "CallEvent_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallEvent" ADD CONSTRAINT "CallEvent_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTranscript" ADD CONSTRAINT "CallTranscript_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTranscript" ADD CONSTRAINT "CallTranscript_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAttempt" ADD CONSTRAINT "BookingAttempt_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAttempt" ADD CONSTRAINT "BookingAttempt_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAttempt" ADD CONSTRAINT "BookingAttempt_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "CallTranscript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAttempt" ADD CONSTRAINT "BookingAttempt_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAttempt" ADD CONSTRAINT "BookingAttempt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteractionLog" ADD CONSTRAINT "AIInteractionLog_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteractionLog" ADD CONSTRAINT "AIInteractionLog_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteractionLog" ADD CONSTRAINT "AIInteractionLog_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "CallTranscript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteractionLog" ADD CONSTRAINT "AIInteractionLog_bookingAttemptId_fkey" FOREIGN KEY ("bookingAttemptId") REFERENCES "BookingAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteractionLog" ADD CONSTRAINT "AIInteractionLog_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConfig" ADD CONSTRAINT "IntegrationConfig_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

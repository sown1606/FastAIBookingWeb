CREATE TYPE "CallRoutingOutcome" AS ENUM (
  'SALON_RING',
  'AI_RECEPTION',
  'CALL_CENTER_ESCALATION',
  'QUEUED',
  'VOICEMAIL',
  'CALLBACK_REQUEST',
  'SMS_FALLBACK'
);

CREATE TYPE "CallEscalationStatus" AS ENUM (
  'PENDING',
  'QUEUED',
  'CONNECTED',
  'VOICEMAIL_LEFT',
  'CALLBACK_REQUESTED',
  'SMS_SENT',
  'CLOSED'
);

CREATE TYPE "CallLogVisibility" AS ENUM (
  'OWNER_ONLY',
  'OWNER_AND_STAFF',
  'OWNER_STAFF_OPERATOR'
);

ALTER TABLE "SalonSetting"
ADD COLUMN "aiReceptionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "voicemailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "callbackRequestEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "smsFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "aiGreetingPrompt" TEXT,
ADD COLUMN "callerLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN "callLogVisibility" "CallLogVisibility" NOT NULL DEFAULT 'OWNER_STAFF_OPERATOR',
ADD COLUMN "notificationRecipients" JSONB;

UPDATE "SalonSetting"
SET "aiReceptionEnabled" = "aiForwardingEnabled";

ALTER TABLE "CallSession"
ADD COLUMN "recordingUrl" TEXT,
ADD COLUMN "aiSummary" JSONB,
ADD COLUMN "routingOutcome" "CallRoutingOutcome",
ADD COLUMN "language" TEXT,
ADD COLUMN "finalResolution" TEXT;

CREATE TABLE "CallEscalation" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "callSessionId" TEXT NOT NULL,
  "status" "CallEscalationStatus" NOT NULL DEFAULT 'PENDING',
  "routingOutcome" "CallRoutingOutcome",
  "escalationReason" TEXT,
  "requestedBy" TEXT,
  "customerPhone" TEXT,
  "queueId" TEXT,
  "queueName" TEXT,
  "amazonConnectContactId" TEXT,
  "assignedAgentUserId" TEXT,
  "messageToCaller" TEXT,
  "callbackPhone" TEXT,
  "smsRecipientPhone" TEXT,
  "voicemailRecordingUrl" TEXT,
  "operatorNotes" TEXT,
  "resolution" TEXT,
  "qaNotes" TEXT,
  "metadata" JSONB,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "queuedAt" TIMESTAMP(3),
  "connectedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallEscalation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CallEscalation"
ADD CONSTRAINT "CallEscalation_salonId_fkey"
FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallEscalation"
ADD CONSTRAINT "CallEscalation_callSessionId_fkey"
FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CallEscalation_callSessionId_key" ON "CallEscalation"("callSessionId");
CREATE INDEX "CallEscalation_salonId_status_requestedAt_idx" ON "CallEscalation"("salonId", "status", "requestedAt");
CREATE INDEX "CallEscalation_routingOutcome_createdAt_idx" ON "CallEscalation"("routingOutcome", "createdAt");
CREATE INDEX "CallSession_routingOutcome_createdAt_idx" ON "CallSession"("routingOutcome", "createdAt");

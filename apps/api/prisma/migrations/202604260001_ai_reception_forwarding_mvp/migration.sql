-- CreateEnum
CREATE TYPE "AiReceptionSetupStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'ACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "AiReceptionForwardingType" AS ENUM ('NO_ANSWER');

-- AlterTable
ALTER TABLE "CallSession"
ADD COLUMN "originalPhoneNumber" TEXT,
ADD COLUMN "direction" TEXT,
ADD COLUMN "answeredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SalonAiReceptionSetup" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL DEFAULT 'CALLRAIL',
    "carrier" TEXT NOT NULL DEFAULT 'tmobile',
    "originalPhoneNumber" TEXT,
    "forwardingPhoneNumber" TEXT NOT NULL,
    "forwardingType" "AiReceptionForwardingType" NOT NULL DEFAULT 'NO_ANSWER',
    "activationCode" TEXT,
    "deactivationCode" TEXT,
    "status" "AiReceptionSetupStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastTestedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonAiReceptionSetup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalonAiReceptionSetup_salonId_key" ON "SalonAiReceptionSetup"("salonId");

-- CreateIndex
CREATE INDEX "SalonAiReceptionSetup_status_updatedAt_idx" ON "SalonAiReceptionSetup"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "SalonAiReceptionSetup"
ADD CONSTRAINT "SalonAiReceptionSetup_salonId_fkey"
FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

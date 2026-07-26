CREATE TYPE "OwnerRegistrationStatus" AS ENUM ('PENDING', 'BILLING_READY', 'COMPLETED', 'FAILED');

CREATE TYPE "PhoneProvisioningStatus" AS ENUM ('PENDING', 'SEARCHING', 'CLAIMING', 'CONFIGURING', 'ACTIVE', 'FAILED');

ALTER TABLE "Subscription"
ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripeSubscriptionId" TEXT,
ADD COLUMN "stripeSetupIntentId" TEXT,
ADD COLUMN "stripePriceId" TEXT,
ADD COLUMN "paymentMethodBrand" TEXT,
ADD COLUMN "paymentMethodLast4" TEXT,
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OwnerRegistrationAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "setupIntentId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" "OwnerRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "lastErrorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerRegistrationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PhoneProvisioning" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL DEFAULT 'AMAZON_CONNECT',
    "status" "PhoneProvisioningStatus" NOT NULL DEFAULT 'PENDING',
    "areaCode" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberId" TEXT,
    "phoneNumberArn" TEXT,
    "contactFlowId" TEXT,
    "claimClientToken" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneProvisioning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE UNIQUE INDEX "Subscription_stripeSetupIntentId_key" ON "Subscription"("stripeSetupIntentId");
CREATE UNIQUE INDEX "OwnerRegistrationAttempt_setupIntentId_key" ON "OwnerRegistrationAttempt"("setupIntentId");
CREATE INDEX "OwnerRegistrationAttempt_email_createdAt_idx" ON "OwnerRegistrationAttempt"("email", "createdAt");
CREATE INDEX "OwnerRegistrationAttempt_status_expiresAt_idx" ON "OwnerRegistrationAttempt"("status", "expiresAt");
CREATE UNIQUE INDEX "PhoneProvisioning_salonId_key" ON "PhoneProvisioning"("salonId");
CREATE UNIQUE INDEX "PhoneProvisioning_phoneNumberId_key" ON "PhoneProvisioning"("phoneNumberId");
CREATE UNIQUE INDEX "PhoneProvisioning_claimClientToken_key" ON "PhoneProvisioning"("claimClientToken");
CREATE INDEX "PhoneProvisioning_status_updatedAt_idx" ON "PhoneProvisioning"("status", "updatedAt");

ALTER TABLE "PhoneProvisioning"
ADD CONSTRAINT "PhoneProvisioning_salonId_fkey"
FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

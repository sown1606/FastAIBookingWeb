-- Add staff role for role-based auth in shared owner/staff app.
ALTER TYPE "Role" ADD VALUE 'STAFF';

-- Link login users to staff records for secure staff-level access filtering.
ALTER TABLE "User"
ADD COLUMN "staffId" TEXT;

ALTER TABLE "User"
ADD CONSTRAINT "User_staffId_key" UNIQUE ("staffId");

ALTER TABLE "User"
ADD CONSTRAINT "User_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "Staff"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "email_verifications" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpCodeHash" TEXT,
ADD COLUMN     "otpExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "password_resets" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpCodeHash" TEXT,
ADD COLUMN     "otpExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" DROP COLUMN "feedbackDismissedAt",
DROP COLUMN "feedbackSubmittedAt",
ADD COLUMN     "onboardingTourPromptedAt" TIMESTAMP(3);

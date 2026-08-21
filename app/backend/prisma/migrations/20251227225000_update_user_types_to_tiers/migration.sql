-- CreateEnum
CREATE TYPE "UserType_new" AS ENUM ('GUEST', 'REGISTERED', 'ARTIST', 'PRO');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "userType" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "userType" TYPE "UserType_new" USING ("userType"::text::"UserType_new");
ALTER TYPE "UserType" RENAME TO "UserType_old";
ALTER TYPE "UserType_new" RENAME TO "UserType";
DROP TYPE "UserType_old";
ALTER TABLE "users" ALTER COLUMN "userType" SET DEFAULT 'GUEST';

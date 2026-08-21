-- DropForeignKey
ALTER TABLE "saved_projects" DROP CONSTRAINT IF EXISTS "saved_projects_bandId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "saved_projects_bandId_idx";

-- AlterTable
ALTER TABLE "saved_projects" DROP COLUMN IF EXISTS "bandId";

-- DropTable
DROP TABLE IF EXISTS "user_settings";

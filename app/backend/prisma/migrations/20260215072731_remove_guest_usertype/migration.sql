/*
  Warnings:

  - The values [GUEST] on the enum `UserType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `projectData` on the `saved_projects` table. All the data in the column will be lost.

*/
-- Update any existing GUEST users to REGISTERED before removing the enum value
UPDATE "users" SET "userType" = 'REGISTERED' WHERE "userType" = 'GUEST';

-- AlterEnum
BEGIN;
CREATE TYPE "UserType_new" AS ENUM ('REGISTERED', 'ARTIST', 'PRO');
ALTER TABLE "public"."users" ALTER COLUMN "userType" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "userType" TYPE "UserType_new" USING ("userType"::text::"UserType_new");
ALTER TYPE "UserType" RENAME TO "UserType_old";
ALTER TYPE "UserType_new" RENAME TO "UserType";
DROP TYPE "public"."UserType_old";
ALTER TABLE "users" ALTER COLUMN "userType" SET DEFAULT 'REGISTERED';
COMMIT;

-- AlterTable (only if column exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'saved_projects' AND column_name = 'projectData') THEN
        ALTER TABLE "saved_projects" DROP COLUMN "projectData";
    END IF;
END $$;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "userType" SET DEFAULT 'REGISTERED';

-- CreateTable (only if not exists)
CREATE TABLE IF NOT EXISTS "_ProjectBands" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProjectBands_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex (only if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = '_ProjectBands_B_index') THEN
        CREATE INDEX "_ProjectBands_B_index" ON "_ProjectBands"("B");
    END IF;
END $$;

-- AddForeignKey (only if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = '_ProjectBands_A_fkey') THEN
        ALTER TABLE "_ProjectBands" ADD CONSTRAINT "_ProjectBands_A_fkey" 
        FOREIGN KEY ("A") REFERENCES "bands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (only if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = '_ProjectBands_B_fkey') THEN
        ALTER TABLE "_ProjectBands" ADD CONSTRAINT "_ProjectBands_B_fkey" 
        FOREIGN KEY ("B") REFERENCES "saved_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

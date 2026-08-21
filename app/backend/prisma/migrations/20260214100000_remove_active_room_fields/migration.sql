-- DropIndex
DROP INDEX IF EXISTS "saved_projects_activeRoomId_idx";

-- AlterTable - Remove transient active room fields (now managed entirely via Redis)
ALTER TABLE "saved_projects" DROP COLUMN IF EXISTS "activeRoomId";
ALTER TABLE "saved_projects" DROP COLUMN IF EXISTS "activeUserCount";

-- AlterTable
ALTER TABLE "saved_projects" ADD COLUMN IF NOT EXISTS "activeRoomId" TEXT;
ALTER TABLE "saved_projects" ADD COLUMN IF NOT EXISTS "activeUserCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "saved_projects_activeRoomId_idx" ON "saved_projects"("activeRoomId");

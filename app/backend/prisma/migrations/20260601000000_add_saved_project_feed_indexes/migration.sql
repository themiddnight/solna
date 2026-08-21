CREATE INDEX IF NOT EXISTS "saved_projects_userId_updatedAt_idx" ON "saved_projects"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "saved_projects_visibility_updatedAt_idx" ON "saved_projects"("visibility", "updatedAt");
CREATE INDEX IF NOT EXISTS "saved_projects_roomType_updatedAt_idx" ON "saved_projects"("roomType", "updatedAt");

-- Add fork project fields
ALTER TABLE "saved_projects" ADD COLUMN IF NOT EXISTS "allowFork" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "saved_projects" ADD COLUMN IF NOT EXISTS "forkedFromId" TEXT;

-- Add self-referential foreign key for forkedFromId
ALTER TABLE "saved_projects" ADD CONSTRAINT "saved_projects_forkedFromId_fkey" 
  FOREIGN KEY ("forkedFromId") REFERENCES "saved_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index on forkedFromId for query performance
CREATE INDEX IF NOT EXISTS "saved_projects_forkedFromId_idx" ON "saved_projects"("forkedFromId");

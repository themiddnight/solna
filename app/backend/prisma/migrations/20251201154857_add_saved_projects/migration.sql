-- CreateTable
CREATE TABLE "saved_projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "projectData" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_projects_userId_idx" ON "saved_projects"("userId");

-- AddForeignKey
ALTER TABLE "saved_projects" ADD CONSTRAINT "saved_projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

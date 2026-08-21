-- =============================================
-- Migration: add_band_collaboration
-- Generated for manual execution
-- =============================================

-- CreateEnum: BandRole
CREATE TYPE "BandRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum: ProjectVisibility
CREATE TYPE "ProjectVisibility" AS ENUM ('PRIVATE', 'BAND', 'PUBLIC');

-- CreateTable: bands
CREATE TABLE "bands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "inviteToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable: band_members
CREATE TABLE "band_members" (
    "id" TEXT NOT NULL,
    "bandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BandRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "band_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable: project_contributors
CREATE TABLE "project_contributors" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastContributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_contributors_pkey" PRIMARY KEY ("id")
);

-- AlterTable: saved_projects - Add new columns
ALTER TABLE "saved_projects" ADD COLUMN "visibility" "ProjectVisibility" NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "saved_projects" ADD COLUMN "bandId" TEXT;

-- CreateIndex: bands
CREATE UNIQUE INDEX "bands_inviteToken_key" ON "bands"("inviteToken");

-- CreateIndex: band_members
CREATE UNIQUE INDEX "band_members_bandId_userId_key" ON "band_members"("bandId", "userId");
CREATE INDEX "band_members_bandId_idx" ON "band_members"("bandId");
CREATE INDEX "band_members_userId_idx" ON "band_members"("userId");

-- CreateIndex: project_contributors
CREATE UNIQUE INDEX "project_contributors_projectId_userId_key" ON "project_contributors"("projectId", "userId");
CREATE INDEX "project_contributors_projectId_idx" ON "project_contributors"("projectId");
CREATE INDEX "project_contributors_userId_idx" ON "project_contributors"("userId");

-- CreateIndex: saved_projects bandId
CREATE INDEX "saved_projects_bandId_idx" ON "saved_projects"("bandId");

-- AddForeignKey: band_members -> bands
ALTER TABLE "band_members" ADD CONSTRAINT "band_members_bandId_fkey" FOREIGN KEY ("bandId") REFERENCES "bands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: band_members -> users
ALTER TABLE "band_members" ADD CONSTRAINT "band_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: project_contributors -> saved_projects
ALTER TABLE "project_contributors" ADD CONSTRAINT "project_contributors_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "saved_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: project_contributors -> users
ALTER TABLE "project_contributors" ADD CONSTRAINT "project_contributors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: saved_projects -> bands
ALTER TABLE "saved_projects" ADD CONSTRAINT "saved_projects_bandId_fkey" FOREIGN KEY ("bandId") REFERENCES "bands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('PERFORM', 'PRODUCE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ROOM_OWNER', 'BAND_MEMBER', 'AUDIENCE');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG_REPORT', 'FEATURE_REQUEST', 'GENERAL_FEEDBACK');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "totalRoomsCreated" INTEGER NOT NULL DEFAULT 0,
    "totalRoomsJoined" INTEGER NOT NULL DEFAULT 0,
    "preferences" JSONB,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "ownerId" UUID,
    "roomType" "RoomType" NOT NULL DEFAULT 'PERFORM',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "settings" JSONB,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomSession" (
    "id" UUID NOT NULL,
    "roomId" UUID,
    "externalRoomId" TEXT NOT NULL,
    "userId" UUID,
    "anonymousId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AUDIENCE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "instrumentUsed" TEXT,
    "wasKicked" BOOLEAN NOT NULL DEFAULT false,
    "usernameSnapshot" TEXT,

    CONSTRAINT "RoomSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "anonymousId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "experienceLevel" "ExperienceLevel" NOT NULL,
    "rating" INTEGER,
    "message" TEXT,
    "usagePurposes" TEXT[],
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" UUID,
    "externalRoomId" TEXT,
    "roleUsed" "UserRole",
    "usernameSnapshot" TEXT,
    "country" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_lastSeen_idx" ON "User"("lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "Room_externalId_key" ON "Room"("externalId");

-- CreateIndex
CREATE INDEX "Room_ownerId_idx" ON "Room"("ownerId");

-- CreateIndex
CREATE INDEX "Room_createdAt_idx" ON "Room"("createdAt");

-- CreateIndex
CREATE INDEX "RoomSession_userId_idx" ON "RoomSession"("userId");

-- CreateIndex
CREATE INDEX "RoomSession_anonymousId_idx" ON "RoomSession"("anonymousId");

-- CreateIndex
CREATE INDEX "RoomSession_roomId_idx" ON "RoomSession"("roomId");

-- CreateIndex
CREATE INDEX "RoomSession_externalRoomId_idx" ON "RoomSession"("externalRoomId");

-- CreateIndex
CREATE INDEX "RoomSession_joinedAt_idx" ON "RoomSession"("joinedAt");

-- CreateIndex
CREATE INDEX "UserFeedback_userId_idx" ON "UserFeedback"("userId");

-- CreateIndex
CREATE INDEX "UserFeedback_anonymousId_idx" ON "UserFeedback"("anonymousId");

-- CreateIndex
CREATE INDEX "UserFeedback_category_idx" ON "UserFeedback"("category");

-- CreateIndex
CREATE INDEX "UserFeedback_submittedAt_idx" ON "UserFeedback"("submittedAt");

-- CreateIndex
CREATE INDEX "UserFeedback_rating_idx" ON "UserFeedback"("rating");

-- AddForeignKey
ALTER TABLE "RoomSession" ADD CONSTRAINT "RoomSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomSession" ADD CONSTRAINT "RoomSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

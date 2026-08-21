/*
  Warnings:

  - You are about to drop the `Room` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RoomSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserFeedback` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "RoomSession" DROP CONSTRAINT "RoomSession_roomId_fkey";

-- DropForeignKey
ALTER TABLE "RoomSession" DROP CONSTRAINT "RoomSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserFeedback" DROP CONSTRAINT "UserFeedback_roomId_fkey";

-- DropForeignKey
ALTER TABLE "UserFeedback" DROP CONSTRAINT "UserFeedback_userId_fkey";

-- AlterTable
ALTER TABLE "user_ai_settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropTable
DROP TABLE "Room";

-- DropTable
DROP TABLE "RoomSession";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "UserFeedback";

-- DropEnum
DROP TYPE "ExperienceLevel";

-- DropEnum
DROP TYPE "FeedbackCategory";

-- DropEnum
DROP TYPE "RoomType";

-- DropEnum
DROP TYPE "UserRole";

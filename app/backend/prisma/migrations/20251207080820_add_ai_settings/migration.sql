-- CreateTable
CREATE TABLE "user_ai_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyHash" TEXT,
    "settings" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_ai_settings_userId_key" ON "user_ai_settings"("userId");

-- AddForeignKey
ALTER TABLE "user_ai_settings"
ADD CONSTRAINT "user_ai_settings_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

import { prisma } from '../../../../config/prisma';
import type { Prisma } from '@prisma/client';

export interface UserAiSettingsData {
  userId: string;
  provider?: string;
  isEnabled?: boolean;
  apiKeyHash?: string | null;
  settings?: Prisma.JsonValue;
}

export interface UserAiSettingsRecord {
  userId: string;
  provider: string;
  enabled: boolean;
  apiKeyHash: string | null;
  settings: Prisma.JsonValue | null;
}

export class UserAiSettingsRepository {
  async findByUserId(userId: string): Promise<UserAiSettingsRecord | null> {
    return prisma.userAiSettings.findUnique({
      where: { userId },
    }) as unknown as Promise<UserAiSettingsRecord | null>;
  }

  async update(userId: string, data: Partial<UserAiSettingsData>): Promise<void> {
    // We use upsert to ensure record exists
    const { isEnabled, ...rest } = data;
    await prisma.userAiSettings.upsert({
      where: { userId },
      update: {
        ...(rest.provider !== undefined && { provider: rest.provider }),
        ...(isEnabled !== undefined && { enabled: isEnabled }),
        ...(rest.apiKeyHash !== undefined && { apiKeyHash: rest.apiKeyHash }),
        ...(rest.settings !== undefined && { settings: rest.settings as Prisma.InputJsonValue }),
      },
      create: {
        userId,
        provider: rest.provider || 'openai',
        enabled: isEnabled ?? false,
        apiKeyHash: rest.apiKeyHash ?? null,
        settings: (rest.settings ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Only updates the API key (encrypted)
   */
  async updateApiKey(userId: string, apiKeyHash: string | null): Promise<void> {
    await this.update(userId, { apiKeyHash });
  }

  /**
   * Updates settings JSON
   */
  async updateSettings(userId: string, settings: Prisma.JsonValue): Promise<void> {
    await this.update(userId, { settings });
  }
}

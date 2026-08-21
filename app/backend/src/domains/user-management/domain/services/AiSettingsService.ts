import type { Prisma } from '@prisma/client';
import { UserAiSettingsRepository } from '../../infrastructure/repositories/UserAiSettingsRepository';
import { encryptionService } from '../../../../shared/infrastructure/security/EncryptionService';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';

export interface AiPublicSettings {
  provider: string;
  enabled: boolean;
  hasApiKey: boolean;
  settings: Record<string, unknown>;
}

export class AiSettingsService {
  private readonly repo: UserAiSettingsRepository;

  constructor() {
    this.repo = new UserAiSettingsRepository();
  }

  /**
   * Get public settings for frontend (excludes sensitive data)
   */
  async getSettings(userId: string): Promise<AiPublicSettings> {
    const settings = await this.repo.findByUserId(userId);
    
    // Default response if no settings yet
    if (settings === null) {
      return {
        provider: 'openai',
        enabled: false,
        hasApiKey: false,
        settings: {},
      };
    }
    
    // Do NOT return apiKeyHash or decrypted key!
    return {
      provider: settings.provider,
      enabled: settings.enabled,
      hasApiKey: settings.apiKeyHash !== null,
      settings: settings.settings !== null ? (settings.settings as Record<string, unknown>) : {},
    };
  }

  /**
   * Update user AI settings
   */
  async updateSettings(userId: string, data: { provider: string; enabled: boolean; apiKey?: string; settings?: Record<string, unknown> }): Promise<AiPublicSettings> {
    // Validation logic
    if (data.enabled === true) {
      // Check if API key exists either in this update or already in DB
      const existing = await this.repo.findByUserId(userId);
      const hasKey = (data.apiKey !== undefined && data.apiKey.length > 0) || 
                     (existing !== null && existing.apiKeyHash !== null);
      
      if (hasKey !== true) {
        throw new Error('API Key is required to enable AI features');
      }
    }

    const updateData: Record<string, unknown> = {
      provider: data.provider,
      isEnabled: data.enabled,
    };

    if (data.settings !== undefined) {
      updateData.settings = data.settings as Prisma.InputJsonValue;
    }

    // Only encrypt and update key if a new one is provided
    // If apiKey is undefined/empty string, we don't change the existing hash
    if (data.apiKey !== undefined && data.apiKey.trim().length > 0) {
      updateData.apiKeyHash = encryptionService.encrypt(data.apiKey.trim());
    }

    await (this.repo.update as (userId: string, data: Record<string, unknown>) => Promise<void>)(userId, updateData);
    
    return this.getSettings(userId);
  }
  
  /**
   * Internal method to get decrypted key for AI calls
   */
  async getDecryptedKey(userId: string): Promise<{ key: string; provider: string; settings: Record<string, unknown> } | null> {
      const settings = await this.repo.findByUserId(userId);
      
      if (settings === null || settings.enabled !== true || settings.apiKeyHash === null) {
        return null;
      }
      
      try {
          const key = encryptionService.decrypt(settings.apiKeyHash);
          return { 
            key, 
            provider: settings.provider,
            settings: settings.settings !== null ? (settings.settings as Record<string, unknown>) : {},
          };
      } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          loggingService.logError(error, { context: 'AiSettingsService.decryptApiKey', userId });
          return null;
      }
  }
}

// Export singleton
export const aiSettingsService = new AiSettingsService();

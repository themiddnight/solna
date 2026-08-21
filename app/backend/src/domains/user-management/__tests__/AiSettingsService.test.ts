import { AiSettingsService } from '../domain/services/AiSettingsService';
import type { UserAiSettingsRepository, UserAiSettingsRecord } from '../infrastructure/repositories/UserAiSettingsRepository';
import { encryptionService } from '../../../shared/infrastructure/security/EncryptionService';
import { loggingService } from '../../../shared/infrastructure/logging/LoggingService';

// Helper type for test-only injection of the private repository field
type ServiceWithRepo = { repo: jest.Mocked<UserAiSettingsRepository> };

jest.mock('../infrastructure/repositories/UserAiSettingsRepository', () => ({
  UserAiSettingsRepository: jest.fn(),
}));

jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logError: jest.fn(),
  },
}));

describe('AiSettingsService', () => {
  let service: AiSettingsService;
  let mockRepo: jest.Mocked<UserAiSettingsRepository>;
  let encryptSpy: jest.SpyInstance;
  let decryptSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRepo = {
      findByUserId: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<UserAiSettingsRepository>;

    // Mock encryption service methods
    encryptSpy = jest.spyOn(encryptionService, 'encrypt').mockImplementation((data) => `encrypted_${data}`);
    decryptSpy = jest.spyOn(encryptionService, 'decrypt').mockImplementation((data) => data.replace('encrypted_', ''));

    service = new AiSettingsService();
    (service as unknown as ServiceWithRepo).repo = mockRepo;
  });

  afterEach(() => {
    encryptSpy.mockRestore();
    decryptSpy.mockRestore();
  });

  describe('getSettings', () => {
    it('should return default settings when user has no settings', async () => {
void mockRepo.findByUserId.mockResolvedValue(null);

      const result = await service.getSettings('user-123');

      expect(result).toEqual({
        provider: 'openai',
        enabled: false,
        hasApiKey: false,
        settings: {},
      });
    });

    it('should return user settings without sensitive data', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'anthropic',
        enabled: true,
        apiKeyHash: 'encrypted_secret_key',
        settings: { model: 'claude-3' },
      } satisfies UserAiSettingsRecord);

      const result = await service.getSettings('user-123');

      expect(result).toEqual({
        provider: 'anthropic',
        enabled: true,
        hasApiKey: true,
        settings: { model: 'claude-3' },
      });
      expect(result).not.toHaveProperty('apiKeyHash');
    });

    it('should handle settings without custom settings object', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: true,
        apiKeyHash: 'encrypted_key',
        settings: null,
      } satisfies UserAiSettingsRecord);

      const result = await service.getSettings('user-123');

      expect(result.settings).toEqual({});
    });
  });

  describe('updateSettings', () => {
    it('should update settings with new API key', async () => {
void mockRepo.findByUserId.mockResolvedValue(null);
void mockRepo.update.mockResolvedValue(undefined);

      await service.updateSettings('user-123', {
        provider: 'openai',
        enabled: true,
        apiKey: 'sk-test-key',
        settings: { model: 'gpt-4' },
      });

      expect(encryptionService.encrypt).toHaveBeenCalledWith('sk-test-key');
      expect(mockRepo.update).toHaveBeenCalledWith('user-123', {
        provider: 'openai',
        isEnabled: true,
        settings: { model: 'gpt-4' },
        apiKeyHash: 'encrypted_sk-test-key',
      });
    });

    it('should throw error when enabling without API key', async () => {
void mockRepo.findByUserId.mockResolvedValue(null);

      await expect(
        service.updateSettings('user-123', {
          provider: 'openai',
          enabled: true,
        })
      ).rejects.toThrow('API Key is required to enable AI features');
    });

    it('should allow enabling with existing API key', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: false,
        apiKeyHash: 'encrypted_existing_key',
        settings: {},
      } satisfies UserAiSettingsRecord);
void mockRepo.update.mockResolvedValue(undefined);

      await service.updateSettings('user-123', {
        provider: 'openai',
        enabled: true,
      });

      expect(mockRepo.update).toHaveBeenCalledWith('user-123', {
        provider: 'openai',
        isEnabled: true,
      });
    });

    it('should not update API key if not provided', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: true,
        apiKeyHash: 'encrypted_existing_key',
        settings: {},
      } satisfies UserAiSettingsRecord);
void mockRepo.update.mockResolvedValue(undefined);

      await service.updateSettings('user-123', {
        provider: 'anthropic',
        enabled: true,
      });

      expect(mockRepo.update).toHaveBeenCalledWith('user-123', {
        provider: 'anthropic',
        isEnabled: true,
      });
      expect(encryptionService.encrypt).not.toHaveBeenCalled();
    });

    it('should trim API key before encrypting', async () => {
void mockRepo.findByUserId.mockResolvedValue(null);
void mockRepo.update.mockResolvedValue(undefined);

      await service.updateSettings('user-123', {
        provider: 'openai',
        enabled: true,
        apiKey: '  sk-test-key  ',
      });

      expect(encryptionService.encrypt).toHaveBeenCalledWith('sk-test-key');
    });

    it('should not update API key for empty string', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: true,
        apiKeyHash: 'encrypted_existing_key',
        settings: {},
      } satisfies UserAiSettingsRecord);
void mockRepo.update.mockResolvedValue(undefined);

      await service.updateSettings('user-123', {
        provider: 'openai',
        enabled: true,
        apiKey: '',
      });

      expect(encryptionService.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('getDecryptedKey', () => {
    it('should return decrypted key for enabled user', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: true,
        apiKeyHash: 'encrypted_secret_key',
        settings: { model: 'gpt-4' },
      } satisfies UserAiSettingsRecord);

      const result = await service.getDecryptedKey('user-123');

      expect(result).toEqual({
        key: 'secret_key',
        provider: 'openai',
        settings: { model: 'gpt-4' },
      });
      expect(encryptionService.decrypt).toHaveBeenCalledWith('encrypted_secret_key');
    });

    it('should return null when user has no settings', async () => {
void mockRepo.findByUserId.mockResolvedValue(null);

      const result = await service.getDecryptedKey('user-123');

      expect(result).toBeNull();
    });

    it('should return null when AI is disabled', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: false,
        apiKeyHash: 'encrypted_key',
        settings: {},
      } satisfies UserAiSettingsRecord);

      const result = await service.getDecryptedKey('user-123');

      expect(result).toBeNull();
    });

    it('should return null when no API key hash', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: true,
        apiKeyHash: null,
        settings: {},
      } satisfies UserAiSettingsRecord);

      const result = await service.getDecryptedKey('user-123');

      expect(result).toBeNull();
    });

    it('should return null on decryption error', async () => {
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: true,
        apiKeyHash: 'corrupted_hash',
        settings: {},
      } satisfies UserAiSettingsRecord);

      (encryptionService.decrypt as jest.Mock).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const result = await service.getDecryptedKey('user-123');

      expect(result).toBeNull();
      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'AiSettingsService.decryptApiKey', userId: 'user-123' })
      );
    });

    it('should handle null settings gracefully', async () => {
      // Reset decrypt mock to default behavior
      (encryptionService.decrypt as jest.Mock).mockImplementation((data: string) => data.replace('encrypted_', ''));
      
      mockRepo.findByUserId.mockResolvedValue({
        userId: 'user-123',
        provider: 'openai',
        enabled: true,
        apiKeyHash: 'encrypted_key',
        settings: null,
      } satisfies UserAiSettingsRecord);

      const result = await service.getDecryptedKey('user-123');

      expect(result).toEqual({
        key: 'key',
        provider: 'openai',
        settings: {},
      });
    });
  });
});

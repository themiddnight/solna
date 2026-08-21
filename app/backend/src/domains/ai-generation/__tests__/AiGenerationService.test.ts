import { AiGenerationService } from '../domain/services/AiGenerationService';
import { aiJobQueue } from '../domain/services/AiJobQueueService';
import { aiProviderFactory } from '../infrastructure/providers/AiProviderFactory';
import { aiSettingsService } from '../../user-management/domain/services/AiSettingsService';
import { systemPressureService } from '../../../shared/infrastructure/resilience/SystemPressureService';
import { loggingService } from '../../../shared/infrastructure/logging/LoggingService';

jest.mock('../domain/services/AiJobQueueService', () => ({
  aiJobQueue: {
    createJob: jest.fn(),
    waitForSlot: jest.fn(),
    startProcessing: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    getQueuePosition: jest.fn(),
  },
}));

jest.mock('../infrastructure/providers/AiProviderFactory', () => ({
  aiProviderFactory: {
    getProvider: jest.fn(),
  },
}));

jest.mock('../../user-management/domain/services/AiSettingsService', () => ({
  aiSettingsService: {
    getDecryptedKey: jest.fn(),
  },
}));

jest.mock('../../../shared/infrastructure/resilience/SystemPressureService', () => ({
  systemPressureService: {
    isFeatureEnabled: jest.fn(),
    getCurrentPressure: jest.fn(),
  },
}));

jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));


describe('AiGenerationService', () => {
  let service: AiGenerationService;
  const mockUserId = 'user-123';
  const mockJobId = 'job-456';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiGenerationService();

    // Default mocks
    (systemPressureService.isFeatureEnabled as jest.Mock).mockReturnValue(true);
    (aiSettingsService.getDecryptedKey as jest.Mock).mockResolvedValue({
      key: 'test-api-key',
      provider: 'openai',
      settings: { model: 'gpt-4' },
    });
    (aiProviderFactory.getProvider as jest.Mock).mockReturnValue({
      generate: jest.fn().mockResolvedValue({
        notes: [
          { pitch: 60, start: 0, duration: 0.5, velocity: 100 },
          { pitch: 64, start: 0.5, duration: 0.5, velocity: 100 },
        ],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }),
    });
    (aiJobQueue.createJob as jest.Mock).mockReturnValue({
      id: mockJobId,
      userId: mockUserId,
      status: 'queued',
      provider: 'openai',
      createdAt: Date.now(),
      priority: 5,
      abortController: new AbortController(),
    });
    (aiJobQueue.waitForSlot as jest.Mock).mockResolvedValue(undefined);
    (aiJobQueue.startProcessing as jest.Mock).mockReturnValue(true);
    (aiJobQueue.getQueuePosition as jest.Mock).mockReturnValue(1);
  });

  describe('generate', () => {
    it('should successfully generate AI content', async () => {
      const request = {
        prompt: 'Generate a melody',
        model: 'gpt-4',
        context: {},
      };

      const result = await service.generate(mockUserId, request);

      expect(result.processedNotes).toHaveLength(2);
      expect(result.processedNotes[0]).toHaveProperty('id');
      expect(aiJobQueue.completeJob).toHaveBeenCalledWith(mockJobId, expect.any(Object));
      expect(loggingService.logUserActivity).toHaveBeenCalledWith(
        'ai_generation_completed',
        mockUserId,
        expect.any(Object)
      );
    });

    it('should throw error when AI generation is disabled due to system pressure', async () => {
      (systemPressureService.isFeatureEnabled as jest.Mock).mockReturnValue(false);
      (systemPressureService.getCurrentPressure as jest.Mock).mockReturnValue({
        cpu: 90,
        memory: 85,
      });

      const request = { prompt: 'Test', model: 'gpt-4', context: {} };

      await expect(service.generate(mockUserId, request)).rejects.toThrow(
        'AI generation is temporarily disabled due to high system load'
      );

      expect(loggingService.logInfo).toHaveBeenCalledWith(
        'AI generation blocked due to system pressure',
        expect.any(Object)
      );
    });

    it('should throw error when API key is missing', async () => {
      (aiSettingsService.getDecryptedKey as jest.Mock).mockResolvedValue(null);

      const request = { prompt: 'Test', model: 'gpt-4', context: {} };

      await expect(service.generate(mockUserId, request)).rejects.toThrow(
        'AI features are disabled or API key is missing'
      );
    });

    it('should inject model from settings if available', async () => {
      const mockProvider = {
        generate: jest.fn().mockResolvedValue({
          notes: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        }),
      };
      (aiProviderFactory.getProvider as jest.Mock).mockReturnValue(mockProvider);

      const request = { prompt: 'Test', context: {} };
      await service.generate(mockUserId, request);

      expect(mockProvider.generate).toHaveBeenCalledWith(
        'test-api-key',
        expect.objectContaining({ model: 'gpt-4' }),
        expect.any(Object)
      );
    });

    it('should handle job cancellation while waiting', async () => {
      (aiJobQueue.waitForSlot as jest.Mock).mockRejectedValue(
        new Error('Job canceled')
      );

      const request = { prompt: 'Test', model: 'gpt-4', context: {} };

      await expect(service.generate(mockUserId, request)).rejects.toThrow('Job canceled');
    });

    it('should handle provider generation failure', async () => {
      const mockError = new Error('Provider API error');
      (aiProviderFactory.getProvider as jest.Mock).mockReturnValue({
        generate: jest.fn().mockRejectedValue(mockError),
      });

      const request = { prompt: 'Test', model: 'gpt-4', context: {} };

      await expect(service.generate(mockUserId, request)).rejects.toThrow('Provider API error');

      expect(aiJobQueue.failJob).toHaveBeenCalledWith(mockJobId, 'Provider API error');
      expect(loggingService.logError).toHaveBeenCalledWith(mockError, expect.any(Object));
    });

    it('should handle aborted job', async () => {
      const abortController = new AbortController();
      abortController.abort();

      (aiJobQueue.createJob as jest.Mock).mockReturnValue({
        id: mockJobId,
        userId: mockUserId,
        status: 'queued',
        provider: 'openai',
        createdAt: Date.now(),
        priority: 5,
        abortController,
      });

      (aiProviderFactory.getProvider as jest.Mock).mockReturnValue({
        generate: jest.fn().mockRejectedValue(new Error('Aborted')),
      });

      const request = { prompt: 'Test', model: 'gpt-4', context: {} };

      await expect(service.generate(mockUserId, request)).rejects.toThrow('Job canceled');

      expect(aiJobQueue.failJob).toHaveBeenCalledWith(mockJobId, 'Job canceled by user');
      expect(loggingService.logUserActivity).toHaveBeenCalledWith(
        'ai_generation_canceled',
        mockUserId,
        expect.any(Object)
      );
    });

    it('should track queue position on job creation', async () => {
      (aiJobQueue.getQueuePosition as jest.Mock).mockReturnValue(3);

      const request = { prompt: 'Test', model: 'gpt-4', context: {} };
      await service.generate(mockUserId, request);

      expect(loggingService.logUserActivity).toHaveBeenCalledWith(
        'ai_generation_started',
        mockUserId,
        expect.objectContaining({
          queuePosition: 3,
        })
      );
    });
  });
});

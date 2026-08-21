import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import type { AuthRequest } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { aiJobQueue } from '../../domains/ai-generation/domain/services/AiJobQueueService';
import { aiProviderFactory } from '../../domains/ai-generation/infrastructure/providers/AiProviderFactory';
import { aiSettingsService } from '../../domains/user-management/domain/services/AiSettingsService';
import { systemPressureService } from '../../shared/infrastructure/resilience/SystemPressureService';

// Separate file (not another `it` in aiGeneration.validation.test.ts) because
// aiGenerationRateLimiter allows only 1 request per 5s per IP and is a
// module-level singleton shared by every request within a test file instance.
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn(),
  optionalAuthAllowGuest: jest.fn(),
}));

jest.mock('../../domains/ai-generation/domain/services/AiJobQueueService', () => ({
  aiJobQueue: {
    createJob: jest.fn(),
    waitForSlot: jest.fn(),
    startProcessing: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    getQueuePosition: jest.fn(),
  },
}));

jest.mock('../../domains/ai-generation/infrastructure/providers/AiProviderFactory', () => ({
  aiProviderFactory: {
    getProvider: jest.fn(),
  },
}));

jest.mock('../../domains/user-management/domain/services/AiSettingsService', () => ({
  aiSettingsService: {
    getDecryptedKey: jest.fn(),
  },
}));

jest.mock('../../shared/infrastructure/resilience/SystemPressureService', () => ({
  systemPressureService: {
    isFeatureEnabled: jest.fn(),
    getCurrentPressure: jest.fn(),
  },
}));

// Import router AFTER mocking its transitive dependencies
import aiGenerationRouter from '../aiGeneration';

describe('POST /ai/generate — generation range validation (DEV-46)', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/ai', aiGenerationRouter);
  });

  beforeEach(() => {
    (authenticateToken as jest.Mock).mockImplementation(
      (req: AuthRequest, _res: unknown, next: () => void) => {
        req.user = {
          id: 'user-range',
          email: 'range@example.com',
          username: 'range-user',
          userType: 'REGISTERED',
          emailVerified: true,
        } as AuthRequest['user'];
        next();
      }
    );
    (systemPressureService.isFeatureEnabled as jest.Mock).mockReturnValue(true);
    (aiSettingsService.getDecryptedKey as jest.Mock).mockResolvedValue({
      key: 'test-api-key',
      provider: 'openai',
      settings: { model: 'gpt-4' },
    });
    (aiProviderFactory.getProvider as jest.Mock).mockReturnValue({
      generate: jest.fn().mockResolvedValue({ notes: [], ops: [] }),
    });
  });

  it('rejects a range longer than 16 bars with a clear 400 error', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send({
        prompt: 'A long epic melody',
        rangeBars: 17,
      });

    const body = res.body as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('Generation range too long. Maximum is 16 bars.');
    expect(aiJobQueue.createJob).not.toHaveBeenCalled();
  });
});

import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import type { AuthRequest } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { aiJobQueue } from '../../domains/ai-generation/domain/services/AiJobQueueService';
import { aiProviderFactory } from '../../domains/ai-generation/infrastructure/providers/AiProviderFactory';
import { aiSettingsService } from '../../domains/user-management/domain/services/AiSettingsService';
import { systemPressureService } from '../../shared/infrastructure/resilience/SystemPressureService';

// Same mocking pattern as aiGeneration.editmode.test.ts — kept in a separate
// file (rather than added as another `it` there) because aiGenerationRateLimiter
// allows only 1 request per 5s per IP and is a module-level singleton shared
// by every request within a test file's module instance.
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

describe('POST /ai/generate — request body validation', () => {
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
          id: 'user-validation',
          email: 'validation@example.com',
          username: 'validation-user',
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

  // Regression: indexedNotes had no upper bound (unlike history's .max(20)),
  // so a malformed/huge client payload could balloon the prompt sent to the
  // provider. It must be rejected at the Zod boundary before it ever reaches
  // the job queue / provider.
  it('rejects an indexedNotes array over the 512-note cap with 400', async () => {
    const oversizedNotes = Array.from({ length: 513 }, (_, index) => ({
      index,
      pitch: 60,
      start: 0,
      duration: 0.5,
      velocity: 100,
    }));

    const res = await request(app)
      .post('/api/ai/generate')
      .send({
        prompt: 'Remove the first note',
        mode: 'edit',
        indexedNotes: oversizedNotes,
      });

    expect(res.status).toBe(400);
    expect(aiJobQueue.createJob).not.toHaveBeenCalled();
  });
});

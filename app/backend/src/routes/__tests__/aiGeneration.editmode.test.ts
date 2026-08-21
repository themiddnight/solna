import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import type { AuthRequest } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { aiJobQueue } from '../../domains/ai-generation/domain/services/AiJobQueueService';
import { aiProviderFactory } from '../../domains/ai-generation/infrastructure/providers/AiProviderFactory';
import { aiSettingsService } from '../../domains/user-management/domain/services/AiSettingsService';
import { systemPressureService } from '../../shared/infrastructure/resilience/SystemPressureService';

// Mock authentication middleware - the implementation is (re)established in beforeEach,
// not baked into this factory, because jest.config has resetMocks:true + tests/setup.ts
// clears all mocks before every test (a factory-only implementation would be wiped,
// turning this into a no-op middleware that never calls next() and hangs the request).
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn(),
  optionalAuthAllowGuest: jest.fn(),
}));

// Mock the service's dependencies (same pattern as AiGenerationService.test.ts) —
// values are re-established in beforeEach because jest.config has resetMocks: true.
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

describe('POST /ai/generate — edit mode pass-through', () => {
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
          id: 'user-edit-mode',
          email: 'edit-mode@example.com',
          username: 'edit-mode-user',
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
      generate: jest.fn().mockResolvedValue({
        notes: [],
        ops: [{ op: 'remove', target: 0 }],
      }),
    });
    (aiJobQueue.createJob as jest.Mock).mockReturnValue({
      id: 'job-edit-mode',
      userId: 'user-edit-mode',
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

  it('forwards mode/history/indexedNotes and returns ops without processedNotes', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send({
        prompt: 'Remove the first note',
        mode: 'edit',
        history: [{ role: 'user', content: 'make it groovier' }],
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 0.5, velocity: 100 }],
      });

    expect(res.status).toBe(200);
    const body = res.body as { ops?: unknown; processedNotes?: unknown[] };
    expect(body.ops).toEqual([{ op: 'remove', target: 0 }]);
    expect(body.processedNotes ?? []).toHaveLength(0);

    // The provider must have received the edit-mode fields forwarded from the route.
    const providerMock = (aiProviderFactory.getProvider as jest.Mock).mock.results[0]?.value as {
      generate: jest.Mock;
    };
    expect(providerMock.generate).toHaveBeenCalledWith(
      'test-api-key',
      expect.objectContaining({
        mode: 'edit',
        history: [{ role: 'user', content: 'make it groovier' }],
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 0.5, velocity: 100 }],
      }),
      expect.anything()
    );
  });
});

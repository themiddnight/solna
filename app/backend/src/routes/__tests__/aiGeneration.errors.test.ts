import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { AI_GENERATION_CONSTANTS } from '@jam-band/shared';
import type { AuthRequest } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../../domains/auth/infrastructure/middleware/authMiddleware';

/**
 * Error-mapping + boundary tests for routes/aiGeneration.ts's catch paths
 * (TR-31). Unlike the sibling aiGeneration.* files (which run the REAL
 * AiGenerationService with mocked deps), this file mocks the service layer
 * directly so every error branch the route maps is reachable:
 *   409 "already have a generation" / 400 "Job canceled" / 500 fallback,
 *   the 401 no-user guard, and the remaining zod boundary branches.
 * The rate limiter is mocked (same licence as aiGeneration.rangeForwarding).
 */

const mockGenerate = jest.fn() as jest.Mock<Promise<unknown>>;

jest.mock('../../domains/ai-generation/domain/services/AiGenerationService', () => ({
  aiGenerationService: {
    generate: (...a: unknown[]) => mockGenerate(...a),
  },
}));

jest.mock('../../domains/ai-generation/infrastructure/middleware/rateLimit', () => ({
  aiGenerationRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn(),
  optionalAuthAllowGuest: jest.fn(),
}));

jest.mock('../../domains/auth/infrastructure/middleware/guestLimitations', () => ({
  requireRegistered: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import router AFTER mocking its dependencies
import aiGenerationRouter from '../aiGeneration';

const app: Express = express();
app.use(express.json());
app.use('/api/ai', aiGenerationRouter);

function injectUser(): void {
  (authenticateToken as jest.Mock).mockImplementation(
    (req: AuthRequest, _res: unknown, next: () => void) => {
      req.user = {
        id: 'user-errors',
        email: 'errors@example.com',
        username: 'errors-user',
        userType: 'REGISTERED',
        emailVerified: true,
      } as AuthRequest['user'];
      next();
    }
  );
}

function noUser(): void {
  (authenticateToken as jest.Mock).mockImplementation(
    (_req: AuthRequest, _res: unknown, next: () => void) => {
      next();
    }
  );
}

describe('POST /api/ai/generate — authenticated-user guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    noUser();
  });

  it('returns 401 without an authenticated user and never calls the service', async () => {
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/generate — zod boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser();
    mockGenerate.mockResolvedValue({ notes: [], ops: [], processedNotes: [] });
  });

  it('rejects a missing prompt with 400 and the zod message', async () => {
    const res = await request(app).post('/api/ai/generate').send({});
    expect(res.status).toBe(400);
    // zod's message for a missing required string (the route surfaces issues[0].message verbatim).
    expect(res.body).toEqual({ error: 'Invalid input: expected string, received undefined' });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rejects an empty-string prompt with 400', async () => {
    const res = await request(app).post('/api/ai/generate').send({ prompt: '' });
    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rejects a history longer than 20 turns with 400', async () => {
    const history = Array.from({ length: 21 }, () => ({ role: 'user' as const, content: 'x' }));
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline', history });
    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode with 400', async () => {
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline', mode: 'jam' });
    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rejects a non-positive maxTokens with 400', async () => {
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline', maxTokens: 0 });
    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  // Boundary guard (DEV-46): an over-long range is rejected up front with the
  // clear message instead of a silent provider timeout.
  it('rejects rangeBars above MAX_RANGE_BARS with 400 and the cap message', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send({ prompt: 'A bassline', rangeBars: AI_GENERATION_CONSTANTS.MAX_RANGE_BARS + 1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: `Generation range too long. Maximum is ${AI_GENERATION_CONSTANTS.MAX_RANGE_BARS} bars.`,
    });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/generate — success passthrough', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser();
    mockGenerate.mockResolvedValue({ notes: [], ops: [], processedNotes: [] });
  });

  it('forwards the prompt and defaults context to {}', async () => {
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notes: [], ops: [], processedNotes: [] });
    expect(mockGenerate).toHaveBeenCalledWith('user-errors', { prompt: 'A bassline', context: {} });
  });

  it('forwards every optional field when present', async () => {
    const res = await request(app).post('/api/ai/generate').send({
      prompt: 'Remove the first note',
      context: { key: 'Cmaj' },
      maxTokens: 256,
      mode: 'edit',
      history: [{ role: 'user', content: 'hi' }],
      indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 0.5, velocity: 100 }],
      rangeBars: 4,
    });
    expect(res.status).toBe(200);
    expect(mockGenerate).toHaveBeenCalledWith(
      'user-errors',
      expect.objectContaining({
        prompt: 'Remove the first note',
        context: { key: 'Cmaj' },
        maxTokens: 256,
        mode: 'edit',
        history: [{ role: 'user', content: 'hi' }],
        indexedNotes: [{ index: 0, pitch: 60, start: 0, duration: 0.5, velocity: 100 }],
        rangeBars: 4,
      }),
    );
  });
});

describe('POST /api/ai/generate — catch-branch error mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser();
  });

  // The real service surfaces the queue's active-job error ("You already have a
  // generation in progress. Please wait or cancel it.") — the route maps any
  // message containing "already have a generation" to 409.
  it('maps an active-generation error to 409 with the service message', async () => {
    mockGenerate.mockRejectedValue(new Error('You already have a generation in progress. Please wait or cancel it.'));
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'You already have a generation in progress. Please wait or cancel it.' });
  });

  it('maps a canceled job to 400', async () => {
    mockGenerate.mockRejectedValue(new Error('Job canceled'));
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Job canceled' });
  });

  it('maps an unexpected Error to 500 with its message', async () => {
    mockGenerate.mockRejectedValue(new Error('provider exploded'));
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'provider exploded' });
  });

  it('maps a non-Error rejection to 500 with its stringified value', async () => {
    mockGenerate.mockRejectedValue('plain string failure');
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'plain string failure' });
  });

  it('falls back to the generic message when the error message is empty', async () => {
    mockGenerate.mockRejectedValue(new Error(''));
    const res = await request(app).post('/api/ai/generate').send({ prompt: 'A bassline' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to generate content' });
  });
});

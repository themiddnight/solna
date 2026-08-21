import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import type { AuthRequest } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../../domains/auth/infrastructure/middleware/authMiddleware';

/**
 * Full route suite for routes/aiQueue.ts (cancel / status / stats REST surface
 * over the AI job queue). Harness: REAL router + supertest + mocked infra
 * boundary (aiJobQueue singleton + auth middleware).
 */

const mockCancelJob = jest.fn() as jest.Mock<boolean>;
const mockGetJob = jest.fn() as jest.Mock<unknown>;
const mockGetQueuePosition = jest.fn() as jest.Mock<number>;
const mockGetStats = jest.fn() as jest.Mock<unknown>;

jest.mock('../../domains/ai-generation/domain/services/AiJobQueueService', () => ({
  aiJobQueue: {
    cancelJob: (...a: unknown[]) => mockCancelJob(...a),
    getJob: (...a: unknown[]) => mockGetJob(...a),
    getQueuePosition: (...a: unknown[]) => mockGetQueuePosition(...a),
    getStats: (...a: unknown[]) => mockGetStats(...a),
  },
}));

// authenticateToken: jest.fn() whose implementation is (re)established in
// beforeEach — the 401 suite re-implements it without setting req.user.
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn(),
  optionalAuthAllowGuest: jest.fn(),
}));

jest.mock('../../domains/auth/infrastructure/middleware/guestLimitations', () => ({
  requireRegistered: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import router AFTER mocking
import aiQueueRouter from '../aiQueue';

const app: Express = express();
app.use(express.json());
app.use('/api/ai-queue', aiQueueRouter);

function injectUser(): void {
  (authenticateToken as jest.Mock).mockImplementation(
    (req: AuthRequest, _res: unknown, next: () => void) => {
      req.user = {
        id: 'u1',
        email: 'queue@example.com',
        username: 'queue-user',
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

describe('POST /api/ai-queue/cancel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser();
    mockCancelJob.mockReturnValue(true);
  });

  it('cancels the caller job (200) and scopes the cancel to the verified user id', async () => {
    const res = await request(app).post('/api/ai-queue/cancel');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Job canceled successfully' });
    expect(mockCancelJob).toHaveBeenCalledWith('u1');
  });

  it('returns 404 when there is no active job to cancel', async () => {
    mockCancelJob.mockReturnValue(false);
    const res = await request(app).post('/api/ai-queue/cancel');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No active job found to cancel' });
  });

  it('returns 401 without an authenticated user and never touches the queue', async () => {
    noUser();
    const res = await request(app).post('/api/ai-queue/cancel');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(mockCancelJob).not.toHaveBeenCalled();
  });
});

describe('GET /api/ai-queue/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser();
    mockGetQueuePosition.mockReturnValue(2);
  });

  it('returns the active job with its queue position', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', status: 'processing', provider: 'openai', createdAt: 123, priority: 1 });
    const res = await request(app).get('/api/ai-queue/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'processing',
      provider: 'openai',
      createdAt: 123,
      queuePosition: 2,
    });
    expect(mockGetJob).toHaveBeenCalledWith('u1');
    expect(mockGetQueuePosition).toHaveBeenCalledWith('j1');
  });

  it('returns { status: idle } when no job exists for the user', async () => {
    mockGetJob.mockReturnValue(undefined);
    const res = await request(app).get('/api/ai-queue/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'idle' });
    expect(mockGetQueuePosition).not.toHaveBeenCalled();
  });

  it('returns 401 without an authenticated user', async () => {
    noUser();
    const res = await request(app).get('/api/ai-queue/status');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(mockGetJob).not.toHaveBeenCalled();
  });
});

describe('GET /api/ai-queue/stats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectUser();
    mockGetStats.mockReturnValue({
      totalJobs: 3,
      processingJobs: 1,
      queuedJobs: 2,
      maxConcurrent: 5,
      avgWaitTime: 100,
      avgProcessingTime: 500,
    });
  });

  it('returns the queue statistics', async () => {
    const res = await request(app).get('/api/ai-queue/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalJobs: 3,
      processingJobs: 1,
      queuedJobs: 2,
      maxConcurrent: 5,
      avgWaitTime: 100,
      avgProcessingTime: 500,
    });
  });

  it('returns 401 without an authenticated user', async () => {
    noUser();
    const res = await request(app).get('/api/ai-queue/stats');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(mockGetStats).not.toHaveBeenCalled();
  });
});

import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

/**
 * TR-33 — `POST /rooms/:roomId/audio/regions` auth gate, exercised through the REAL auth
 * middleware chain (`authenticateTokenAllowGuest`) as registered by `createRoutes`. Before this
 * fix the route had no auth middleware and trusted a multipart `userId` field for membership
 * checks; this pins that:
 *  - an unauthenticated request is rejected (401) before the controller is ever reached;
 *  - a guest token is admitted (guests are legitimate members of public Arrange rooms) and the
 *    controller sees the verified token identity on `req.user`, never a client-supplied field.
 * Only the token verifier is mocked; sub-routers and unrelated services are stubbed so importing
 * the route factory stays side-effect free.
 */
const mockVerifyToken = jest.fn();
jest.mock('../../domains/auth/domain/services/TokenService', () => ({
  tokenService: { verifyToken: (token: string): unknown => mockVerifyToken(token) },
}));

const mockFindById = jest.fn() as jest.Mock<Promise<unknown>>;
jest.mock('../../domains/auth/infrastructure/repositories/UserRepository', () => ({
  UserRepository: class {
    findById(id: string): Promise<unknown> {
      return mockFindById(id);
    }
  },
}));

// Sub-routers mounted by createRoutes — replaced with passthrough middleware so their module
// graphs (controllers, prisma, B2, ...) never load in this tier.
const esModuleFlag = '__esModule';
const mockPassthroughRouter = { [esModuleFlag]: true, default: (_req: Request, _res: Response, next: NextFunction): void => next() };
jest.mock('../auth', () => mockPassthroughRouter);
jest.mock('../userPresets', () => mockPassthroughRouter);
jest.mock('../projects', () => mockPassthroughRouter);
jest.mock('../bands', () => mockPassthroughRouter);
jest.mock('../aiQueue', () => mockPassthroughRouter);
jest.mock('../aiGeneration', () => mockPassthroughRouter);
jest.mock('../bugReport', () => mockPassthroughRouter);

jest.mock('../../domains/perform-room/infrastructure/services/HLSBroadcastService', () => ({
  hlsBroadcastService: {},
}));

jest.mock('../../middleware/rateLimit', () => ({
  hlsLimiter: (_req: Request, _res: Response, next: NextFunction): void => next(),
  inviteCodeLimiter: (_req: Request, _res: Response, next: NextFunction): void => next(),
}));

jest.mock('../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logWarning: jest.fn(),
    logSecurityEvent: jest.fn(),
  },
}));

import { createRoutes } from '../index';
import type { RoomController } from '../../domains/room-management/infrastructure/controllers/RoomController';
import type { RoomLifecycleHandler } from '../../domains/room-management/infrastructure/handlers/RoomLifecycleHandler';
import type { AudioRegionController } from '../../domains/arrange-room/infrastructure/controllers/AudioRegionController';
import type { ProjectController } from '../../domains/arrange-room/infrastructure/controllers/ProjectController';

const mockUploadRegionAudio = jest.fn() as jest.Mock<void, [Request, Response]>;

const app = express();
app.use(express.json());
app.use(
  '/api',
  createRoutes(
    {} as unknown as RoomController,
    {} as unknown as RoomLifecycleHandler,
    {
      uploadRegionAudio: (req: Request, res: Response) => mockUploadRegionAudio(req, res),
    } as unknown as AudioRegionController,
    {} as unknown as ProjectController
  )
);

const GUEST_PAYLOAD = { userId: 'guest:abc', email: null, username: 'Guest_abc', userType: 'GUEST', type: 'guest' };

describe('POST /api/rooms/:roomId/audio/regions — TR-33 auth gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadRegionAudio.mockImplementation((_req: Request, res: Response) => {
      res.status(201).json({ success: true });
    });
  });

  it('rejects an unauthenticated upload (401) without reaching the controller', async () => {
    const res = await request(app)
      .post('/api/rooms/room-1/audio/regions')
      .field('userId', 'someone-elses-id')
      .attach('audio', Buffer.from('fake-audio'), { filename: 'clip.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(401);
    expect(mockUploadRegionAudio).not.toHaveBeenCalled();
  });

  it('admits a guest token and exposes the token identity as req.user', async () => {
    mockVerifyToken.mockReturnValue(GUEST_PAYLOAD);

    const res = await request(app)
      .post('/api/rooms/room-1/audio/regions')
      .set('Authorization', 'Bearer guest-token')
      .attach('audio', Buffer.from('fake-audio'), { filename: 'clip.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(201);
    const req = mockUploadRegionAudio.mock.calls[0]?.[0] as Request;
    expect(req.user?.id).toBe('guest:abc');
  });
});

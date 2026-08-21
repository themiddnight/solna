import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

/**
 * BR-20 — `POST /rooms/:roomId/projects/load` open gate, exercised through the REAL auth
 * middleware chain (`authenticateToken`) as registered by `createRoutes`. This pins the security
 * core of the share-link amendment:
 *  - guest tokens are rejected (401) — the route swapped `authenticateTokenAllowGuest` →
 *    `authenticateToken`, and a `guest:*` id has no DB row;
 *  - unverified registered users are rejected (401) — the OTP hard gate rejects them inside
 *    `authenticateToken` itself, before the controller;
 *  - verified registered users pass the gate and reach the controller.
 * Only the token verifier and user lookup are mocked; sub-routers and unrelated services are
 * stubbed so importing the route factory stays side-effect free.
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

const mockLoadProjectFromStorage = jest.fn() as jest.Mock<void, [Request, Response]>;

const app = express();
app.use(express.json());
app.use(
  '/api',
  createRoutes(
    {} as unknown as RoomController,
    {} as unknown as RoomLifecycleHandler,
    {} as unknown as AudioRegionController,
    {
      loadProjectFromStorage: (req: Request, res: Response) => mockLoadProjectFromStorage(req, res),
    } as unknown as ProjectController
  )
);

const GUEST_PAYLOAD = { userId: 'guest:abc', email: null, username: 'Guest_abc', userType: 'GUEST', type: 'guest' };
const REGISTERED_PAYLOAD = { userId: 'u1', email: 'u1@example.com', userType: 'REGISTERED' };

const makeUserRow = (emailVerified: boolean) => ({
  id: 'u1',
  email: 'u1@example.com',
  username: 'tester',
  userType: 'REGISTERED',
  emailVerified,
});

describe('POST /api/rooms/:roomId/projects/load — BR-20 open gate (real auth middleware)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadProjectFromStorage.mockImplementation((_req: Request, res: Response) => {
      res.status(200).json({ success: true });
    });
  });

  it('rejects a request with no token (401)', async () => {
    const res = await request(app).post('/api/rooms/room-1/projects/load').send({ projectId: 'p1' });
    expect(res.status).toBe(401);
    expect(mockLoadProjectFromStorage).not.toHaveBeenCalled();
  });

  it('rejects a guest token with 401 (strict authenticateToken — guest ids have no DB row)', async () => {
    mockVerifyToken.mockReturnValue(GUEST_PAYLOAD);
    mockFindById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/rooms/room-1/projects/load')
      .set('Authorization', 'Bearer guest-token')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'User not found' });
    expect(mockFindById).toHaveBeenCalledWith('guest:abc');
    expect(mockLoadProjectFromStorage).not.toHaveBeenCalled();
  });

  it('rejects an unverified registered user with 401 (the OTP hard gate blocks them at authentication)', async () => {
    mockVerifyToken.mockReturnValue(REGISTERED_PAYLOAD);
    mockFindById.mockResolvedValue(makeUserRow(false));

    const res = await request(app)
      .post('/api/rooms/room-1/projects/load')
      .set('Authorization', 'Bearer unverified-token')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(401);
    expect(mockLoadProjectFromStorage).not.toHaveBeenCalled();
  });

  it('lets a verified registered user through to the controller', async () => {
    mockVerifyToken.mockReturnValue(REGISTERED_PAYLOAD);
    mockFindById.mockResolvedValue(makeUserRow(true));

    const res = await request(app)
      .post('/api/rooms/room-1/projects/load')
      .set('Authorization', 'Bearer verified-token')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockLoadProjectFromStorage).toHaveBeenCalledTimes(1);
  });
});

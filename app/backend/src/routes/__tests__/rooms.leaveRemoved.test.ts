import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

/**
 * TR-33 — `POST /rooms/:roomId/leave` was an unauthenticated remote-eviction primitive: no auth
 * middleware, acting user taken from `req.body.userId`. Owner decision 2026-08-11: delete rather
 * than harden — leaving a room is a live-session (socket) operation that needs a socket handle to
 * clean up voice state, which HTTP structurally cannot provide. This test pins the route's removal
 * so it can never come back unnoticed. Sub-routers and unrelated services are stubbed so importing
 * the route factory stays side-effect free (harness copied from rooms.projectLoad.openGate.test.ts).
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

const app = express();
app.use(express.json());
app.use(
  '/api',
  createRoutes(
    {} as unknown as RoomController,
    {} as unknown as RoomLifecycleHandler,
    {} as unknown as AudioRegionController,
    {} as unknown as ProjectController
  )
);

describe('POST /api/rooms/:roomId/leave — removed (DEV: unauthenticated eviction primitive)', () => {
  it('returns 404 because the route no longer exists', async () => {
    const res = await request(app)
      .post('/api/rooms/room-1/leave')
      .send({ userId: 'victim' });

    expect(res.status).toBe(404);
  });
});

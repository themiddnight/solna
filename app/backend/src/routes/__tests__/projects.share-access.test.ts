import express from 'express';
import request from 'supertest';

const mockResolve = jest.fn() as jest.Mock<Promise<unknown>>;
jest.mock('../../domains/arrange-room/application/ProjectApplicationService', () => ({
  projectApplicationService: { resolveShareAccess: (...a: unknown[]): Promise<unknown> => mockResolve(...a) },
  // schemas imported by the router must still exist as objects
  updateVisibilityCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  updateSettingsCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  saveFromRoomCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  remixProjectCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  saveFromRoomUpdateCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
}));

// optionalAuthAllowGuest: inject actor via a header the mock reads, default anonymous
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthAllowGuest: (req: { headers: Record<string, string>; user?: unknown }, _res: unknown, next: () => void) => {
    const actor = req.headers['x-test-actor'];
    if (actor === 'registered') req.user = { id: 'u1', userType: 'REGISTERED', emailVerified: true };
    else if (actor === 'unverified') req.user = { id: 'u2', userType: 'REGISTERED', emailVerified: false };
    else if (actor === 'guest') req.user = { id: 'g1', userType: 'GUEST', emailVerified: false };
    next();
  },
}));

import projectRouter from '../projects';

const app = express();
app.use(express.json());
app.use('/api/projects', projectRouter);

describe('GET /api/projects/:id/share-access', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes an anonymous actor to the service', async () => {
    mockResolve.mockResolvedValue({ decision: 'auth_required' });
    const res = await request(app).get('/api/projects/p1/share-access');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ decision: 'auth_required' });
    expect(mockResolve).toHaveBeenCalledWith({ userId: null, userType: null, isEmailVerified: false }, 'p1');
  });

  it('passes a verified registered actor', async () => {
    mockResolve.mockResolvedValue({ decision: 'open', projectName: 'X', roomType: 'arrange' });
    const res = await request(app).get('/api/projects/p1/share-access').set('x-test-actor', 'registered');
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith({ userId: 'u1', userType: 'REGISTERED', isEmailVerified: true }, 'p1');
  });

  it('passes an unverified registered actor', async () => {
    mockResolve.mockResolvedValue({ decision: 'verification_required' });
    const res = await request(app).get('/api/projects/p1/share-access').set('x-test-actor', 'unverified');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ decision: 'verification_required' });
    expect(mockResolve).toHaveBeenCalledWith({ userId: 'u2', userType: 'REGISTERED', isEmailVerified: false }, 'p1');
  });

  it('passes a guest actor', async () => {
    mockResolve.mockResolvedValue({ decision: 'auth_required' });
    const res = await request(app).get('/api/projects/p2/share-access').set('x-test-actor', 'guest');
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith({ userId: 'g1', userType: 'GUEST', isEmailVerified: false }, 'p2');
  });

  it('returns 500 when the service throws', async () => {
    mockResolve.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/p1/share-access');
    expect(res.status).toBe(500);
  });
});

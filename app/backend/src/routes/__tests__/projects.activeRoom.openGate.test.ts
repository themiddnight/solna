import express from 'express';
import request from 'supertest';

/**
 * BR-20 — `PUT /projects/:id/active-room` open gate, exercised through the REAL auth middleware
 * chain (`authenticateToken`), not stubs. This pins the security core of the share-link amendment:
 *  - guest tokens are rejected (401) — the route swapped `authenticateTokenAllowGuest` →
 *    `authenticateToken`, and a `guest:*` id has no DB row;
 *  - unverified registered users are rejected (401) — the OTP hard gate rejects them inside
 *    `authenticateToken` itself, before the service runs;
 *  - verified registered users pass the gate and reach `setActiveRoom`.
 * Only the token verifier and the user lookup are mocked (no DB in this tier).
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

const mockSetActiveRoom = jest.fn() as jest.Mock<Promise<void>>;
jest.mock('../../domains/arrange-room/application/ProjectApplicationService', () => ({
  projectApplicationService: {
    setActiveRoom: (...a: unknown[]): Promise<void> => mockSetActiveRoom(...a),
  },
  // schemas imported by the router must still exist as objects
  updateVisibilityCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  updateSettingsCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  saveFromRoomCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  remixProjectCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  saveFromRoomUpdateCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
}));

import projectRouter from '../projects';

const app = express();
app.use(express.json());
app.use('/api/projects', projectRouter);

const GUEST_PAYLOAD = { userId: 'guest:abc', email: null, username: 'Guest_abc', userType: 'GUEST', type: 'guest' };
const REGISTERED_PAYLOAD = { userId: 'u1', email: 'u1@example.com', userType: 'REGISTERED' };

const makeUserRow = (emailVerified: boolean) => ({
  id: 'u1',
  email: 'u1@example.com',
  username: 'tester',
  userType: 'REGISTERED',
  emailVerified,
});

describe('PUT /api/projects/:id/active-room — BR-20 open gate (real auth middleware)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetActiveRoom.mockResolvedValue(undefined);
  });

  it('rejects a request with no token (401)', async () => {
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(401);
    expect(mockSetActiveRoom).not.toHaveBeenCalled();
  });

  it('rejects a guest token with 401 (strict authenticateToken — guest ids have no DB row)', async () => {
    mockVerifyToken.mockReturnValue(GUEST_PAYLOAD);
    mockFindById.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/projects/p1/active-room')
      .set('Authorization', 'Bearer guest-token')
      .send({ roomId: 'r1' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'User not found' });
    expect(mockFindById).toHaveBeenCalledWith('guest:abc');
    expect(mockSetActiveRoom).not.toHaveBeenCalled();
  });

  it('rejects an unverified registered user with 401 (the OTP hard gate blocks them at authentication)', async () => {
    mockVerifyToken.mockReturnValue(REGISTERED_PAYLOAD);
    mockFindById.mockResolvedValue(makeUserRow(false));

    const res = await request(app)
      .put('/api/projects/p1/active-room')
      .set('Authorization', 'Bearer unverified-token')
      .send({ roomId: 'r1' });

    expect(res.status).toBe(401);
    expect(mockSetActiveRoom).not.toHaveBeenCalled();
  });

  it('lets a verified registered user through to setActiveRoom', async () => {
    mockVerifyToken.mockReturnValue(REGISTERED_PAYLOAD);
    mockFindById.mockResolvedValue(makeUserRow(true));

    const res = await request(app)
      .put('/api/projects/p1/active-room')
      .set('Authorization', 'Bearer verified-token')
      .send({ roomId: 'r1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockSetActiveRoom).toHaveBeenCalledWith('u1', 'p1', 'r1');
  });
});

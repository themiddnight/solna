import type { Request, Response, NextFunction } from 'express';

/**
 * DEV-215 — `authenticateTokenAllowGuest` is the guest-aware verified-identity middleware used by
 * the HTTP create-room path. Its novel behaviour (vs `authenticateToken`) is understanding guest
 * tokens: identity comes from the JWT claims with no DB row, mirroring the socket path's
 * `resolveSocketUser`. The registered-token branch mirrors `authenticateToken`, including the OTP
 * hard gate (unlike `authenticateToken`'s DB-lookup path, this one is exercised directly here too).
 */

const verifyToken = jest.fn();

jest.mock('@/domains/auth/domain/services/TokenService', () => ({
  tokenService: { verifyToken: (token: string): unknown => verifyToken(token) },
}));

// resetMocks:true (jest.config.js) wipes any mockImplementation set on a jest.fn() before every
// test, including one assigned to the UserRepository constructor at jest.mock() factory time. A
// plain class whose method delegates to the (still-mockable) mockFindById avoids that trap —
// mirrors optionalAuthAllowGuest.test.ts / authMiddleware.test.ts in this same directory.
interface MockedUser {
  id: string;
  email: string | null;
  username: string | null;
  userType: string;
  emailVerified: boolean;
}
const mockFindById = jest.fn<Promise<MockedUser | null>, [string]>();
jest.mock('@/domains/auth/infrastructure/repositories/UserRepository', () => ({
  UserRepository: class {
    async findById(id: string): Promise<MockedUser | null> {
      return mockFindById(id);
    }
  },
}));

import { authenticateTokenAllowGuest } from '../authMiddleware';

interface MockRes {
  status: jest.Mock;
  json: jest.Mock;
}

function createMockRes(): Response & MockRes {
  const res = {} as Response & MockRes;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('authenticateTokenAllowGuest (DEV-215)', () => {
  beforeEach(() => {
    verifyToken.mockReset();
    mockFindById.mockReset();
  });

  it('populates req.user as GUEST from a guest token without hitting the DB', async () => {
    verifyToken.mockReturnValue({ userId: 'guest:abc', userType: 'GUEST', username: 'Guest_abc', type: 'guest' });
    const req = { headers: { authorization: 'Bearer token' } } as unknown as Request;
    const next = jest.fn() as NextFunction;

    await authenticateTokenAllowGuest(req, createMockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      id: 'guest:abc',
      email: null,
      username: 'Guest_abc',
      userType: 'GUEST',
      emailVerified: false,
    });
  });

  it('rejects a request with no token', async () => {
    const req = { headers: {} } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn() as NextFunction;

    await authenticateTokenAllowGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid/expired token', async () => {
    verifyToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const req = { headers: { authorization: 'Bearer bad' } } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn() as NextFunction;

    await authenticateTokenAllowGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a registered token whose email is not verified (OTP hard gate)', async () => {
    verifyToken.mockReturnValue({ userId: 'u1', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue({
      id: 'u1', email: 'a@b.c', username: 'alice', userType: 'REGISTERED', emailVerified: false,
    });
    const req = { headers: { authorization: 'Bearer unverified' } } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn() as NextFunction;

    await authenticateTokenAllowGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('admits a registered token whose email is verified', async () => {
    verifyToken.mockReturnValue({ userId: 'u1', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue({
      id: 'u1', email: 'a@b.c', username: 'alice', userType: 'REGISTERED', emailVerified: true,
    });
    const req = { headers: { authorization: 'Bearer verified' } } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn() as NextFunction;

    await authenticateTokenAllowGuest(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.id).toBe('u1');
  });
});

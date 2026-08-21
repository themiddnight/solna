import type { Request, Response, NextFunction } from 'express';

// Matches AuthenticatedUser's field shape (authMiddleware.ts), not the AuthUserModel DB type —
// userType here is a plain string, same as what authenticateToken puts on req.user.
interface MockedUser {
  id: string;
  email: string | null;
  username: string | null;
  userType: string;
  emailVerified: boolean;
}

jest.mock('../../../domain/services/TokenService', () => ({
  tokenService: { verifyToken: jest.fn() },
}));

// resetMocks:true (jest.config.js) wipes any mockImplementation set on a jest.fn() before every
// test, including one assigned to the UserRepository constructor at jest.mock() factory time. A
// plain class whose method delegates to the (still-mockable) mockFindById avoids that trap —
// mirrors optionalAuthAllowGuest.test.ts in this same directory.
const mockFindById = jest.fn<Promise<MockedUser | null>, [string]>();
jest.mock('../../repositories/UserRepository', () => ({
  UserRepository: class {
    async findById(id: string): Promise<MockedUser | null> {
      return mockFindById(id);
    }
  },
}));

import { authenticateToken } from '../authMiddleware';
import { tokenService } from '../../../domain/services/TokenService';

const mockVerifyToken = jest.mocked(tokenService.verifyToken);

function makeRes(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('authenticateToken — unverified hard gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockReturnValue({ userId: 'user-1', email: 'a@b.co', userType: 'REGISTERED' });
  });

  it('rejects a registered user whose email is not verified', async () => {
    mockFindById.mockResolvedValue({
      id: 'user-1', email: 'a@b.co', username: 'u', userType: 'REGISTERED', emailVerified: false,
    });
    const req = { headers: { authorization: 'Bearer tok' } } as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.user).toBeUndefined();
  });

  it('allows a registered user whose email is verified', async () => {
    mockFindById.mockResolvedValue({
      id: 'user-1', email: 'a@b.co', username: 'u', userType: 'REGISTERED', emailVerified: true,
    });
    const req = { headers: { authorization: 'Bearer tok' } } as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('user-1');
  });
});

describe('authenticateToken — rejection paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when no Authorization header is present', async () => {
    const req = { headers: {} } as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(req.user).toBeUndefined();
  });

  it('rejects an invalid or expired token', async () => {
    mockVerifyToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const req = { headers: { authorization: 'Bearer bad-tok' } } as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(req.user).toBeUndefined();
  });

  it('rejects a token whose user no longer exists', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'ghost-1', email: 'x@y.co', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue(null);
    const req = { headers: { authorization: 'Bearer tok' } } as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
    expect(req.user).toBeUndefined();
  });
});

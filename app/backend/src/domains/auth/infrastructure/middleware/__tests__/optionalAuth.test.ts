import type { Request, Response, NextFunction } from 'express';

/**
 * `optionalAuth` backs `POST /auth/logout` (DEV-193): a stale/expired access token must still be
 * able to revoke its own refresh token, so this middleware never rejects — it only decides whether
 * to populate `req.user`. The OTP hard gate degrades an unverified registered token to anonymous
 * here rather than 401ing, unlike `authenticateToken` / `authenticateTokenAllowGuest`.
 */

const mockVerifyToken = jest.fn();
jest.mock('@/domains/auth/domain/services/TokenService', () => ({
  tokenService: { verifyToken: (token: string): unknown => mockVerifyToken(token) },
}));

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

import { optionalAuth } from '../authMiddleware';

function build(authHeader?: string): { req: Request; res: Response; next: NextFunction } {
  const req = { headers: authHeader ? { authorization: authHeader } : {} } as unknown as Request;
  const res = {} as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('optionalAuth — unverified hard gate', () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
    mockFindById.mockReset();
  });

  it('calls next with no req.user when no token', async () => {
    const { req, res, next } = build();
    await optionalAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('degrades an unverified registered token to anonymous rather than rejecting', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'u2', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue({ id: 'u2', email: 'a@b.c', username: 'unverified', userType: 'REGISTERED', emailVerified: false });
    const { req, res, next } = build('Bearer unverified');

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('populates req.user for a verified registered token', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'u1', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue({ id: 'u1', email: 'a@b.c', username: 'reg', userType: 'REGISTERED', emailVerified: true });
    const { req, res, next } = build('Bearer verified');

    await optionalAuth(req, res, next);

    expect(req.user?.id).toBe('u1');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

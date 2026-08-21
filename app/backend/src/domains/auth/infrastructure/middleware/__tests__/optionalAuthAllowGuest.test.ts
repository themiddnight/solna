import type { Request, Response, NextFunction } from 'express';
import type { AuthUserModel } from '../../../domain/models/User';
import { UserType } from '@jam-band/shared';

type MockedUser = Pick<AuthUserModel, 'id' | 'email' | 'username' | 'userType' | 'emailVerified'>;

const mockVerifyToken = jest.fn();
const mockFindById = jest.fn<Promise<MockedUser | null>, [string]>();

jest.mock('../../../domain/services/TokenService', () => ({
  tokenService: { verifyToken: (t: string): unknown => mockVerifyToken(t) as unknown },
}));
jest.mock('../../repositories/UserRepository', () => ({
  UserRepository: class {
    async findById(id: string): Promise<MockedUser | null> {
      return mockFindById(id);
    }
  },
}));

import { optionalAuthAllowGuest } from '../authMiddleware';

function build(authHeader?: string): { req: Request; res: Response; next: NextFunction } {
  const req = { headers: authHeader ? { authorization: authHeader } : {} } as unknown as Request;
  const res = {} as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('optionalAuthAllowGuest', () => {
  beforeEach(() => {
    mockVerifyToken.mockClear();
    mockFindById.mockClear();
  });

  it('calls next with no req.user when no token', async () => {
    const { req, res, next } = build();
    await optionalAuthAllowGuest(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('populates req.user from DB for a registered token', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'u1' });
    mockFindById.mockResolvedValue({ id: 'u1', email: 'a@b.c', username: 'reg', userType: UserType.REGISTERED, emailVerified: true });
    const { req, res, next } = build('Bearer real');
    await optionalAuthAllowGuest(req, res, next);
    expect(req.user).toEqual({ id: 'u1', email: 'a@b.c', username: 'reg', userType: UserType.REGISTERED, emailVerified: true });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('populates req.user as GUEST from claims for a guest token (no DB lookup)', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'g1', type: 'guest', username: 'guesty' });
    const { req, res, next } = build('Bearer guest');
    await optionalAuthAllowGuest(req, res, next);
    expect(mockFindById).not.toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'g1', email: null, username: 'guesty', userType: 'GUEST', emailVerified: false });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('continues as anonymous when a registered token has no matching DB user (deleted account)', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'gone' });
    mockFindById.mockResolvedValue(null);
    const { req, res, next } = build('Bearer stale');
    await optionalAuthAllowGuest(req, res, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('degrades an unverified registered token to anonymous (OTP hard gate) rather than rejecting', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'u2' });
    mockFindById.mockResolvedValue({ id: 'u2', email: 'a@b.c', username: 'unverified', userType: UserType.REGISTERED, emailVerified: false });
    const { req, res, next } = build('Bearer unverified');
    await optionalAuthAllowGuest(req, res, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next with no req.user when the token is invalid', async () => {
    mockVerifyToken.mockImplementation(() => { throw new Error('bad'); });
    const { req, res, next } = build('Bearer broken');
    await optionalAuthAllowGuest(req, res, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

import type { Socket } from 'socket.io';

jest.mock('@/domains/auth/domain/services/TokenService', () => ({
  tokenService: { verifyToken: jest.fn() },
}));

const mockFindById = jest.fn();
jest.mock('@/domains/auth/infrastructure/repositories/UserRepository', () => ({
  UserRepository: class {
    async findById(id: string): Promise<unknown> {
      return mockFindById(id);
    }
  },
}));

import { authenticateSocket } from '../socket';
import { tokenService } from '@/domains/auth/domain/services/TokenService';
import { CacheService } from '@/shared/infrastructure/caching/CacheService';

const mockVerifyToken = jest.mocked(tokenService.verifyToken);

function makeSocket(token: string): Socket {
  return {
    handshake: { auth: { token }, headers: {} },
    data: {},
    emit: jest.fn(),
    on: jest.fn(),
  } as unknown as Socket;
}

describe('authenticateSocket — unverified hard gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The resolver caches its user projection; a stale entry would mask the gate.
    CacheService.getInstance().flush();
  });

  it('rejects a registered user whose email is not verified', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'user-1', email: 'a@b.co', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue({
      id: 'user-1', email: 'a@b.co', username: 'u', userType: 'REGISTERED',
      emailVerified: false, profilePictureUrl: null,
    });
    const socket = makeSocket('tok');
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((socket.data as { user?: unknown }).user).toBeUndefined();
  });

  it('admits a registered user whose email is verified', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'user-2', email: 'a@b.co', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue({
      id: 'user-2', email: 'a@b.co', username: 'u', userType: 'REGISTERED',
      emailVerified: true, profilePictureUrl: null,
    });
    const socket = makeSocket('tok');
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect((socket.data as { user?: { id: string } }).user?.id).toBe('user-2');
  });

  it('leaves guests unaffected — they resolve from JWT claims before the gate', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'guest:abc', email: null, username: 'Guest', userType: 'GUEST', type: 'guest' });
    const socket = makeSocket('guest-tok');
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(mockFindById).not.toHaveBeenCalled();
  });
});

describe('authenticateSocket — rejection paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    CacheService.getInstance().flush();
  });

  it('rejects when no token is provided in handshake', async () => {
    const socket = makeSocket('');
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication required' }));
    expect((socket.data as { user?: unknown }).user).toBeUndefined();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token', async () => {
    mockVerifyToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const socket = makeSocket('bad-tok');
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication required' }));
    expect((socket.data as { user?: unknown }).user).toBeUndefined();
  });

  it('rejects a token whose user no longer exists', async () => {
    mockVerifyToken.mockReturnValue({ userId: 'ghost-1', email: 'x@y.co', userType: 'REGISTERED' });
    mockFindById.mockResolvedValue(null);
    const socket = makeSocket('tok');
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication required' }));
    expect((socket.data as { user?: unknown }).user).toBeUndefined();
  });
});

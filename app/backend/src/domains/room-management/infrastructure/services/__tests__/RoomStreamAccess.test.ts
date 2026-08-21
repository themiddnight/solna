import type { Request } from 'express';
import type { Room, BandMember } from '@/types';
import { createPartialMock } from '@/testing/mocks';
import { canStreamRoomMedia, resolveTokenUserId } from '../RoomStreamAccess';

jest.mock('@/domains/auth/domain/services/TokenService', () => ({
  tokenService: { verifyToken: jest.fn() },
}));

import { tokenService } from '@/domains/auth/domain/services/TokenService';

const verifyToken = jest.mocked(tokenService).verifyToken;

const reqWithToken = (token?: string): Request =>
  createPartialMock<Request>({
    headers: token !== undefined ? { authorization: `Bearer ${token}` } : {},
  });

const makeRoom = (
  isPrivate: boolean,
  memberIds: string[],
): Pick<Room, 'isPrivate' | 'bandMembers' | 'audiences'> => ({
  isPrivate,
  bandMembers: new Map<string, BandMember>(
    memberIds.map((id) => [id, { id, username: 'u', role: 'band_member', isReady: false }]),
  ),
  audiences: new Map(),
});

beforeEach(() => {
  jest.clearAllMocks();
  verifyToken.mockImplementation((token: string) => {
    if (token === 'member') return { userId: 'member-1', email: null, userType: 'REGISTERED' };
    if (token === 'stranger') return { userId: 'stranger-1', email: null, userType: 'REGISTERED' };
    throw new Error('invalid token');
  });
});

describe('canStreamRoomMedia (DEV-190)', () => {
  it('allows anyone to stream a PUBLIC room (no token needed)', () => {
    const room = makeRoom(false, []);
    expect(canStreamRoomMedia(room, reqWithToken())).toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('allows a verified member to stream a PRIVATE room', () => {
    const room = makeRoom(true, ['member-1']);
    expect(canStreamRoomMedia(room, reqWithToken('member'))).toBe(true);
  });

  it('denies a verified NON-member on a PRIVATE room', () => {
    const room = makeRoom(true, ['member-1']);
    expect(canStreamRoomMedia(room, reqWithToken('stranger'))).toBe(false);
  });

  it('denies a PRIVATE room when no token is presented (cannot bypass by omitting it)', () => {
    const room = makeRoom(true, ['member-1']);
    expect(canStreamRoomMedia(room, reqWithToken())).toBe(false);
  });

  it('denies a PRIVATE room when the token is invalid', () => {
    const room = makeRoom(true, ['member-1']);
    expect(canStreamRoomMedia(room, reqWithToken('garbage'))).toBe(false);
  });
});

describe('resolveTokenUserId', () => {
  it('returns the userId from a valid Bearer token', () => {
    expect(resolveTokenUserId(reqWithToken('member'))).toBe('member-1');
  });

  it('returns null when the header is absent', () => {
    expect(resolveTokenUserId(reqWithToken())).toBeNull();
  });

  it('returns null when the token is invalid', () => {
    expect(resolveTokenUserId(reqWithToken('garbage'))).toBeNull();
  });
});

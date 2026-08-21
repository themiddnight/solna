import type { Response } from 'express';
import { RoomController } from '../infrastructure/controllers/RoomController';
import type { RoomLifecycleService } from '../application/RoomLifecycleService';
import type { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import type { NamespaceGracePeriodManager } from '@/shared/infrastructure/namespace/NamespaceGracePeriodManager';
import type { AuthRequest, AuthenticatedUser } from '@/domains/auth/infrastructure/middleware/authMiddleware';
import type { Room } from '@/types';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

/**
 * DEV-262 follow-up — invite codes are stripped from every room broadcast and
 * delivered to the owner only once (the one-shot ROOM_JOINED). A user who becomes
 * owner *after* join (ownership transfer, guest→registered swap) — or who missed
 * that one-shot — never receives them and the invite menu silently no-ops. This
 * owner-only endpoint lets the client (re)fetch fresh codes on demand.
 *
 * Security: acting identity is the token-verified `req.user.id` (TR-33); a
 * non-owner must not be able to read another room's private invite codes (IDOR).
 */

const ROOM_ID = 'room-1';
const OWNER_ID = 'user-owner';

function user(id: string): AuthenticatedUser {
  return { id, email: null, username: id, userType: 'REGISTERED', emailVerified: true };
}

function req(roomId: string | undefined, u?: AuthenticatedUser): AuthRequest {
  return { params: { roomId }, user: u } as unknown as AuthRequest;
}

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

function makeController(room?: Room) {
  const getRoom = jest.fn().mockResolvedValue(room);
  const lifecycle = createPartialMock<RoomLifecycleService>({ getRoom });
  const controller = new RoomController(
    lifecycle,
    createPartialMock<RoomSessionManager>({}),
    createPartialMock<NamespaceGracePeriodManager>({}),
  );
  return { controller, getRoom };
}

function ownedRoom(): Room {
  return {
    id: ROOM_ID,
    owner: OWNER_ID,
    bandMemberInviteCode: 'band-abc',
    audienceInviteCode: 'aud-xyz',
  } as Room;
}

describe('RoomController.getRoomInviteCodes (DEV-262 follow-up)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns both invite codes to the room owner', async () => {
    const { controller } = makeController(ownedRoom());
    const res = createMockRes();

    await controller.getRoomInviteCodes(req(ROOM_ID, user(OWNER_ID)), res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      bandMemberInviteCode: 'band-abc',
      audienceInviteCode: 'aud-xyz',
    });
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('forbids a non-owner from reading the codes (403, IDOR guard, TR-33)', async () => {
    const { controller } = makeController(ownedRoom());
    const res = createMockRes();

    await controller.getRoomInviteCodes(req(ROOM_ID, user('user-someone-else')), res);

    expect(res.status).toHaveBeenCalledWith(403);
    // The refusal body carries no codes — it is exactly the error payload.
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Only the room owner can view invite links',
    });
  });

  it('never trusts a client-supplied id — keys off req.user (TR-33)', async () => {
    // The owner check must use the verified session id, so even if a caller could
    // smuggle a body/param userId, only req.user.id decides ownership.
    const { controller } = makeController(ownedRoom());
    const res = createMockRes();

    await controller.getRoomInviteCodes(req(ROOM_ID, user('attacker')), res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 404 when the room does not exist', async () => {
    const { controller } = makeController(undefined);
    const res = createMockRes();

    await controller.getRoomInviteCodes(req(ROOM_ID, user(OWNER_ID)), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 401 when the request is unauthenticated', async () => {
    const { controller, getRoom } = makeController(ownedRoom());
    const res = createMockRes();

    await controller.getRoomInviteCodes(req(ROOM_ID, undefined), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(getRoom).not.toHaveBeenCalled();
  });

  it('returns 400 when roomId is missing', async () => {
    const { controller } = makeController(ownedRoom());
    const res = createMockRes();

    await controller.getRoomInviteCodes(req(undefined, user(OWNER_ID)), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('omits a code that the room does not have (undefined, not null)', async () => {
    const room = { id: ROOM_ID, owner: OWNER_ID, bandMemberInviteCode: 'band-abc' } as Room;
    const { controller } = makeController(room);
    const res = createMockRes();

    await controller.getRoomInviteCodes(req(ROOM_ID, user(OWNER_ID)), res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      bandMemberInviteCode: 'band-abc',
      audienceInviteCode: undefined,
    });
  });
});

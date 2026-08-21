import type { Request, Response } from 'express';
import { RoomCreationHandler } from '../infrastructure/handlers/RoomCreationHandler';
import type { RoomLifecycleHandler } from '../infrastructure/handlers/RoomLifecycleHandler';
import type { AuthenticatedUser } from '@/domains/auth/infrastructure/middleware/authMiddleware';
import { RoomType } from '@/types';
import type { Room } from '@/types';

/**
 * DEV-221 (regression) — the onboarding tour creates the guest's room through the REST create path
 * (lobby modal → POST /rooms → handleCreateRoomHttp), NOT the socket path. So the HTTP handler must
 * honor `isTourRoom` with the SAME bounded guardrails as the socket path: bypass the FC-2
 * guest/unverified guard, force isPrivate:false/isHidden:true/isIsolated:true, cap at one isolated
 * room per owner, and not advertise the room (no domain event; hidden rooms are already not
 * broadcast). Without this, a guest tour room is created visible/joinable — the shipped bug.
 */

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

function createReq(body: Record<string, unknown>, user?: AuthenticatedUser): Request {
  return { body, user } as unknown as Request;
}

const guestUser: AuthenticatedUser = {
  id: 'guest:1',
  email: null,
  username: 'Guest',
  userType: 'GUEST',
  emailVerified: false,
};

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room:1',
    name: 'Tour',
    roomType: RoomType.PERFORM,
    owner: 'guest:1',
    bandMembers: new Map(),
    audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: true,
    isIsolated: true,
    createdAt: new Date(),
    metronome: { bpm: 120, beatZeroAt: Date.now() },
    bandMemberInviteCode: 'BM-XXXX',
    audienceInviteCode: 'AUD-XXXX',
    ...overrides,
  } as Room;
}

function makeHandler() {
  const createRoom = jest.fn();
  const deleteRoom = jest.fn();
  const getIsolatedRoomsOwnedBy = jest.fn().mockResolvedValue([]);
  const buildRoomPayload = jest.fn().mockResolvedValue({ room: {} });
  const broadcastToLobby = jest.fn();

  const stub = {
    ensureUserId: (id: string) => id,
    ensureRoomId: (id: string) => id,
    userIdToString: (id: string) => id,
    roomIdToString: (id: string) => id,
    roomLifecycleService: { createRoom, deleteRoom, getIsolatedRoomsOwnedBy },
    namespaceManager: {
      createRoomNamespace: jest.fn(),
      createApprovalNamespace: jest.fn(),
    },
    metronomeService: { initializeRoomMetronome: jest.fn() },
    arrangeRoomStateService: undefined,
    eventBus: { publish: jest.fn() },
    broadcastToLobby,
    buildRoomPayload,
  };

  const handler = new RoomCreationHandler(stub as unknown as RoomLifecycleHandler);
  return { handler, createRoom, deleteRoom, getIsolatedRoomsOwnedBy, broadcastToLobby, stub };
}

describe('RoomCreationHandler.handleCreateRoomHttp — isTourRoom (DEV-221 REST regression)', () => {
  it('lets a guest create an isolated tour room (bypasses FC-2), forces flags, does not advertise', async () => {
    const { handler, createRoom, broadcastToLobby, stub } = makeHandler();
    createRoom.mockResolvedValue({ room: makeRoom(), user: { id: 'guest:1', username: 'G' } });

    const req = createReq({ name: 'Tour', username: 'G', userId: 'client-user-id', roomType: 'perform', isPrivate: false, isHidden: false, isTourRoom: true }, guestUser);
    const res = createMockRes();

    await handler.handleCreateRoomHttp(req, res);

    expect(createRoom).toHaveBeenCalledTimes(1);
    const args = createRoom.mock.calls[0] as unknown[];
    expect(args[3]).toBe(false); // isPrivate forced false
    expect(args[4]).toBe(true); // isHidden forced true
    expect(args[args.length - 1]).toBe(true); // isIsolated forced true

    expect(res.status).toHaveBeenCalledWith(201);
    expect(broadcastToLobby).not.toHaveBeenCalled(); // hidden → not advertised
    expect(stub.eventBus.publish).not.toHaveBeenCalled(); // tour room → no domain event
  });

  it('still blocks a guest from creating a normal hidden room (FC-2 intact, no isTourRoom)', async () => {
    const { handler, createRoom } = makeHandler();
    const req = createReq({ name: 'X', username: 'G', userId: 'client-user-id', roomType: 'perform', isPrivate: false, isHidden: true }, guestUser);
    const res = createMockRes();

    await handler.handleCreateRoomHttp(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('deletes a pre-existing isolated room owned by the same user before creating (cap = 1)', async () => {
    const { handler, createRoom, deleteRoom, getIsolatedRoomsOwnedBy } = makeHandler();
    getIsolatedRoomsOwnedBy.mockResolvedValue([makeRoom({ id: 'room:old', owner: 'guest:1' })]);
    createRoom.mockResolvedValue({ room: makeRoom({ id: 'room:new' }), user: { id: 'guest:1', username: 'G' } });

    const req = createReq({ name: 'Tour', username: 'G', userId: 'client-user-id', roomType: 'perform', isPrivate: false, isHidden: false, isTourRoom: true }, guestUser);
    const res = createMockRes();

    await handler.handleCreateRoomHttp(req, res);

    expect(getIsolatedRoomsOwnedBy).toHaveBeenCalledWith('guest:1');
    expect(deleteRoom).toHaveBeenCalledWith('room:old');
  });
});

import { PerformCollaborationHandler } from '../PerformCollaborationHandler';
import { PERFORM_EVENTS, ROOM_STATE_EVENTS, SHARED_EVENTS } from '@jam-band/shared';
import type { Namespace, Server, Socket } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceSession, RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import { RoomType } from '@/types';
import type { BandMember, Room } from '@/types';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logRoomActivity: jest.fn(),
    logUserActivity: jest.fn(),
  },
}));

describe('PerformCollaborationHandler — swap state machine and kick paths', () => {
  const ROOM_ID = 'room-1';

  interface FakeUserSpec {
    id: string;
    username: string;
    role: 'room_owner' | 'band_member' | 'audience';
    instrument?: string;
    category?: string;
    synthParams?: Record<string, unknown>;
  }

  interface Harness {
    handler: PerformCollaborationHandler;
    room: Room;
    namespace: jest.Mocked<Namespace>;
    sockets: Map<string, Socket>;
    socketEmits: Map<string, jest.Mock>;
    roomLifecycleService: jest.Mocked<RoomLifecycleService>;
    roomMembershipService: jest.Mocked<RoomMembershipService>;
  }

  /**
   * House pattern: real handler + mocked injected services + fake socket/namespace.
   * `namespace.sockets` is a real Map so findSocketByUserId iterates like the real server.
   * Sessions are keyed by socket id, mirroring RoomSessionManager.getRoomSession.
   */
  function buildHarness(users: FakeUserSpec[], ownerId: string): Harness {
    const room: Room = {
      id: ROOM_ID,
      name: 'Test Room',
      roomType: RoomType.PERFORM,
      owner: ownerId,
      bandMembers: new Map(),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(),
      metronome: { bpm: 120, beatZeroAt: Date.now() },
    };

    const sockets = new Map<string, Socket>();
    const socketEmits = new Map<string, jest.Mock>();
    const sessions = new Map<string, NamespaceSession>();

    for (const user of users) {
      const socketId = `socket-${user.id}`;
      const emit = jest.fn();
      socketEmits.set(user.id, emit);
      sockets.set(socketId, createPartialMock<Socket>({ id: socketId, emit, leave: jest.fn() }));
      sessions.set(socketId, {
        socketId,
        userId: user.id,
        username: user.username,
        roomId: ROOM_ID,
        namespacePath: `/room/${ROOM_ID}`,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      if (user.role === 'audience') {
        room.audiences.set(user.id, { id: user.id, username: user.username, role: 'audience', joinedAt: new Date() });
      } else {
        const member: BandMember = {
          id: user.id,
          username: user.username,
          role: user.role,
          isReady: true,
          ...(user.instrument !== undefined && { currentInstrument: user.instrument }),
          ...(user.category !== undefined && { currentCategory: user.category }),
          ...(user.synthParams !== undefined && { synthParams: user.synthParams }),
        };
        room.bandMembers.set(user.id, member);
      }
    }

    const roomLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn().mockResolvedValue(room),
      removeFromGracePeriod: jest.fn().mockResolvedValue(undefined),
      getRoomGracePeriodUsers: jest.fn().mockReturnValue([]),
    });
    const roomMembershipService = createPartialMock<RoomMembershipService>({
      isRoomOwner: jest.fn().mockResolvedValue(false),
      removeUserFromRoom: jest.fn().mockResolvedValue(undefined),
      updateUserInstrument: jest.fn().mockResolvedValue(true),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
    });
    const roomSessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn((socketId: string) => sessions.get(socketId)),
    });

    const namespace = createPartialMock<Namespace>({
      sockets,
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
    });

    const handler = new PerformCollaborationHandler(
      roomLifecycleService,
      roomMembershipService,
      createPartialMock<Server>({}),
      createPartialMock<NamespaceManager>({}),
      roomSessionManager,
    );

    return {
      handler,
      room,
      namespace,
      sockets,
      socketEmits,
      roomLifecycleService,
      roomMembershipService,
    };
  }

  const ALICE: FakeUserSpec = { id: 'user-a', username: 'Alice', role: 'band_member', instrument: 'guitar', category: 'guitar' };
  const BOB: FakeUserSpec = { id: 'user-b', username: 'Bob', role: 'band_member', instrument: 'drums', category: 'percussion' };

  describe('instrument swap — request / approve / executeSwap', () => {
    it('happy path: approve mutates both BandMembers, persists via updateUserInstrument, broadcasts SWAP_COMPLETED + instrument_changed', async () => {
      const h = buildHarness([ALICE, BOB], 'user-a');
      const requesterSocket = h.sockets.get('socket-user-a')!;
      const targetSocket = h.sockets.get('socket-user-b')!;

      await h.handler.handleRequestInstrumentSwap(
        requesterSocket,
        { targetUserId: 'user-b', sequencerState: { banks: { a: 1 }, settings: {}, currentBank: 'a' } },
        h.namespace,
      );

      // Request side effects: requester confirmed, target notified
      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_SENT, { targetUserId: 'user-b' });
      expect(h.socketEmits.get('user-b')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_RECEIVED, {
        requesterId: 'user-a',
        requesterUsername: 'Alice',
      });

      await h.handler.handleApproveInstrumentSwap(
        targetSocket,
        { requesterId: 'user-a', sequencerState: { banks: { b: 1 }, settings: {}, currentBank: 'b' } },
        h.namespace,
      );

      // Real state transition: A (guitar) now holds B's drums, B holds A's guitar
      const aliceAfter = h.room.bandMembers.get('user-a')!;
      const bobAfter = h.room.bandMembers.get('user-b')!;
      expect(aliceAfter.currentInstrument).toBe('drums');
      expect(aliceAfter.currentCategory).toBe('percussion');
      expect(bobAfter.currentInstrument).toBe('guitar');
      expect(bobAfter.currentCategory).toBe('guitar');

      // Persisted via room membership service for both users
      expect(h.roomMembershipService.updateUserInstrument).toHaveBeenCalledWith(ROOM_ID, 'user-a', 'drums', 'percussion');
      expect(h.roomMembershipService.updateUserInstrument).toHaveBeenCalledWith(ROOM_ID, 'user-b', 'guitar', 'guitar');

      // Broadcast: SWAP_COMPLETED carries destination instruments + swapped sequencer states
      // (A gets B's sequencer state, B gets A's)
      expect(h.namespace.emit).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_COMPLETED, {
        userA: {
          userId: 'user-a',
          instrumentName: 'drums',
          category: 'percussion',
          synthParams: undefined,
          sequencerState: { banks: { b: 1 }, settings: {}, currentBank: 'b' },
        },
        userB: {
          userId: 'user-b',
          instrumentName: 'guitar',
          category: 'guitar',
          synthParams: undefined,
          sequencerState: { banks: { a: 1 }, settings: {}, currentBank: 'a' },
        },
      });

      // Standard instrument events so non-participants update immediately
      expect(h.namespace.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.INSTRUMENT_CHANGED,
        expect.objectContaining({ userId: 'user-a', username: 'Alice', instrument: 'drums', category: 'percussion' }),
      );
      expect(h.namespace.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.INSTRUMENT_CHANGED,
        expect.objectContaining({ userId: 'user-b', username: 'Bob', instrument: 'guitar', category: 'guitar' }),
      );

      // Pending entry cleared: a fresh request from A is accepted again
      await h.handler.handleRequestInstrumentSwap(requesterSocket, { targetUserId: 'user-b' }, h.namespace);
      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_SENT, { targetUserId: 'user-b' });
      expect(h.socketEmits.get('user-a')).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_ERROR, expect.anything());
    });

    it('synth swap: receiver of a synthesizer keeps the source synthParams and synth_params_changed is broadcast', async () => {
      const synthAlice: FakeUserSpec = {
        ...ALICE,
        category: 'synthesizer',
        synthParams: { filter: { cutoff: 800 } },
      };
      const h = buildHarness([synthAlice, BOB], 'user-a');

      await h.handler.handleRequestInstrumentSwap(h.sockets.get('socket-user-a')!, { targetUserId: 'user-b' }, h.namespace);
      await h.handler.handleApproveInstrumentSwap(h.sockets.get('socket-user-b')!, { requesterId: 'user-a' }, h.namespace);

      // B receives the synth, so B keeps A's synth params; A (now drums) has none
      const aliceAfter = h.room.bandMembers.get('user-a')!;
      const bobAfter = h.room.bandMembers.get('user-b')!;
      expect(aliceAfter.currentInstrument).toBe('drums');
      expect(aliceAfter.currentCategory).toBe('percussion');
      expect(aliceAfter.synthParams).toBeUndefined();
      expect(bobAfter.currentInstrument).toBe('guitar');
      expect(bobAfter.currentCategory).toBe('synthesizer');
      expect(bobAfter.synthParams).toEqual({ filter: { cutoff: 800 } });

      expect(h.namespace.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.SYNTH_PARAMS_CHANGED,
        expect.objectContaining({ userId: 'user-b', params: { filter: { cutoff: 800 } } }),
      );
    });

    it.each([
      { involved: 'requester', users: [{ id: 'user-a', username: 'Alice', role: 'audience' as const }, BOB] },
      { involved: 'target', users: [ALICE, { id: 'user-b', username: 'Bob', role: 'audience' as const }] },
    ])('audience as $involved → swap rejected with SWAP_ERROR', async ({ users }) => {
      const h = buildHarness(users, 'user-a');
      const requesterSocket = h.sockets.get('socket-user-a')!;

      await h.handler.handleRequestInstrumentSwap(requesterSocket, { targetUserId: 'user-b' }, h.namespace);

      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(
        PERFORM_EVENTS.SWAP_ERROR,
        expect.objectContaining({ message: 'Cannot swap with audience members' }),
      );
      // No request recorded, nothing sent to the target
      expect(h.socketEmits.get('user-a')).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_SENT, expect.anything());
      expect(h.socketEmits.get('user-b')).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_RECEIVED, expect.anything());

      // Nothing persisted or broadcast
      expect(h.roomMembershipService.updateUserInstrument).not.toHaveBeenCalled();
      expect(h.namespace.emit).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_COMPLETED, expect.anything());
    });

    it('duplicate pending request from the same requester → rejected, target notified once', async () => {
      const h = buildHarness([ALICE, BOB], 'user-a');
      const requesterSocket = h.sockets.get('socket-user-a')!;

      await h.handler.handleRequestInstrumentSwap(requesterSocket, { targetUserId: 'user-b' }, h.namespace);
      await h.handler.handleRequestInstrumentSwap(requesterSocket, { targetUserId: 'user-b' }, h.namespace);

      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(
        PERFORM_EVENTS.SWAP_ERROR,
        expect.objectContaining({ message: 'You already have a pending swap request' }),
      );
      // Second request never reached the target
      expect(h.socketEmits.get('user-b')).toHaveBeenCalledTimes(1);
      expect(h.socketEmits.get('user-b')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_RECEIVED, expect.objectContaining({ requesterId: 'user-a' }));
    });

    it.each([
      // exactOptionalPropertyTypes: omit the key entirely instead of setting undefined
      { missing: 'instrument', spec: { id: 'user-a', username: 'Alice', role: 'band_member' as const, category: 'guitar' } },
      { missing: 'category', spec: { id: 'user-a', username: 'Alice', role: 'band_member' as const, instrument: 'guitar' } },
    ])('missing $missing on a participant → executeSwap aborts, notifies both, clears pending', async ({ spec }) => {
      const h = buildHarness([spec, BOB], 'user-a');
      const requesterSocket = h.sockets.get('socket-user-a')!;
      const targetSocket = h.sockets.get('socket-user-b')!;

      await h.handler.handleRequestInstrumentSwap(requesterSocket, { targetUserId: 'user-b' }, h.namespace);
      await h.handler.handleApproveInstrumentSwap(targetSocket, { requesterId: 'user-a' }, h.namespace);

      // Abort: both participants informed, no state mutation, no persistence, no broadcast
      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_ERROR, { message: 'Swap failed: missing instrument/category' });
      expect(h.socketEmits.get('user-b')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_ERROR, { message: 'Swap failed: missing instrument/category' });
      // No state mutation: the target still holds his own instrument
      expect(h.room.bandMembers.get('user-b')?.currentInstrument).toBe('drums');
      expect(h.roomMembershipService.updateUserInstrument).not.toHaveBeenCalled();
      expect(h.namespace.emit).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_COMPLETED, expect.anything());

      // Pending entry cleared: a fresh request is accepted again
      await h.handler.handleRequestInstrumentSwap(requesterSocket, { targetUserId: 'user-b' }, h.namespace);
      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_SENT, { targetUserId: 'user-b' });
    });

    it('approve without a matching pending request → SWAP_ERROR, nothing swapped', async () => {
      const h = buildHarness([ALICE, BOB], 'user-a');

      await h.handler.handleApproveInstrumentSwap(h.sockets.get('socket-user-b')!, { requesterId: 'user-a' }, h.namespace);

      expect(h.socketEmits.get('user-b')).toHaveBeenCalledWith(
        PERFORM_EVENTS.SWAP_ERROR,
        expect.objectContaining({ message: 'No pending swap request found' }),
      );
      expect(h.roomMembershipService.updateUserInstrument).not.toHaveBeenCalled();
      expect(h.namespace.emit).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_COMPLETED, expect.anything());
    });
  });

  describe('kick — handleKickUser', () => {
    it('non-owner kick → rejected with KICK_ERROR, no removal, no grace-period touch', async () => {
      const h = buildHarness([ALICE, BOB], 'user-a');
      // Session user-a is NOT the room owner
      h.roomMembershipService.isRoomOwner.mockResolvedValue(false);

      await h.handler.handleKickUser(h.sockets.get('socket-user-a')!, { targetUserId: 'user-b' }, h.namespace);

      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(
        PERFORM_EVENTS.KICK_ERROR,
        expect.objectContaining({ message: 'Only room owner can kick users' }),
      );
      expect(h.roomMembershipService.removeUserFromRoom).not.toHaveBeenCalled();
      expect(h.roomLifecycleService.removeFromGracePeriod).not.toHaveBeenCalled();
      expect(h.socketEmits.get('user-b')).not.toHaveBeenCalledWith(SHARED_EVENTS.USER_KICKED, expect.anything());
      expect(h.namespace.emit).not.toHaveBeenCalledWith(ROOM_STATE_EVENTS.USER_LEFT, expect.anything());
    });

    it('owner kick: intended removal + grace-period cleanup, targeted USER_KICKED, fresh-room broadcast excludes the kicked user', async () => {
      const h = buildHarness([ALICE, BOB], 'user-a');
      h.roomMembershipService.isRoomOwner.mockResolvedValue(true);
      // Fresh room state after removal (ISSUE-61 pattern): kicked user absent
      const remainingMembers = [h.room.bandMembers.get('user-a')!];
      h.roomMembershipService.getBandMembers.mockResolvedValue(remainingMembers);

      await h.handler.handleKickUser(h.sockets.get('socket-user-a')!, { targetUserId: 'user-b' }, h.namespace);

      // Intended-removal semantics: prevents grace-period "reconnecting" badge
      expect(h.roomMembershipService.removeUserFromRoom).toHaveBeenCalledWith(ROOM_ID, 'user-b', true);
      expect(h.roomLifecycleService.removeFromGracePeriod).toHaveBeenCalledWith('user-b', ROOM_ID);

      // Kicked user notified directly on their own socket (not via namespace broadcast)
      expect(h.socketEmits.get('user-b')).toHaveBeenCalledWith(SHARED_EVENTS.USER_KICKED, { reason: 'Kicked by room owner' });
      expect(h.socketEmits.get('user-a')).not.toHaveBeenCalledWith(SHARED_EVENTS.USER_KICKED, expect.anything());
      const kickedSocket = h.sockets.get('socket-user-b')!;
      expect(kickedSocket.leave).toHaveBeenCalledWith(ROOM_ID);

      // Everyone notified of the departure (the exact member object held in the room)
      const bobMember = h.room.bandMembers.get('user-b')!;
      expect(h.namespace.emit).toHaveBeenCalledWith(ROOM_STATE_EVENTS.USER_LEFT, { user: bobMember });

      // Fresh-room broadcast (TR-3): fetched AFTER removal and built from fresh queries —
      // the ROOM_STATE_UPDATED payload must not contain the kicked user
      expect(h.roomLifecycleService.getRoom).toHaveBeenCalledTimes(2); // initial lookup + fresh fetch
      expect(h.roomMembershipService.getBandMembers).toHaveBeenCalledWith(ROOM_ID);
      const roomStateEmit = h.namespace.emit.mock.calls.find(([event]) => event === ROOM_STATE_EVENTS.ROOM_STATE_UPDATED);
      expect(roomStateEmit).toBeDefined();
      const payload = roomStateEmit![1] as { room: { bandMembers: BandMember[]; audiences: unknown[] } };
      expect(payload.room.bandMembers.map((member) => member.id)).not.toContain('user-b');
      expect(payload.room.bandMembers.map((member) => member.id)).toContain('user-a');
    });
  });

  describe('disconnect — handleUserDisconnect', () => {
    it('cancels pending swaps targeting the disconnected user and notifies the requester', async () => {
      const h = buildHarness([ALICE, BOB], 'user-a');

      await h.handler.handleRequestInstrumentSwap(h.sockets.get('socket-user-a')!, { targetUserId: 'user-b' }, h.namespace);
      h.handler.handleUserDisconnect('user-b', h.namespace);

      // Requester notified that the swap is off
      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_CANCELLED);

      // Pending entry really gone: a late approve finds nothing
      await h.handler.handleApproveInstrumentSwap(h.sockets.get('socket-user-b')!, { requesterId: 'user-a' }, h.namespace);
      expect(h.socketEmits.get('user-b')).toHaveBeenCalledWith(
        PERFORM_EVENTS.SWAP_ERROR,
        expect.objectContaining({ message: 'No pending swap request found' }),
      );
      expect(h.namespace.emit).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_COMPLETED, expect.anything());
    });

    it('removes the disconnecting user\'s own pending request without notifying anyone', async () => {
      const h = buildHarness([ALICE, BOB], 'user-a');

      await h.handler.handleRequestInstrumentSwap(h.sockets.get('socket-user-a')!, { targetUserId: 'user-b' }, h.namespace);
      h.handler.handleUserDisconnect('user-a', h.namespace);

      expect(h.socketEmits.get('user-b')).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_CANCELLED);
      expect(h.socketEmits.get('user-a')).not.toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_CANCELLED);

      // Pending entry gone: re-request from A's socket is accepted
      await h.handler.handleRequestInstrumentSwap(h.sockets.get('socket-user-a')!, { targetUserId: 'user-b' }, h.namespace);
      expect(h.socketEmits.get('user-a')).toHaveBeenCalledWith(PERFORM_EVENTS.SWAP_REQUEST_SENT, { targetUserId: 'user-b' });
    });
  });
});

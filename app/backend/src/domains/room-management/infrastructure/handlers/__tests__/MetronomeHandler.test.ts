import { MetronomeHandler } from '../MetronomeHandler';
import { METRONOME_EVENTS } from '@jam-band/shared';
import type { Namespace, Socket } from 'socket.io';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { MetronomeService } from '../../services/MetronomeService';
import type { NamespaceSession, RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { Room } from '@/types';
import { RoomType } from '@/types';
import { createPartialMock } from '@/testing/mocks';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
  },
}));

/**
 * House pattern: real handler + mocked injected services + fake socket/namespace
 * (mirrors PerformCollaborationHandler.test.ts). These tests document the
 * MetronomeHandler role gate, BPM delegation, error containment, and the
 * anchor beatZeroAt preference (in-memory tick time over Redis-stored value).
 */
describe('MetronomeHandler — role gate, BPM delegation, anchor sync', () => {
  const ROOM_ID = 'room-1';
  const SOCKET_ID = 'socket-a';
  const STORED_BEAT_ZERO_AT = 12345;

  type RoomRole = 'room_owner' | 'band_member' | 'audience' | 'absent';

  function makeRoom(userRole: RoomRole): Room {
    const room: Room = {
      id: ROOM_ID,
      name: 'Test Room',
      roomType: RoomType.PERFORM,
      owner: 'user-a',
      bandMembers: new Map(),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(),
      metronome: { bpm: 120, beatZeroAt: STORED_BEAT_ZERO_AT },
    };

    if (userRole === 'audience') {
      room.audiences.set('user-a', { id: 'user-a', username: 'Alice', role: 'audience', joinedAt: new Date() });
    } else if (userRole !== 'absent') {
      room.bandMembers.set('user-a', { id: 'user-a', username: 'Alice', role: userRole, isReady: true });
    }
    return room;
  }

  interface Harness {
    handler: MetronomeHandler;
    socket: jest.Mocked<Socket>;
    namespace: jest.Mocked<Namespace>;
    roomLifecycleService: jest.Mocked<RoomLifecycleService>;
    metronomeService: jest.Mocked<MetronomeService>;
    roomSessionManager: jest.Mocked<RoomSessionManager>;
  }

  function buildHarness(room: Room = makeRoom('band_member')): Harness {
    const session: NamespaceSession = {
      socketId: SOCKET_ID,
      userId: 'user-a',
      username: 'Alice',
      roomId: ROOM_ID,
      namespacePath: `/room/${ROOM_ID}`,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    const roomLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn().mockResolvedValue(room),
      getMetronomeState: jest.fn().mockResolvedValue({ bpm: 120, beatZeroAt: STORED_BEAT_ZERO_AT }),
    });
    const metronomeService = createPartialMock<MetronomeService>({
      handleBpmChange: jest.fn().mockResolvedValue(undefined),
      getRoomMetronome: jest.fn().mockReturnValue(undefined),
      ensureRoomMetronome: jest.fn(),
    });
    const roomSessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn().mockReturnValue(session),
    });

    const socket = createPartialMock<Socket>({ id: SOCKET_ID, emit: jest.fn() });
    const namespace = createPartialMock<Namespace>({
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
    });

    const handler = new MetronomeHandler(roomLifecycleService, metronomeService, roomSessionManager);

    return { handler, socket, namespace, roomLifecycleService, metronomeService, roomSessionManager };
  }

  describe('handleUpdateMetronomeNamespace — role gate and BPM delegation', () => {
    it('rejects an audience member before touching MetronomeService (silent no-op)', async () => {
      const h = buildHarness(makeRoom('audience'));

      await h.handler.handleUpdateMetronomeNamespace(h.socket, { bpm: 140 }, h.namespace);

      expect(h.metronomeService.handleBpmChange).not.toHaveBeenCalled();
      expect(h.socket.emit).not.toHaveBeenCalled();
      expect(loggingService.logError).not.toHaveBeenCalled();
    });

    it.each(['band_member', 'room_owner'] as const)(
      'delegates the BPM change to MetronomeService with the payload value for a $role',
      async (role) => {
        const h = buildHarness(makeRoom(role));

        await h.handler.handleUpdateMetronomeNamespace(h.socket, { bpm: 140 }, h.namespace);

        expect(h.metronomeService.handleBpmChange).toHaveBeenCalledTimes(1);
        expect(h.metronomeService.handleBpmChange).toHaveBeenCalledWith(ROOM_ID, 140, h.namespace);
      },
    );

    it('logs a MetronomeService failure instead of rethrowing — the socket survives', async () => {
      const h = buildHarness();
      const boom = new Error('redis down');
      h.metronomeService.handleBpmChange.mockRejectedValue(boom);

      await expect(
        h.handler.handleUpdateMetronomeNamespace(h.socket, { bpm: 140 }, h.namespace),
      ).resolves.toBeUndefined();

      expect(jest.mocked(loggingService.logError)).toHaveBeenCalledWith(boom, {
        context: 'MetronomeHandler: handleBpmChange failed (namespace)',
        roomId: ROOM_ID,
      });
      // No error frame is emitted to the socket
      expect(h.socket.emit).not.toHaveBeenCalled();
    });

    it('no session → silent no-op', async () => {
      const h = buildHarness();
      h.roomSessionManager.getRoomSession.mockReturnValue(undefined);

      await h.handler.handleUpdateMetronomeNamespace(h.socket, { bpm: 140 }, h.namespace);

      expect(h.roomLifecycleService.getRoom).not.toHaveBeenCalled();
      expect(h.metronomeService.handleBpmChange).not.toHaveBeenCalled();
    });

    it('room not found → silent no-op', async () => {
      const h = buildHarness();
      h.roomLifecycleService.getRoom.mockResolvedValue(undefined);

      await h.handler.handleUpdateMetronomeNamespace(h.socket, { bpm: 140 }, h.namespace);

      expect(h.metronomeService.handleBpmChange).not.toHaveBeenCalled();
    });

    it('user in neither bandMembers nor audiences → silent no-op', async () => {
      const h = buildHarness(makeRoom('absent'));

      await h.handler.handleUpdateMetronomeNamespace(h.socket, { bpm: 140 }, h.namespace);

      expect(h.metronomeService.handleBpmChange).not.toHaveBeenCalled();
    });
  });

  describe('handleRequestMetronomeStateNamespace — answers from the stored beat grid', () => {
    it('answers with the grid stored in room state', async () => {
      const h = buildHarness();

      await h.handler.handleRequestMetronomeStateNamespace(h.socket, h.namespace);

      expect(h.socket.emit).toHaveBeenCalledWith(METRONOME_EVENTS.METRONOME_ANCHOR, {
        bpm: 120,
        beatZeroAt: STORED_BEAT_ZERO_AT,
      });
    });

    it('still answers when no in-memory RoomMetronome exists — a restarted server keeps the grid', async () => {
      const h = buildHarness(); // getRoomMetronome → undefined by default

      await h.handler.handleRequestMetronomeStateNamespace(h.socket, h.namespace);

      expect(h.socket.emit).toHaveBeenCalledWith(METRONOME_EVENTS.METRONOME_ANCHOR, {
        bpm: 120,
        beatZeroAt: STORED_BEAT_ZERO_AT,
      });
    });

    it('revives the room tick loop, so a room that outlived a restart drives its companions again', async () => {
      const h = buildHarness();

      await h.handler.handleRequestMetronomeStateNamespace(h.socket, h.namespace);

      expect(h.metronomeService.ensureRoomMetronome).toHaveBeenCalledWith(ROOM_ID, h.namespace);
    });

    it('no metronome state → nothing emitted', async () => {
      const h = buildHarness();
      h.roomLifecycleService.getMetronomeState.mockResolvedValue(null);

      await h.handler.handleRequestMetronomeStateNamespace(h.socket, h.namespace);

      expect(h.socket.emit).not.toHaveBeenCalled();
    });

    it('no session → nothing emitted', async () => {
      const h = buildHarness();
      h.roomSessionManager.getRoomSession.mockReturnValue(undefined);

      await h.handler.handleRequestMetronomeStateNamespace(h.socket, h.namespace);

      expect(h.roomLifecycleService.getMetronomeState).not.toHaveBeenCalled();
      expect(h.socket.emit).not.toHaveBeenCalled();
    });
  });
});

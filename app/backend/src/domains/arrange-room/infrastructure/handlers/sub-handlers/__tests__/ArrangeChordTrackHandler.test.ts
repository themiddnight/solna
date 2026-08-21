import type { Namespace, Socket } from 'socket.io';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import type { ChordBlock, ElementOccupancy } from '@jam-band/shared';
import { ArrangeChordTrackHandler } from '../ArrangeChordTrackHandler';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { ArrangeRoomStateService } from '@/domains/arrange-room/application/ArrangeRoomStateService';
import type { RoomOccupancyService } from '@/domains/room-shared/application/RoomOccupancyService';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const VERIFIED_USER_ID = 'user-verified-1';
const VERIFIED_USERNAME = 'verified-tester';
const OTHER_USER_ID = 'user-other-2';
const OTHER_USERNAME = 'other-tester';

/** Matches `BaseRoomHandler.getSession`'s minimal resolved session shape. */
interface MinimalSession {
  roomId: string;
  userId: string;
  username: string;
}

function createSession(): MinimalSession {
  return {
    roomId: ROOM_ID,
    userId: VERIFIED_USER_ID,
    username: VERIFIED_USERNAME,
  };
}

function diatonicBlock(overrides: Partial<ChordBlock> = {}): ChordBlock {
  return {
    id: 'block-1',
    start: 0,
    duration: 4,
    chord: { kind: 'diatonic', degree: 1 },
    color: '#3b82f6',
    ...overrides,
  };
}

/** Occupancy entry with a single holder — that holder is `holders[0]`, the owner. */
function ownerOccupancy(userId: string, username: string): ElementOccupancy {
  return { kind: 'container', holders: [{ userId, username, joinedAt: Date.now() }] };
}

describe('ArrangeChordTrackHandler (DEV-279 P1, Task 1.6)', () => {
  let handler: ArrangeChordTrackHandler;
  let stateService: jest.Mocked<ArrangeRoomStateService>;
  let occupancyService: jest.Mocked<RoomOccupancyService>;
  let arrangeHandler: jest.Mocked<ArrangeRoomHandler>;
  let socket: jest.Mocked<Socket>;
  let socketEmit: jest.Mock;
  let socketToEmit: jest.Mock;
  let socketTo: jest.Mock;
  let namespace: Namespace;
  let namespaceEmit: jest.Mock<void, [event: string, payload: unknown]>;
  let namespaceTo: jest.Mock;
  let scheduleEphemeralCommitPublic: jest.Mock;
  let clearEphemeralCommitPublic: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    stateService = createPartialMock<ArrangeRoomStateService>({
      addChordBlock: jest.fn().mockResolvedValue(undefined),
      updateChordBlock: jest.fn().mockResolvedValue(undefined),
      removeChordBlock: jest.fn().mockResolvedValue(undefined),
    });

    // DEV-350 M2 (Task 13): the CRUD guard reads the block's occupancy entry
    // (`holders[0]` is the owner with edit rights) instead of `state.locks`.
    occupancyService = createPartialMock<RoomOccupancyService>({
      getOccupancy: jest.fn().mockResolvedValue(null),
    });

    scheduleEphemeralCommitPublic = jest.fn();
    clearEphemeralCommitPublic = jest.fn();

    arrangeHandler = createPartialMock<ArrangeRoomHandler>({
      getSessionPublic: jest.fn().mockResolvedValue(createSession()),
      getStateService: jest.fn().mockReturnValue(stateService),
      getOccupancyService: jest.fn().mockReturnValue(occupancyService),
      scheduleEphemeralCommitPublic,
      clearEphemeralCommitPublic,
    });
    handler = new ArrangeChordTrackHandler(arrangeHandler);

    socketEmit = jest.fn();
    socketToEmit = jest.fn();
    socketTo = jest.fn().mockReturnValue({ emit: socketToEmit });
    socket = createPartialMock<Socket>({
      id: 'socket-1',
      emit: socketEmit,
      to: socketTo,
    });

    namespaceEmit = jest.fn<void, [event: string, payload: unknown]>();
    namespaceTo = jest.fn().mockReturnValue({ emit: namespaceEmit });
    namespace = createPartialMock<Namespace>({
      name: `/room/${ROOM_ID}`,
      to: namespaceTo,
    });
  });

  // ── add ──────────────────────────────────────────────────────────────────

  describe('handleChordBlockAdd', () => {
    it('persists the block and broadcasts CHORD_BLOCK_ADDED via namespace.to (incl. sender)', async () => {
      const block = diatonicBlock();

      await handler.handleChordBlockAdd(socket, namespace, { roomId: ROOM_ID, block });

      expect(stateService.addChordBlock).toHaveBeenCalledWith(ROOM_ID, block);
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.CHORD_BLOCK_ADDED, {
        block,
        userId: VERIFIED_USER_ID,
      });
      expect(socketTo).not.toHaveBeenCalled();
    });

    it('attributes the broadcast to the session identity (TR-33), never a client-supplied id', async () => {
      await handler.handleChordBlockAdd(socket, namespace, { roomId: ROOM_ID, block: diatonicBlock() });

      expect(namespaceEmit).toHaveBeenCalledWith(
        ARRANGE_EVENTS.CHORD_BLOCK_ADDED,
        expect.objectContaining({ userId: VERIFIED_USER_ID }),
      );
    });

    it('ignores the event when the session does not match the room', async () => {
      arrangeHandler.getSessionPublic.mockResolvedValue({ ...createSession(), roomId: 'some-other-room' });

      await handler.handleChordBlockAdd(socket, namespace, { roomId: ROOM_ID, block: diatonicBlock() });

      expect(stateService.addChordBlock).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('handleChordBlockRemove', () => {
    it('removes the block and broadcasts CHORD_BLOCK_REMOVED via namespace.to when unlocked', async () => {
      await handler.handleChordBlockRemove(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1' });

      expect(stateService.removeChordBlock).toHaveBeenCalledWith(ROOM_ID, 'block-1');
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.CHORD_BLOCK_REMOVED, {
        blockId: 'block-1',
        userId: VERIFIED_USER_ID,
      });
    });

    it('rejects removal when the block is occupied (owned) by another user', async () => {
      occupancyService.getOccupancy.mockResolvedValue(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));

      await handler.handleChordBlockRemove(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1' });

      expect(stateService.removeChordBlock).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: 'block-1',
        lockedBy: OTHER_USERNAME,
      });
    });

    it('allows removal when the occupancy owner is the requesting user themselves', async () => {
      occupancyService.getOccupancy.mockResolvedValue(ownerOccupancy(VERIFIED_USER_ID, VERIFIED_USERNAME));

      await handler.handleChordBlockRemove(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1' });

      expect(stateService.removeChordBlock).toHaveBeenCalledWith(ROOM_ID, 'block-1');
    });
  });

  // ── drag (ephemeral) / drag commit ──────────────────────────────────────

  describe('handleChordBlockDrag (ephemeral)', () => {
    it('broadcasts CHORD_BLOCK_DRAGGED via socket.to (excludes sender) with NO Redis write', async () => {
      await handler.handleChordBlockDrag(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: 4 });

      expect(socketTo).toHaveBeenCalledWith(ROOM_ID);
      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.CHORD_BLOCK_DRAGGED, {
        blockId: 'block-1',
        newStart: 4,
        userId: VERIFIED_USER_ID,
      });
      expect(namespaceTo).not.toHaveBeenCalled();
      // Ephemeral: no synchronous Redis write for the drag event itself.
      expect(stateService.updateChordBlock).not.toHaveBeenCalled();
      expect(stateService.addChordBlock).not.toHaveBeenCalled();
      expect(stateService.removeChordBlock).not.toHaveBeenCalled();
    });

    it('schedules a TR-10 auto-commit fallback keyed by the block id', async () => {
      await handler.handleChordBlockDrag(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: 4 });

      expect(scheduleEphemeralCommitPublic).toHaveBeenCalledWith(
        ROOM_ID,
        VERIFIED_USER_ID,
        'chordBlockDrag:block-1',
        { newStart: 4 },
        expect.any(Function),
      );
    });

    it('rejects the drag up front when the block is occupied (owned) by another user — no broadcast, no state write, no scheduled auto-commit', async () => {
      // Block is owned by the FIRST user (VERIFIED_USER_ID, the default session).
      occupancyService.getOccupancy.mockResolvedValue(ownerOccupancy(VERIFIED_USER_ID, VERIFIED_USERNAME));
      // A SECOND acting identity attempts the drag.
      arrangeHandler.getSessionPublic.mockResolvedValue({
        roomId: ROOM_ID,
        userId: OTHER_USER_ID,
        username: OTHER_USERNAME,
      });

      await handler.handleChordBlockDrag(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: 4 });

      // No phantom ephemeral broadcast.
      expect(socketToEmit).not.toHaveBeenCalled();
      // No synchronous Redis write.
      expect(stateService.updateChordBlock).not.toHaveBeenCalled();
      // No auto-commit fallback scheduled at all — so it can never persist an unauthorized move.
      expect(scheduleEphemeralCommitPublic).not.toHaveBeenCalled();
      // Rejected like every other chord-block handler.
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: 'block-1',
        lockedBy: VERIFIED_USERNAME,
      });
    });

    it('still allows the occupancy owner themselves to drag the block they hold', async () => {
      occupancyService.getOccupancy.mockResolvedValue(ownerOccupancy(VERIFIED_USER_ID, VERIFIED_USERNAME));

      await handler.handleChordBlockDrag(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: 4 });

      expect(socketToEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.CHORD_BLOCK_DRAGGED, {
        blockId: 'block-1',
        newStart: 4,
        userId: VERIFIED_USER_ID,
      });
      expect(scheduleEphemeralCommitPublic).toHaveBeenCalled();
    });
  });

  describe('handleChordBlockDragCommit', () => {
    it('persists the new start, clears the auto-commit timeout, and broadcasts via namespace.to', async () => {
      await handler.handleChordBlockDragCommit(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: 8 });

      expect(stateService.updateChordBlock).toHaveBeenCalledWith(ROOM_ID, 'block-1', { start: 8 });
      expect(clearEphemeralCommitPublic).toHaveBeenCalledWith(ROOM_ID, VERIFIED_USER_ID, 'chordBlockDrag:block-1');
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.CHORD_BLOCK_DRAG_COMMITTED, {
        blockId: 'block-1',
        newStart: 8,
        userId: VERIFIED_USER_ID,
      });
    });

    it('clamps a negative newStart to 0', async () => {
      await handler.handleChordBlockDragCommit(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: -5 });

      expect(stateService.updateChordBlock).toHaveBeenCalledWith(ROOM_ID, 'block-1', { start: 0 });
    });

    it('rejects the commit when the block is occupied (owned) by another user', async () => {
      occupancyService.getOccupancy.mockResolvedValue(ownerOccupancy(OTHER_USER_ID, OTHER_USERNAME));

      await handler.handleChordBlockDragCommit(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: 8 });

      expect(stateService.updateChordBlock).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: 'block-1',
        lockedBy: OTHER_USERNAME,
      });
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('handleChordBlockUpdate', () => {
    it('persists the update and broadcasts CHORD_BLOCK_UPDATED via namespace.to when unlocked', async () => {
      const updates = { chord: { kind: 'borrowed' as const, semitones: 3, quality: 'min' as const } };

      await handler.handleChordBlockUpdate(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', updates });

      expect(stateService.updateChordBlock).toHaveBeenCalledWith(ROOM_ID, 'block-1', updates);
      expect(namespaceEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.CHORD_BLOCK_UPDATED, {
        blockId: 'block-1',
        updates,
        userId: VERIFIED_USER_ID,
      });
    });

    it('a second user editing a block occupied (owned) by the first user is rejected', async () => {
      occupancyService.getOccupancy.mockResolvedValue(ownerOccupancy(VERIFIED_USER_ID, VERIFIED_USERNAME));
      // Second user's session — different acting identity.
      arrangeHandler.getSessionPublic.mockResolvedValue({
        roomId: ROOM_ID,
        userId: OTHER_USER_ID,
        username: OTHER_USERNAME,
      });

      await handler.handleChordBlockUpdate(socket, namespace, {
        roomId: ROOM_ID,
        blockId: 'block-1',
        updates: { color: '#ff0000' },
      });

      expect(stateService.updateChordBlock).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: 'block-1',
        lockedBy: VERIFIED_USERNAME,
      });
    });
  });

  // ── container-ownership guard (DEV-350 M2, Task 13) ─────────────────────
  // No dedicated CHORD_BLOCK_LOCK_ACQUIRE/RELEASE handlers exist anymore — chord-block
  // selection now joins/leaves the block's occupancy queue via the generic
  // OCCUPANCY_EVENTS.JOIN/LEAVE (handled by ArrangeLockHandler, out of this file's scope).
  // These tests cover `getOwnerConflict`'s own semantics beyond the single-holder cases
  // already exercised per-CRUD-method above.

  describe('container-ownership guard', () => {
    it('a non-owner holder further back in the occupancy queue (holders[1]) is still rejected — only holders[0] may edit', async () => {
      occupancyService.getOccupancy.mockResolvedValue({
        kind: 'container',
        holders: [
          { userId: OTHER_USER_ID, username: OTHER_USERNAME, joinedAt: 1 },
          { userId: VERIFIED_USER_ID, username: VERIFIED_USERNAME, joinedAt: 2 },
        ],
      });

      await handler.handleChordBlockRemove(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1' });

      expect(stateService.removeChordBlock).not.toHaveBeenCalled();
      expect(socketEmit).toHaveBeenCalledWith(ARRANGE_EVENTS.LOCK_CONFLICT, {
        elementId: 'block-1',
        lockedBy: OTHER_USERNAME,
      });
    });

    it('an occupancy entry with no holders (nobody queued) behaves as unlocked', async () => {
      occupancyService.getOccupancy.mockResolvedValue({ kind: 'container', holders: [] });

      await handler.handleChordBlockRemove(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1' });

      expect(stateService.removeChordBlock).toHaveBeenCalledWith(ROOM_ID, 'block-1');
    });

    it('no occupancy entry at all (never joined) behaves as unlocked', async () => {
      occupancyService.getOccupancy.mockResolvedValue(null);

      await handler.handleChordBlockUpdate(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', updates: { color: '#00ff00' } });

      expect(stateService.updateChordBlock).toHaveBeenCalledWith(ROOM_ID, 'block-1', { color: '#00ff00' });
    });

    it('queries occupancy scoped by roomId + blockId', async () => {
      occupancyService.getOccupancy.mockResolvedValue(null);

      await handler.handleChordBlockDragCommit(socket, namespace, { roomId: ROOM_ID, blockId: 'block-1', newStart: 8 });

      expect(occupancyService.getOccupancy).toHaveBeenCalledWith(ROOM_ID, 'block-1');
    });
  });
});

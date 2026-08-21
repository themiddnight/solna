import type { Namespace, Socket } from 'socket.io';
import { OCCUPANCY_EVENTS } from '@jam-band/shared';
import {
  handleOccupancyJoin,
  handleOccupancyLeave,
  handleOccupancyHeartbeat,
  releaseAllOccupancyForUser,
  type OccupancySessionLookup,
} from '../occupancySocketHandlers';
import type { RoomOccupancyService } from '../RoomOccupancyService';
import { createPartialMock } from '@/testing/mocks';

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const USER_ID = 'user-verified-1';
const USERNAME = 'verified-tester';

function createSession() {
  return { roomId: ROOM_ID, userId: USER_ID, username: USERNAME };
}

describe('occupancySocketHandlers (room-agnostic, DEV-350 M2)', () => {
  let occupancyService: jest.Mocked<RoomOccupancyService>;
  let getSession: jest.MockedFunction<OccupancySessionLookup>;
  let socket: jest.Mocked<Socket>;
  let socketEmit: jest.Mock;
  let namespace: Namespace;
  let namespaceEmit: jest.Mock<void, [event: string, payload: unknown]>;
  let namespaceTo: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    occupancyService = createPartialMock<RoomOccupancyService>({
      join: jest.fn(),
      leave: jest.fn(),
      heartbeat: jest.fn(),
      releaseAllForUser: jest.fn(),
    });

    getSession = jest.fn().mockResolvedValue(createSession());

    socketEmit = jest.fn();
    socket = createPartialMock<Socket>({ id: 'socket-1', emit: socketEmit });

    namespaceEmit = jest.fn<void, [event: string, payload: unknown]>();
    namespaceTo = jest.fn().mockReturnValue({ emit: namespaceEmit });
    namespace = createPartialMock<Namespace>({ name: `/room/${ROOM_ID}`, to: namespaceTo });
  });

  // ── join ─────────────────────────────────────────────────────────────────

  describe('handleOccupancyJoin', () => {
    it('broadcasts JOINED with the updated holders on success', async () => {
      occupancyService.join.mockResolvedValue({ accepted: true, holders: [{ userId: 'u1', username: 'Alice', joinedAt: 1 }] });

      await handleOccupancyJoin(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.join).toHaveBeenCalledWith(ROOM_ID, 'track:t1:volume', expect.objectContaining({ userId: USER_ID, username: USERNAME }));
      expect(namespaceTo).toHaveBeenCalledWith(ROOM_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.JOINED, {
        elementId: 'track:t1:volume',
        holders: [{ userId: 'u1', username: 'Alice', joinedAt: 1 }],
      });
      expect(socketEmit).not.toHaveBeenCalled();
    });

    it('unicasts JOIN_DENIED with heldBy when rejected', async () => {
      occupancyService.join.mockResolvedValue({ accepted: false, holders: [{ userId: 'other', username: 'Bob', joinedAt: 1 }] });

      await handleOccupancyJoin(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(socketEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.JOIN_DENIED, {
        elementId: 'track:t1:volume',
        heldBy: { userId: 'other', username: 'Bob', joinedAt: 1 },
      });
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('does nothing when there is no valid session', async () => {
      getSession.mockResolvedValue(null);

      await handleOccupancyJoin(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.join).not.toHaveBeenCalled();
      expect(socketEmit).not.toHaveBeenCalled();
      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('does nothing when the session room does not match the requested room (TR-33)', async () => {
      getSession.mockResolvedValue({ ...createSession(), roomId: 'some-other-room' });

      await handleOccupancyJoin(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.join).not.toHaveBeenCalled();
    });

    it('stamps the holder from the verified session, never from client data (TR-33)', async () => {
      occupancyService.join.mockResolvedValue({ accepted: true, holders: [] });

      await handleOccupancyJoin(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      const [, , holder] = occupancyService.join.mock.calls[0] ?? [];
      expect(holder).toMatchObject({ userId: USER_ID, username: USERNAME });
      expect(typeof holder?.joinedAt).toBe('number');
    });
  });

  // ── leave ────────────────────────────────────────────────────────────────

  describe('handleOccupancyLeave', () => {
    it('broadcasts LEFT with the post-removal holders', async () => {
      occupancyService.leave.mockResolvedValue({ holders: [] });

      await handleOccupancyLeave(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.leave).toHaveBeenCalledWith(ROOM_ID, 'track:t1:volume', USER_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, { elementId: 'track:t1:volume', holders: [] });
    });

    it('does not broadcast when the service reports nothing to release', async () => {
      occupancyService.leave.mockResolvedValue(null);

      await handleOccupancyLeave(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(namespaceEmit).not.toHaveBeenCalled();
    });

    it('does nothing when there is no valid session', async () => {
      getSession.mockResolvedValue(null);

      await handleOccupancyLeave(occupancyService, getSession, socket, namespace, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.leave).not.toHaveBeenCalled();
    });
  });

  // ── heartbeat ────────────────────────────────────────────────────────────

  describe('handleOccupancyHeartbeat', () => {
    it('calls the service with the verified session identity', async () => {
      await handleOccupancyHeartbeat(occupancyService, getSession, socket, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.heartbeat).toHaveBeenCalledWith(ROOM_ID, 'track:t1:volume', USER_ID);
      // Heartbeat broadcasts nothing by design — which is why it takes no `Namespace` at all.
      expect(namespaceTo).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('does nothing when there is no valid session', async () => {
      getSession.mockResolvedValue(null);

      await handleOccupancyHeartbeat(occupancyService, getSession, socket, { roomId: ROOM_ID, elementId: 'track:t1:volume' });

      expect(occupancyService.heartbeat).not.toHaveBeenCalled();
    });
  });

  // ── release-all-for-user (disconnect cleanup) ───────────────────────────

  describe('releaseAllOccupancyForUser', () => {
    it('broadcasts LEFT for every element the user held', async () => {
      occupancyService.releaseAllForUser.mockResolvedValue([
        { elementId: 'track:t1:volume', holders: [] },
        { elementId: 'region-1', holders: [{ userId: 'u2', username: 'Bob', joinedAt: 2 }] },
      ]);

      await releaseAllOccupancyForUser(occupancyService, ROOM_ID, USER_ID, namespace);

      expect(occupancyService.releaseAllForUser).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, { elementId: 'track:t1:volume', holders: [] });
      expect(namespaceEmit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, {
        elementId: 'region-1',
        holders: [{ userId: 'u2', username: 'Bob', joinedAt: 2 }],
      });
    });

    it('broadcasts nothing when the user held no occupancy', async () => {
      occupancyService.releaseAllForUser.mockResolvedValue([]);

      await releaseAllOccupancyForUser(occupancyService, ROOM_ID, USER_ID, namespace);

      expect(namespaceEmit).not.toHaveBeenCalled();
    });
  });
});

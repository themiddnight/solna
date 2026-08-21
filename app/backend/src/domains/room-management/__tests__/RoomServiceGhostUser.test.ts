/**
 * Unit Tests for RoomService Ghost User Cleanup
 */
import { RoomLifecycleService as RoomService } from '../application/RoomLifecycleService';
import type { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import type { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import type { RoomCleanupService } from '../domain/services/RoomCleanupService';
import type { RoomUserService } from '../domain/services/RoomUserService';
import type { RoomSettingsService } from '../infrastructure/services/RoomSettingsService';
import type { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import type { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import type { ArrangeRoomStateService } from '../../arrange-room/application/ArrangeRoomStateService';
import type { Room, Audience, BandMember } from '../../../types';
import { RoomType } from '../../../types';
import { createPartialMock } from '@/testing/mocks';

describe('RoomService - Ghost User Cleanup', () => {
  let roomService: RoomService;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockRoomRepository: jest.Mocked<RoomRepository>;
  let mockRoomCleanupService: jest.Mocked<RoomCleanupService>;
  let mockRoomUserService: jest.Mocked<RoomUserService>;
  let mockRoomSettingsService: jest.Mocked<RoomSettingsService>;
  let mockEffectChainService: jest.Mocked<EffectChainService>;
  let mockNamespaceGracePeriodManager: jest.Mocked<NamespaceGracePeriodManager>;
  let mockArrangeRoomStateService: jest.Mocked<ArrangeRoomStateService>;

  beforeEach(() => {
    mockRoomSessionManager = createPartialMock<RoomSessionManager>({
      // Cross-process-safe method used by cleanupGhostUsers and removeUserIfGhost
      isUserActiveInRoom: jest.fn(),
    });

    mockRoomRepository = createPartialMock<RoomRepository>({
      getAllRooms: jest.fn(),
    });

    mockRoomCleanupService = createPartialMock<RoomCleanupService>({
      cleanupExpiredGraceTime: jest.fn(),
    });

    mockRoomUserService = createPartialMock<RoomUserService>({
      removeUserFromRoom: jest.fn(),
    });

    mockRoomSettingsService = createPartialMock<RoomSettingsService>({});
    mockEffectChainService = createPartialMock<EffectChainService>({});
    mockNamespaceGracePeriodManager = createPartialMock<NamespaceGracePeriodManager>({
      isUserInGracePeriod: jest.fn().mockReturnValue(false),
    });
    mockArrangeRoomStateService = createPartialMock<ArrangeRoomStateService>({});

    roomService = new RoomService(
      mockRoomRepository,
      mockRoomCleanupService,
      mockRoomSessionManager,
      mockNamespaceGracePeriodManager,
      mockArrangeRoomStateService,
      mockEffectChainService,
      mockRoomUserService,
      mockRoomSettingsService
    );
  });

  it('should identify and remove ghost users when no active session (isUserActiveInRoom=false)', async () => {
    const userId = 'user-1';
    const roomId = 'room-1';
    const user: Audience = { id: userId, username: 'ghost', role: 'audience', joinedAt: new Date() };

    const room: Room = {
      id: roomId,
      name: 'Test Room',
      owner: 'owner-1',
      bandMembers: new Map(),
      audiences: new Map([[userId, user]]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      roomType: RoomType.PERFORM,
      metronome: { bpm: 120, beatZeroAt: Date.now() }
    };

void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

    await roomService.cleanupGhostUsers();

    expect(mockRoomSessionManager.isUserActiveInRoom).toHaveBeenCalledWith(roomId, userId);
    expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith(roomId, userId, true);
  });

  it('should identify and remove ghost users when session is stale (isUserActiveInRoom=false)', async () => {
    const userId = 'user-1';
    const roomId = 'room-1';
    const user: Audience = { id: userId, username: 'stale-ghost', role: 'audience', joinedAt: new Date() };

    const room: Room = {
      id: roomId,
      name: 'Test Room',
      owner: 'owner-1',
      bandMembers: new Map(),
      audiences: new Map([[userId, user]]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      roomType: RoomType.PERFORM,
      metronome: { bpm: 120, beatZeroAt: Date.now() }
    };

void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
    // Returns false — stale session (e.g., disconnected on a different process)
void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

    await roomService.cleanupGhostUsers();

    expect(mockRoomSessionManager.isUserActiveInRoom).toHaveBeenCalledWith(roomId, userId);
    expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith(roomId, userId, true);
  });

  it('should NOT remove users with active, valid sessions', async () => {
    const userId = 'user-1';
    const roomId = 'room-1';
    const user: Audience = { id: userId, username: 'active', role: 'audience', joinedAt: new Date() };

    const room: Room = {
      id: roomId,
      name: 'Test Room',
      owner: 'owner-1',
      bandMembers: new Map(),
      audiences: new Map([[userId, user]]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      roomType: RoomType.PERFORM,
      metronome: { bpm: 120, beatZeroAt: Date.now() }
    };

void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(true);

    await roomService.cleanupGhostUsers();

    expect(mockRoomSessionManager.isUserActiveInRoom).toHaveBeenCalledWith(roomId, userId);
    expect(mockRoomUserService.removeUserFromRoom).not.toHaveBeenCalled();
  });

  it('should remove room owner if no active socket (room is old enough)', async () => {
    const ownerId = 'owner-1';
    const roomId = 'room-1';
    const owner: BandMember = { id: ownerId, username: 'owner', role: 'room_owner', isReady: false };

    const room: Room = {
      id: roomId,
      name: 'Old Room',
      owner: ownerId,
      bandMembers: new Map([[ownerId, owner]]),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      roomType: RoomType.ARRANGE,
      metronome: { bpm: 120, beatZeroAt: Date.now() }
    };

void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

    await roomService.cleanupGhostUsers();

    expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith(roomId, ownerId, true);
  });

  it('should NOT remove room owner if they have an active socket', async () => {
    const ownerId = 'owner-1';
    const roomId = 'room-1';
    const owner: BandMember = { id: ownerId, username: 'owner', role: 'room_owner', isReady: false };

    const room: Room = {
      id: roomId,
      name: 'Old Room',
      owner: ownerId,
      bandMembers: new Map([[ownerId, owner]]),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      roomType: RoomType.ARRANGE,
      metronome: { bpm: 120, beatZeroAt: Date.now() }
    };

void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(true);

    await roomService.cleanupGhostUsers();

    expect(mockRoomUserService.removeUserFromRoom).not.toHaveBeenCalled();
  });

  it('should remove both owner and non-owner in old rooms if both have no socket', async () => {
    const ownerId = 'owner-1';
    const userId = 'user-2';
    const roomId = 'room-1';

    const owner: BandMember = { id: ownerId, username: 'owner', role: 'room_owner', isReady: false };
    const user: BandMember = { id: userId, username: 'user', role: 'band_member', isReady: false };

    const room: Room = {
      id: roomId,
      name: 'Old Room',
      owner: ownerId,
      bandMembers: new Map([[ownerId, owner], [userId, user]]),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000),
      roomType: RoomType.ARRANGE,
      metronome: { bpm: 120, beatZeroAt: Date.now() }
    };

void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

    await roomService.cleanupGhostUsers();

    expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith(roomId, ownerId, true);
    expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith(roomId, userId, true);
  });

  describe('DEV-258 zero-socket sanity fuse', () => {
    const buildOccupiedRoom = (roomId: string, userId: string): Room => {
      const user: Audience = { id: userId, username: 'maybe-ghost', role: 'audience', joinedAt: new Date() };
      return {
        id: roomId,
        name: 'Occupied Room',
        owner: 'owner-1',
        bandMembers: new Map(),
        audiences: new Map([[userId, user]]),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(Date.now() - 60_000),
        roomType: RoomType.PERFORM,
        metronome: { bpm: 120, beatZeroAt: Date.now() },
      };
    };

    it('skips the whole ghost pass when this process has zero connected sockets but rooms show occupants', async () => {
      void mockRoomRepository.getAllRooms.mockResolvedValue([buildOccupiedRoom('room-1', 'user-1')]);
      void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);
      roomService.setLocalSocketCounter(() => 0);

      await roomService.cleanupGhostUsers();

      // Nobody must be judged, let alone removed — a zero-socket process cannot see presence.
      expect(mockRoomSessionManager.isUserActiveInRoom).not.toHaveBeenCalled();
      expect(mockRoomUserService.removeUserFromRoom).not.toHaveBeenCalled();
    });

    it('runs normally when this process has at least one connected socket', async () => {
      void mockRoomRepository.getAllRooms.mockResolvedValue([buildOccupiedRoom('room-1', 'user-1')]);
      void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);
      roomService.setLocalSocketCounter(() => 1);

      await roomService.cleanupGhostUsers();

      expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith('room-1', 'user-1', true);
    });

    it('is a no-op fuse when rooms are empty (nothing at stake, no warning path)', async () => {
      const emptyRoom = buildOccupiedRoom('room-1', 'user-1');
      emptyRoom.audiences = new Map();
      void mockRoomRepository.getAllRooms.mockResolvedValue([emptyRoom]);
      roomService.setLocalSocketCounter(() => 0);

      await roomService.cleanupGhostUsers();

      expect(mockRoomSessionManager.isUserActiveInRoom).not.toHaveBeenCalled();
      expect(mockRoomUserService.removeUserFromRoom).not.toHaveBeenCalled();
    });

    it('keeps legacy behavior when no socket counter is wired', async () => {
      void mockRoomRepository.getAllRooms.mockResolvedValue([buildOccupiedRoom('room-1', 'user-1')]);
      void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

      await roomService.cleanupGhostUsers();

      expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith('room-1', 'user-1', true);
    });
  });

  describe('DEV-258 hasAnyRoomOccupants', () => {
    it('reports true when any room has a band member or audience', async () => {
      const owner: BandMember = { id: 'o1', username: 'owner', role: 'room_owner', isReady: false };
      const occupied: Room = {
        id: 'room-1', name: 'r', owner: 'o1',
        bandMembers: new Map([['o1', owner]]), audiences: new Map(), pendingMembers: new Map(),
        isPrivate: false, isHidden: false, isIsolated: false,
        createdAt: new Date(), roomType: RoomType.PERFORM,
        metronome: { bpm: 120, beatZeroAt: Date.now() },
      };
      void mockRoomRepository.getAllRooms.mockResolvedValue([occupied]);
      await expect(roomService.hasAnyRoomOccupants()).resolves.toBe(true);
    });

    it('reports false when all rooms are empty', async () => {
      const empty: Room = {
        id: 'room-1', name: 'r', owner: 'o1',
        bandMembers: new Map(), audiences: new Map(), pendingMembers: new Map(),
        isPrivate: false, isHidden: false, isIsolated: false,
        createdAt: new Date(), roomType: RoomType.PERFORM,
        metronome: { bpm: 120, beatZeroAt: Date.now() },
      };
      void mockRoomRepository.getAllRooms.mockResolvedValue([empty]);
      await expect(roomService.hasAnyRoomOccupants()).resolves.toBe(false);
    });
  });

  it('should NOT remove non-owner users in new rooms (< 30s)', async () => {
    const ownerId = 'owner-1';
    const userId = 'user-2';
    const roomId = 'room-1';

    const owner: BandMember = { id: ownerId, username: 'owner', role: 'room_owner', isReady: false };
    const user: BandMember = { id: userId, username: 'user', role: 'band_member', isReady: false };

    const room: Room = {
      id: roomId,
      name: 'New Room',
      owner: ownerId,
      bandMembers: new Map([[ownerId, owner], [userId, user]]),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 10_000), // ← ห้องอายุ 10 วินาที (< 30s)
      roomType: RoomType.ARRANGE,
      metronome: { bpm: 120, beatZeroAt: Date.now() }
    };

void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

    await roomService.cleanupGhostUsers();

    // ทั้ง owner และ user ไม่ถูกลบ (เพราะห้องยังใหม่)
    expect(mockRoomUserService.removeUserFromRoom).not.toHaveBeenCalled();
  });
});

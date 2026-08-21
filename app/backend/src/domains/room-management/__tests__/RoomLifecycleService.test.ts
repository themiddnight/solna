/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Unit Tests for RoomLifecycleService
 * Tests individual methods in isolation with mocked dependencies
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
import type { PerformRoomStateService } from '../../perform-room/application/PerformRoomStateService';
import type { PerformRoomState } from '../../perform-room/domain/models/PerformRoomState';
import type { CompanionConfig } from '@jam-band/shared';
import { DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { RoomType, type Room, type BandMember } from '../../../types';

// Mock Redis so getRoomByInviteCode O(1) path can be controlled in unit tests
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  RedisStateService: { getInstance: jest.fn() },
  redisStateService: {
    hget: jest.fn(),
    hdel: jest.fn(),
    hset: jest.fn(),
  },
}));

describe('RoomLifecycleService - Unit Tests', () => {
  let roomService: RoomService;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockRoomRepository: jest.Mocked<RoomRepository>;
  let mockRoomCleanupService: jest.Mocked<RoomCleanupService>;
  let mockRoomUserService: jest.Mocked<RoomUserService>;
  let mockRoomSettingsService: jest.Mocked<RoomSettingsService>;
  let mockEffectChainService: jest.Mocked<EffectChainService>;
  let mockNamespaceGracePeriodManager: jest.Mocked<NamespaceGracePeriodManager>;
  let mockArrangeRoomStateService: jest.Mocked<ArrangeRoomStateService>;
  let mockPerformRoomStateService: jest.Mocked<PerformRoomStateService>;

  beforeEach(() => {
    // Create mock RoomSessionManager
    mockRoomSessionManager = {
      setRoomSession: jest.fn(),
      getSession: jest.fn(),
      removeSession: jest.fn(),
      getRoomSessions: jest.fn(),
      setApprovalSession: jest.fn(),
      setLobbySession: jest.fn(),
      getApprovalSessions: jest.fn(),
      getRoomSession: jest.fn(),
      getApprovalSession: jest.fn(),
      getLobbySession: jest.fn(),
      cleanupRoomSessions: jest.fn(),
      getSessionStats: jest.fn(),
      findSocketByUserId: jest.fn(),
      isUserActiveInRoom: jest.fn(),
      removeOldSessionsForUser: jest.fn(),
    } as unknown as jest.Mocked<RoomSessionManager>;

    mockRoomRepository = {
      saveRoom: jest.fn(),
      invalidateListCaches: jest.fn(),
      getRoom: jest.fn(),
      getAllRooms: jest.fn(),
      cacheRoomList: jest.fn(),
      deleteRoom: jest.fn(),
    } as unknown as jest.Mocked<RoomRepository>;

    mockRoomCleanupService = {
      hasUserIntentionallyLeft: jest.fn(),
      clearRoomIntentionalLeaves: jest.fn(),
      removeFromIntentionallyLeft: jest.fn(),
      cleanupExpiredGraceTime: jest.fn(),
      cleanupExpiredIntentionalLeaves: jest.fn(),
      shouldCloseRoom: jest.fn(),
    } as unknown as jest.Mocked<RoomCleanupService>;

    mockRoomUserService = {
      findUserInRoom: jest.fn(),
      findUserInRoomByUsername: jest.fn(),
      addUserToRoom: jest.fn().mockImplementation(async (roomId: string, user: BandMember, effectChainsInitializer?: (u: BandMember) => void) => {
        // Call the effect chains initializer if provided
        if (effectChainsInitializer) {
          effectChainsInitializer(user);
        }
        return true;
      }),
      addPendingMember: jest.fn(),
      approveMember: jest.fn(),
      rejectMember: jest.fn(),
      removeUserFromRoom: jest.fn(),
      transferOwnership: jest.fn(),
      getAnyUserInRoom: jest.fn(),
      getOwnershipCandidate: jest.fn(),
      isRoomOwner: jest.fn(),
      getRoomUsers: jest.fn(),
      getPendingMembers: jest.fn(),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RoomUserService>;

    mockRoomSettingsService = {
      updateRoomSettings: jest.fn(),
      toggleBroadcast: jest.fn(),
      getBroadcastStatus: jest.fn(),
    } as unknown as jest.Mocked<RoomSettingsService>;

    mockEffectChainService = {
      getDefaultEffectChains: jest.fn().mockReturnValue({
        virtual_instrument: { type: 'virtual_instrument' as const, effects: [] },
        audio_voice_input: { type: 'audio_voice_input' as const, effects: [] }
      }),
      ensureUserEffectChains: jest.fn().mockImplementation((user: BandMember) => {
        if (!user.effectChains) {
          user.effectChains = {
            virtual_instrument: { type: 'virtual_instrument' as const, effects: [] },
            audio_voice_input: { type: 'audio_voice_input' as const, effects: [] }
          };
          return;
        }
         
        const chains = user.effectChains as Record<string, { type: string; effects: unknown[] } | undefined>;
        if (!chains.virtual_instrument) {
           
          chains.virtual_instrument = { type: 'virtual_instrument', effects: [] };
        }
        if (!chains.audio_voice_input) {
           
          chains.audio_voice_input = { type: 'audio_voice_input', effects: [] };
        }
      }),
      updateUserEffectChains: jest.fn(),
    } as unknown as jest.Mocked<EffectChainService>;

    mockNamespaceGracePeriodManager = {
      getRoomGracePeriodUsers: jest.fn().mockReturnValue([]),
      cleanupRoomGracePeriod: jest.fn(),
      getGracePeriodMs: jest.fn().mockReturnValue(30000),
      isUserInGracePeriod: jest.fn().mockReturnValue(false),
      removeFromGracePeriod: jest.fn(),
      getGracePeriodEntry: jest.fn(),
    } as unknown as jest.Mocked<NamespaceGracePeriodManager>;

    mockArrangeRoomStateService = {
      getState: jest.fn(),
      initializeState: jest.fn(),
      updateState: jest.fn(),
      deleteState: jest.fn().mockResolvedValue(undefined),
      loadState: jest.fn().mockResolvedValue(null),
      saveState: jest.fn().mockResolvedValue(undefined),
      clearState: jest.fn(),
    } as unknown as jest.Mocked<ArrangeRoomStateService>;

    // Default: no perform state (no companions). Tests override getState per-case.
    mockPerformRoomStateService = {
      getState: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PerformRoomStateService>;

    // Initialize service with mocks
    roomService = new RoomService(
      mockRoomRepository,
      mockRoomCleanupService,
      mockRoomSessionManager,
      mockNamespaceGracePeriodManager,
      mockArrangeRoomStateService,
      mockEffectChainService,
      mockRoomUserService,
      mockRoomSettingsService,
      mockPerformRoomStateService
    );

    // Default: Redis returns null (no key isFound) — tests can override per-case
    (redisStateService.hget as jest.Mock).mockResolvedValue(null);
    (redisStateService.hdel as jest.Mock).mockResolvedValue(undefined);
    (redisStateService.hset as jest.Mock).mockResolvedValue(undefined);
  });

  describe('createRoom', () => {
    it('should create a room with valid data', async () => {
      // Arrange
      const name = 'Test Room';
      const username = 'testuser';
      const userId = 'user123';
      const isPrivate = false;
      const isHidden = false;
      const description = 'Test room description';
      const roomType = RoomType.PERFORM;

      // Act
      const result = await roomService.createRoom(
        name,
        username,
        userId,
        isPrivate,
        isHidden,
        description,
        roomType
      );

      // Assert
      expect(result).toHaveProperty('room');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('session');

      expect(result.room.name).toBe(name);
      expect(result.room.owner).toBe(userId);
      expect(result.room.isPrivate).toBe(isPrivate);
      expect(result.room.isHidden).toBe(isHidden);
      expect(result.room.description).toBe(description);
      expect(result.room.roomType).toBe(roomType);

      expect(result.user.id).toBe(userId);
      expect(result.user.username).toBe(username);
      expect(result.user.role).toBe('room_owner');

      const user = result.user as BandMember;
      expect(user.isReady).toBe(true);

      // Validate room structure
      expect(result.room.id).toEqual(expect.any(String));
      expect(result.room.name).toEqual(expect.any(String));
      expect(result.room.owner).toEqual(expect.any(String));
      expect(result.room.isPrivate).toEqual(expect.any(Boolean));
      expect(result.room.createdAt).toEqual(expect.any(Date));

      // Validate user structure
      expect(result.user.id).toEqual(expect.any(String));
      expect(result.user.username).toEqual(expect.any(String));
      expect(result.user.role).toMatch(/^(room_owner|performer|audience|admin)$/);
      expect(user.isReady).toEqual(expect.any(Boolean));
    });

    it('should create room with default parameters', async () => {
      // Arrange
      const name = 'Simple Room';
      const username = 'user';
      const userId = 'user456';

      // Act
      const result = await roomService.createRoom(name, username, userId);

      // Assert
      expect(result.room.isPrivate).toBe(false);
      expect(result.room.isHidden).toBe(false);
      expect(result.room.roomType).toBe(RoomType.PERFORM);
      expect(result.room.description).toBeUndefined();
    });

    it('should ensure user has effect chains', async () => {
      // Arrange
      const name = 'Effect Room';
      const username = 'effectuser';
      const userId = 'user789';

      // Act
      const result = await roomService.createRoom(name, username, userId);

      // Assert
      const user = result.user as BandMember;
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });
  });


  describe('performance tests', () => {
    it('should create room within acceptable time', async () => {
      // Arrange
      const name = 'Performance Room';
      const username = 'perfuser';
      const userId = 'perf123';

      // Act & Assert
      const start = performance.now();
      const result = await roomService.createRoom(name, username, userId);
      const end = performance.now();
      const duration = end - start;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });
  });

  describe('getAllRooms - ghost user safety', () => {
    it('should exclude users without active sessions from room counts', async () => {
      const room: Room = {
        id: 'room-1',
        name: 'Ghost Check Room',
        roomType: RoomType.PERFORM,
        owner: 'owner-1',
        bandMembers: new Map([
          ['owner-1', { id: 'owner-1', username: 'owner', role: 'room_owner', isReady: true }],
          ['ghost-1', { id: 'ghost-1', username: 'ghost', role: 'band_member', isReady: false }],
        ]),
        audiences: new Map([
          ['aud-1', { id: 'aud-1', username: 'aud', role: 'audience', joinedAt: new Date() }],
        ]),
        pendingMembers: new Map(),
        isPrivate: true,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(Date.now() - 60_000),
        metronome: { bpm: 120, beatZeroAt: 0 },
        isBroadcasting: false,
      };

      void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
      void mockRoomCleanupService.hasUserIntentionallyLeft.mockResolvedValue(false);
      void mockNamespaceGracePeriodManager.isUserInGracePeriod.mockReturnValue(false);
      void mockRoomUserService.getBandMembers.mockResolvedValue(Array.from(room.bandMembers.values()));
      void mockRoomUserService.getAudiences.mockResolvedValue(Array.from(room.audiences.values()));
      mockRoomSessionManager.isUserActiveInRoom.mockImplementation(async (_roomId: string, userId: string) => {
        return userId !== 'ghost-1';
      });

      const rooms = await roomService.getAllRooms(true);

      expect(rooms).toHaveLength(1);
      interface RoomWithCounts extends Room {
        userCount?: number;
        activeBandMemberCount?: number;
      }
      const roomWithCounts = rooms[0] as RoomWithCounts;
      expect(roomWithCounts.userCount).toBe(2);
      expect(roomWithCounts.activeBandMemberCount).toBe(1);
    });

    it('should include grace-period users in room counts even without active session', async () => {
      const room: Room = {
        id: 'room-2',
        name: 'Grace Room',
        roomType: RoomType.PERFORM,
        owner: 'owner-2',
        bandMembers: new Map([
          ['owner-2', { id: 'owner-2', username: 'owner2', role: 'room_owner', isReady: true }],
          ['grace-member', { id: 'grace-member', username: 'grace', role: 'band_member', isReady: false }],
        ]),
        audiences: new Map(),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        isIsolated: false,
        createdAt: new Date(Date.now() - 60_000),
        metronome: { bpm: 120, beatZeroAt: 0 },
        isBroadcasting: false,
      };

      void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
      void mockRoomCleanupService.hasUserIntentionallyLeft.mockResolvedValue(false);
      mockNamespaceGracePeriodManager.isUserInGracePeriod.mockImplementation((userId: string) => {
        return userId === 'grace-member';
      });
      void mockRoomUserService.getBandMembers.mockResolvedValue(Array.from(room.bandMembers.values()));
      void mockRoomUserService.getAudiences.mockResolvedValue([]);
      void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(false);

      const rooms = await roomService.getAllRooms(true);

      expect(rooms).toHaveLength(1);
      interface RoomWithCounts extends Room {
        userCount?: number;
        activeBandMemberCount?: number;
      }
      const roomWithCounts = rooms[0] as RoomWithCounts;
      expect(roomWithCounts.userCount).toBe(1);
      expect(roomWithCounts.activeBandMemberCount).toBe(1);
    });
  });

  describe('getRoomOccupancy / companion counts', () => {
    const makeCompanion = (id: string): CompanionConfig => ({
      id,
      instrumentId: 'bass',
      role: 'bass',
      style: 'root-only',
      density: 'normal',
      isPlaying: false,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
    });

    const makePerformState = (companionCount: number): PerformRoomState => ({
      roomId: 'room-occ',
      roomType: 'perform',
      userStates: new Map(),
      recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
      broadcastStates: {},
      voiceStates: {},
      occupancy: new Map(),
      companions: Array.from({ length: companionCount }, (_unused, i) => makeCompanion(`c-${i}`)),
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      companionChordLength: 2,
      companionProgressionFlavor: 'diatonic',
      companionChordProgression: { mode: 'random', chords: [], barsPerChord: 2, currentChordIndex: 0 },
      lastUpdated: new Date(),
    });

    const buildRoom = (overrides: Partial<Room>): Room => ({
      id: 'room-occ',
      name: 'Occupancy Room',
      roomType: RoomType.PERFORM,
      owner: 'owner-1',
      bandMembers: new Map([
        ['owner-1', { id: 'owner-1', username: 'owner', role: 'room_owner', isReady: true }],
        ['m-1', { id: 'm-1', username: 'm1', role: 'band_member', isReady: true }],
      ]),
      audiences: new Map([
        ['a-1', { id: 'a-1', username: 'a1', role: 'audience', joinedAt: new Date() }],
      ]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(Date.now() - 60_000), // older than grace period → active-session checks apply
      metronome: { bpm: 120, beatZeroAt: 0 },
      isBroadcasting: false,
      ...overrides,
    });

    const wireRoomUsers = (room: Room): void => {
      void mockRoomUserService.getBandMembers.mockResolvedValue(Array.from(room.bandMembers.values()));
      void mockRoomUserService.getAudiences.mockResolvedValue(Array.from(room.audiences.values()));
      void mockRoomCleanupService.hasUserIntentionallyLeft.mockResolvedValue(false);
      mockNamespaceGracePeriodManager.isUserInGracePeriod.mockReturnValue(false);
      void mockRoomSessionManager.isUserActiveInRoom.mockResolvedValue(true);
    };

    it('returns null when the room does not exist', async () => {
      void mockRoomRepository.getRoom.mockResolvedValue(undefined);

      const occupancy = await roomService.getRoomOccupancy('missing');

      expect(occupancy).toBeNull();
    });

    it('counts active band members, audiences, and companions for a broadcasting perform room', async () => {
      const room = buildRoom({ roomType: RoomType.PERFORM, isBroadcasting: true });
      void mockRoomRepository.getRoom.mockResolvedValue(room);
      wireRoomUsers(room);
      void mockPerformRoomStateService.getState.mockResolvedValue(makePerformState(3));

      const occupancy = await roomService.getRoomOccupancy('room-occ');

      expect(occupancy?.activeBandMemberCount).toBe(2);
      expect(occupancy?.audienceCount).toBe(1);
      expect(occupancy?.companionCount).toBe(3);
      expect(occupancy?.userCount).toBe(3);
    });

    it('excludes band members without an active session', async () => {
      const room = buildRoom({ roomType: RoomType.PERFORM, isBroadcasting: true });
      void mockRoomRepository.getRoom.mockResolvedValue(room);
      wireRoomUsers(room);
      mockRoomSessionManager.isUserActiveInRoom.mockImplementation(async (_roomId: string, userId: string) => userId !== 'm-1');

      const occupancy = await roomService.getRoomOccupancy('room-occ');

      expect(occupancy?.activeBandMemberCount).toBe(1); // m-1 dropped (no session)
    });

    it('reports 0 audiences for a non-broadcasting perform room', async () => {
      const room = buildRoom({ roomType: RoomType.PERFORM, isBroadcasting: false });
      void mockRoomRepository.getRoom.mockResolvedValue(room);
      wireRoomUsers(room);
      void mockPerformRoomStateService.getState.mockResolvedValue(makePerformState(2));

      const occupancy = await roomService.getRoomOccupancy('room-occ');

      expect(occupancy?.audienceCount).toBe(0);
      expect(occupancy?.companionCount).toBe(2);
    });

    it('reports 0 companions for an arrange room without touching perform state', async () => {
      const room = buildRoom({ roomType: RoomType.ARRANGE, isBroadcasting: false });
      void mockRoomRepository.getRoom.mockResolvedValue(room);
      wireRoomUsers(room);

      const occupancy = await roomService.getRoomOccupancy('room-occ');

      expect(occupancy?.companionCount).toBe(0);
      expect(mockPerformRoomStateService.getState).not.toHaveBeenCalled();
    });

    it('includes companionCount in getAllRooms for a perform room with companions', async () => {
      const room = buildRoom({ roomType: RoomType.PERFORM, isBroadcasting: false });
      void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
      wireRoomUsers(room);
      void mockPerformRoomStateService.getState.mockResolvedValue(makePerformState(4));

      const rooms = await roomService.getAllRooms(true);

      interface RoomWithCompanions extends Room { companionCount?: number }
      expect((rooms[0] as RoomWithCompanions).companionCount).toBe(4);
    });

    it('omits companionCount in getAllRooms for an arrange room', async () => {
      const room = buildRoom({ roomType: RoomType.ARRANGE, isBroadcasting: false });
      void mockRoomRepository.getAllRooms.mockResolvedValue([room]);
      wireRoomUsers(room);

      const rooms = await roomService.getAllRooms(true);

      interface RoomWithCompanions extends Room { companionCount?: number }
      expect((rooms[0] as RoomWithCompanions).companionCount).toBeUndefined();
    });
  });

  describe('getRoomByInviteCode', () => {
    it('should return room and role when code matches bandMemberInviteCode (O(1) Redis path)', async () => {
      const mockRoom: Partial<Room> = {
        id: 'room-1',
        name: 'Invite Room',
        bandMemberInviteCode: 'member-code-123',
        audienceInviteCode: 'audience-code-456'
      };

      // Redis hash returns roomId for the invite code
      (redisStateService.hget as jest.Mock).mockResolvedValue('room-1');
      void mockRoomRepository.getRoom.mockResolvedValue(mockRoom as Room);

      const result = await roomService.getRoomByInviteCode('member-code-123');

      expect(result).toBeDefined();
      expect(result?.room.id).toBe('room-1');
      expect(result?.role).toBe('band_member');
    });

    it('should return room and role when code matches audienceInviteCode (O(1) Redis path)', async () => {
      const mockRoom: Partial<Room> = {
        id: 'room-2',
        name: 'Invite Room 2',
        bandMemberInviteCode: 'member-code-789',
        audienceInviteCode: 'audience-code-000'
      };

      // Redis hash returns roomId for the invite code
      (redisStateService.hget as jest.Mock).mockResolvedValue('room-2');
      void mockRoomRepository.getRoom.mockResolvedValue(mockRoom as Room);

      const result = await roomService.getRoomByInviteCode('audience-code-000');

      expect(result).toBeDefined();
      expect(result?.room.id).toBe('room-2');
      expect(result?.role).toBe('audience');
    });

    it('should return undefined if code is not found in Redis and fallback scan finds nothing', async () => {
      // Redis returns null → hget miss
      (redisStateService.hget as jest.Mock).mockResolvedValue(null);

      const result = await roomService.getRoomByInviteCode('unknown-code');

      expect(result).toBeUndefined();
      // Should NOT fall back to getAllRooms — only falls back on Redis error, not null
      expect(mockRoomRepository.getAllRooms).not.toHaveBeenCalled();
    });

    it('should fall back to linear scan when Redis throws', async () => {
      const mockRoom: Partial<Room> = {
        id: 'room-3',
        name: 'Invite Room 3',
        bandMemberInviteCode: 'member-code-abc',
        audienceInviteCode: 'audience-code-xyz'
      };

      // Redis throws an error
      (redisStateService.hget as jest.Mock).mockRejectedValue(new Error('Redis connection error'));
      void mockRoomRepository.getAllRooms.mockResolvedValue([mockRoom as Room]);

      const result = await roomService.getRoomByInviteCode('member-code-abc');

      expect(result).toBeDefined();
      expect(result?.room.id).toBe('room-3');
      expect(result?.role).toBe('band_member');
      expect(mockRoomRepository.getAllRooms).toHaveBeenCalled();
    });
  });

  describe('transferOwnershipAndUnisolate (DEV-208 guest→registered swap)', () => {
    const makeRoom = (overrides: Partial<Room>): Room => ({
      id: 'room-swap',
      name: 'Swap Room',
      roomType: RoomType.ARRANGE,
      owner: 'guest:old',
      bandMembers: new Map(),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(),
      metronome: { bpm: 120, beatZeroAt: 0 },
      ...overrides,
    });

    it('rekeys owner on a NON-isolated room so the save path sees the registered owner', async () => {
      // Regression: a guest who owns a normal (non-tour) Arrange Room registers mid-session.
      // The Room aggregate's `owner` field must follow the swap, otherwise save-from-room
      // resolves the owner to the vanished guest id and reports ROOM_OWNER_IS_GUEST.
      const room = makeRoom({ isIsolated: false, owner: 'guest:old' });
      void mockRoomRepository.getRoom.mockResolvedValue(room);

      await roomService.transferOwnershipAndUnisolate('room-swap', 'reg:new', 'guest:old');

      expect(room.owner).toBe('reg:new');
      expect(room.isIsolated).toBe(false);
      expect(mockRoomRepository.saveRoom).toHaveBeenCalledWith(room);
    });

    it('transfers ownership AND lifts isolation on an isolated tour room (DEV-221)', async () => {
      const room = makeRoom({ isIsolated: true, isHidden: true, owner: 'guest:old' });
      void mockRoomRepository.getRoom.mockResolvedValue(room);

      await roomService.transferOwnershipAndUnisolate('room-swap', 'reg:new', 'guest:old');

      expect(room.owner).toBe('reg:new');
      expect(room.isIsolated).toBe(false);
      expect(room.isHidden).toBe(true);
      expect(mockRoomRepository.saveRoom).toHaveBeenCalledWith(room);
    });

    it('is a no-op when the room is no longer owned by the previous (guest) id', async () => {
      const room = makeRoom({ isIsolated: false, owner: 'someone:else' });
      void mockRoomRepository.getRoom.mockResolvedValue(room);

      await roomService.transferOwnershipAndUnisolate('room-swap', 'reg:new', 'guest:old');

      expect(room.owner).toBe('someone:else');
      expect(mockRoomRepository.saveRoom).not.toHaveBeenCalled();
    });

    it('is a no-op when the room does not exist', async () => {
      void mockRoomRepository.getRoom.mockResolvedValue(undefined);

      await roomService.transferOwnershipAndUnisolate('missing', 'reg:new', 'guest:old');

      expect(mockRoomRepository.saveRoom).not.toHaveBeenCalled();
    });
  });
});
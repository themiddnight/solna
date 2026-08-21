import { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { RoomRepository } from '@/domains/room-management/infrastructure/repositories/RoomRepository';
import type { RoomUserService } from '@/domains/room-management/domain/services/RoomUserService';
import type { EffectChainService } from '@/domains/audio-processing/infrastructure/services/EffectChainService';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { User, Room, BandMember } from '@/types';
import { RoomType } from '@/types';
import { createPartialMock } from '@/testing/mocks';

describe('RoomMembershipService', () => {
  let roomMembershipService: RoomMembershipService;
  let mockRoomRepository: jest.Mocked<RoomRepository>;
  let mockRoomUserService: jest.Mocked<RoomUserService>;
  let mockEffectChainService: jest.Mocked<EffectChainService>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;

  const mockUser: User = {
    id: 'user-1',
    username: 'testuser',
    role: 'audience',
    joinedAt: new Date()
  };

  const mockBandMember: BandMember = {
    id: 'user-1',
    username: 'testuser',
    role: 'band_member',
    isReady: true,
  };

  const _mockRoom: Room = {
    id: 'room-1',
    name: 'Test Room',
    owner: 'owner-1',
    bandMembers: new Map(),
    audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: false,
    isIsolated: false,
    createdAt: new Date(),
    roomType: RoomType.PERFORM,
    metronome: { bpm: 120, beatZeroAt: Date.now() }
  };

  beforeEach(() => {
    mockRoomRepository = createPartialMock<RoomRepository>({
      getRoom: jest.fn(),
      saveRoom: jest.fn(),
      getAllRooms: jest.fn(),
    });

    mockRoomUserService = createPartialMock<RoomUserService>({
      findUserInRoom: jest.fn(),
      addUserToRoom: jest.fn(),
      addPendingMember: jest.fn(),
      approveMember: jest.fn(),
      rejectMember: jest.fn(),
      removeUserFromRoom: jest.fn(),
      transferOwnership: jest.fn(),
      getRoomUsers: jest.fn(),
      getPendingMembers: jest.fn(),
    });

    mockEffectChainService = createPartialMock<EffectChainService>({
      ensureUserEffectChains: jest.fn(),
    });

    mockRoomSessionManager = createPartialMock<RoomSessionManager>({
      findSocketByUserIdAsync: jest.fn(),
      removeOldSessionsForUser: jest.fn(),
    });

    roomMembershipService = new RoomMembershipService(
      mockRoomRepository,
      mockRoomUserService,
      mockEffectChainService,
      mockRoomSessionManager
    );
  });

  describe('findUserInRoom', () => {
    it('should delegate to roomUserService', async () => {
void mockRoomUserService.findUserInRoom.mockResolvedValue(mockUser);
      const result = await roomMembershipService.findUserInRoom('room-1', 'user-1');
      expect(result).toBe(mockUser);
      expect(mockRoomUserService.findUserInRoom).toHaveBeenCalledWith('room-1', 'user-1');
    });
  });

  describe('addUserToRoom', () => {
    it('should delegate to roomUserService with effect chain initialization', async () => {
void mockRoomUserService.addUserToRoom.mockResolvedValue(true);
      const didAdd = await roomMembershipService.addUserToRoom('room-1', mockUser);
      expect(didAdd).toBe(true);
      expect(mockRoomUserService.addUserToRoom).toHaveBeenCalled();
      
      // Verify the callback initializes effect chains
      const calls = mockRoomUserService.addUserToRoom.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callback = calls[0]?.[2];
      if (callback) callback(mockBandMember);
      expect(mockEffectChainService.ensureUserEffectChains).toHaveBeenCalledWith(mockBandMember);
    });
  });

  describe('removeUserFromRoom', () => {
    it('should delegate to roomUserService', async () => {
void mockRoomUserService.removeUserFromRoom.mockResolvedValue(mockUser);
      const result = await roomMembershipService.removeUserFromRoom('room-1', 'user-1', true);
      expect(result).toBe(mockUser);
      expect(mockRoomUserService.removeUserFromRoom).toHaveBeenCalledWith('room-1', 'user-1', true);
    });
  });

  describe('ensureUserEffectChains', () => {
    it('should delegate to effectChainService', () => {
      // Create user as band member for this test since audiences don't have effects
void roomMembershipService.ensureUserEffectChains(mockBandMember);
      expect(mockEffectChainService.ensureUserEffectChains).toHaveBeenCalledWith(mockBandMember);
    });
  });
});

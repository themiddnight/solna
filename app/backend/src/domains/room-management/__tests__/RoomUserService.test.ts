import { RoomUserService } from '@/domains/room-management/domain/services/RoomUserService';
import type { RoomRepository } from '@/domains/room-management/infrastructure/repositories/RoomRepository';
import type { RoomCleanupService } from '@/domains/room-management/domain/services/RoomCleanupService';
import { roomUserRepository } from '@/domains/room-management/infrastructure/repositories/RoomUserRepository';
import type { User, Room, BandMember } from '@/types';
import { RoomType } from '@/types';
import { createPartialMock } from '@/testing/mocks';

// Mock roomUserRepository
jest.mock('@/domains/room-management/infrastructure/repositories/RoomUserRepository', () => ({
  roomUserRepository: {
    addUser: jest.fn(),
    removeUser: jest.fn(),
    getUser: jest.fn(),
    getBandMembers: jest.fn(),
    getAudiences: jest.fn(),
  }
}));

describe('RoomUserService', () => {
  let roomUserService: RoomUserService;
  let mockRoomRepository: jest.Mocked<RoomRepository>;
  let mockRoomCleanupService: jest.Mocked<RoomCleanupService>;

  const mockUser: User = {
    id: 'user-1',
    username: 'test-user',
    role: 'band_member',
    isReady: true
  };

  const mockUserWithDefaultInstrument = {
    ...mockUser,
    followScale: true,
    currentInstrument: 'acoustic_grand_piano',
    currentCategory: 'melodic',
  };

  const mockRoom: Room = {
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
      saveRoom: jest.fn().mockResolvedValue(undefined),
      invalidateRoomCache: jest.fn(),
      invalidateListCaches: jest.fn(),
    });

    mockRoomCleanupService = createPartialMock<RoomCleanupService>({
      removeFromIntentionallyLeft: jest.fn(),
      markIntentionalLeave: jest.fn(),
    });

    // Reset roomUserRepository mocks
    (roomUserRepository.addUser as jest.Mock).mockResolvedValue(true);
    (roomUserRepository.removeUser as jest.Mock).mockResolvedValue(true);
    (roomUserRepository.getUser as jest.Mock).mockResolvedValue(null);
    (roomUserRepository.getBandMembers as jest.Mock).mockResolvedValue([]);
    (roomUserRepository.getAudiences as jest.Mock).mockResolvedValue([]);

    roomUserService = new RoomUserService(
      mockRoomRepository,
      mockRoomCleanupService
    );

    // Reset room state
void mockRoom.bandMembers.clear();
void mockRoom.audiences.clear();
void mockRoom.pendingMembers.clear();
  });

  describe('addUserToRoom', () => {
    it('should add user to room and initialize effects', async () => {
      // Arrange
      void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      const effectInitializer = jest.fn();

      // Act
      const didAdd = await roomUserService.addUserToRoom('room-1', mockUser, effectInitializer);

      // Assert
      expect(didAdd).toBe(true);
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('room-1', mockUserWithDefaultInstrument);
      expect(effectInitializer).toHaveBeenCalledWith(mockUserWithDefaultInstrument);
      expect(mockRoomCleanupService.removeFromIntentionallyLeft).toHaveBeenCalledWith('user-1');
      expect(mockRoomRepository.invalidateRoomCache).toHaveBeenCalledWith('room-1');
    });

    it('should return false if room does not exist', async () => {
      // Arrange
void mockRoomRepository.getRoom.mockResolvedValue(undefined);

      // Act
      const didAdd = await roomUserService.addUserToRoom('room-1', mockUser, jest.fn());

      // Assert
      expect(didAdd).toBe(false);
    });

    it('defaults a joining band member to following the room scale', async () => {
      // Arrange
      void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      const joiningMember: User = { id: 'u1', username: 'u', role: 'band_member', isReady: true };

      // Act
      await roomUserService.addUserToRoom('room-1', joiningMember, jest.fn());

      // Assert
      expect(roomUserRepository.addUser).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ followScale: true })
      );
    });

    it('respects an explicit followScale=false (room owner path)', async () => {
      // Arrange
      void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      const owner: User = {
        id: 'o1',
        username: 'o',
        role: 'room_owner',
        isReady: true,
        followScale: false,
      };

      // Act
      await roomUserService.addUserToRoom('room-1', owner, jest.fn());

      // Assert
      expect(roomUserRepository.addUser).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ followScale: false })
      );
    });

    it('defaults a joining room_owner to not following the room scale', async () => {
      void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      const owner: User = { id: 'o1', username: 'o', role: 'room_owner', isReady: true };

      await roomUserService.addUserToRoom('room-1', owner, jest.fn());

      expect(roomUserRepository.addUser).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ followScale: false })
      );
    });
  });

  describe('removeUserFromRoom', () => {
    it('should remove user and handle unintentional leave (grace period)', async () => {
      // Arrange
void mockRoom.bandMembers.set(mockUser.id, mockUser);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      (roomUserRepository.getUser as jest.Mock).mockResolvedValue(mockUser);

      // Act
      const result = await roomUserService.removeUserFromRoom('room-1', mockUser.id, false);

      // Assert
      expect(result).toBeDefined();
      expect(roomUserRepository.removeUser).toHaveBeenCalledWith('room-1', mockUser.id);
      // Note: We can't easily mock the singleton namespaceGracePeriodManager directly here without more setup,
      // but we can verify the cleanup service wasn't called for intentional leave
      expect(mockRoomCleanupService.markIntentionalLeave).not.toHaveBeenCalled();
    });

    it('should remove user and handle intentional leave', async () => {
      // Arrange
void mockRoom.bandMembers.set(mockUser.id, mockUser);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      (roomUserRepository.getUser as jest.Mock).mockResolvedValue(mockUser);

      // Act
      await roomUserService.removeUserFromRoom('room-1', mockUser.id, true);

      // Assert
      expect(mockRoomCleanupService.markIntentionalLeave).toHaveBeenCalledWith(
        mockUser.id,
        'room-1',
        mockUser
      );
    });
  });

  describe('transferOwnership', () => {
    it('should transfer ownership to specific user', async () => {
      // Arrange
      const ownerUser: BandMember = { ...mockUser, id: 'owner-1', role: 'room_owner', isReady: true };
      const nextUser: BandMember = { ...mockUser, id: 'user-2', role: 'band_member', isReady: true };

      mockRoom.owner = 'owner-1';
void mockRoom.bandMembers.set('owner-1', ownerUser);
void mockRoom.bandMembers.set('user-2', nextUser);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      // Act
      const result = await roomUserService.transferOwnership('room-1', 'user-2', ownerUser);

      // Assert
      expect(result).toBeDefined();
      expect(result?.newOwner.id).toBe('user-2');
      expect(result?.newOwner.role).toBe('room_owner');
      expect(result?.oldOwner.role).toBe('band_member');
      expect(mockRoom.owner).toBe('user-2');
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('room-1', expect.objectContaining({
        id: 'user-2',
        role: 'room_owner',
      }));
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('room-1', expect.objectContaining({
        id: 'owner-1',
        role: 'band_member',
      }));
    });

    it('should pick candidate automatically if new owner not found', async () => {
      // Arrange
      const ownerUser: BandMember = { ...mockUser, id: 'owner-1', role: 'room_owner', isReady: true };
      const otherUser: BandMember = { ...mockUser, id: 'user-3', role: 'band_member', isReady: true };

      mockRoom.owner = 'owner-1';
void mockRoom.bandMembers.set('owner-1', ownerUser);
void mockRoom.bandMembers.set('user-3', otherUser);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      // Act - pass non-existent user ID
      const result = await roomUserService.transferOwnership('room-1', 'non-existent', ownerUser);

      // Assert
      expect(result).toBeDefined();
      expect(result?.newOwner.id).toBe('user-3'); // Should pick user-3
      expect(mockRoom.owner).toBe('user-3');
    });

    it('should set followScale to false when promoting a band member to room owner', async () => {
      // Arrange
      const ownerUser: BandMember = { ...mockUser, id: 'owner-1', role: 'room_owner', isReady: true, followScale: false };
      const promotedUser: BandMember = { ...mockUser, id: 'user-2', role: 'band_member', isReady: true, followScale: true };

      mockRoom.owner = 'owner-1';
void mockRoom.bandMembers.set('owner-1', ownerUser);
void mockRoom.bandMembers.set('user-2', promotedUser);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      // Act
      const result = await roomUserService.transferOwnership('room-1', 'user-2', ownerUser);

      // Assert
      expect(result).toBeDefined();
      expect(result?.newOwner.id).toBe('user-2');
      expect(result?.newOwner.role).toBe('room_owner');
      expect(result?.newOwner.followScale).toBe(false);
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('room-1', expect.objectContaining({
        id: 'user-2',
        role: 'room_owner',
        followScale: false,
      }));
    });
  });

  describe('Pending Members', () => {
    it('should add pending member', async () => {
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      const pendingUser: BandMember = { ...mockUser, role: 'band_member', isReady: true };
      await roomUserService.addPendingMember('room-1', pendingUser);
      expect(mockRoom.pendingMembers.has(mockUser.id)).toBe(true);
    });

    it('should approve member', async () => {
      const pendingUser: BandMember = { ...mockUser, role: 'band_member', isReady: true };
void mockRoom.pendingMembers.set(mockUser.id, pendingUser);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const result = await roomUserService.approveMember('room-1', mockUser.id);

      expect(result).toBeDefined();
      expect(mockRoom.pendingMembers.has(mockUser.id)).toBe(false);
      expect(roomUserRepository.addUser).toHaveBeenCalledWith('room-1', {
        ...pendingUser,
        followScale: true,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'melodic',
      });
    });

    it('should reject member', async () => {
      const pendingUser: BandMember = { ...mockUser, role: 'band_member', isReady: true };
void mockRoom.pendingMembers.set(mockUser.id, pendingUser);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const result = await roomUserService.rejectMember('room-1', mockUser.id);

      expect(result).toBeDefined();
      expect(mockRoom.pendingMembers.has(mockUser.id)).toBe(false);
      expect(mockRoom.pendingMembers.has(mockUser.id)).toBe(false);
      expect(mockRoom.bandMembers.has(mockUser.id)).toBe(false);
      expect(mockRoom.audiences.has(mockUser.id)).toBe(false);
    });
  });
});

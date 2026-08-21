import { RoomCleanupService } from '../domain/services/RoomCleanupService';
import type { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import type { User, Room, BandMember } from '../../../types';
import { RoomType } from '../../../types';
import { namespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { roomUserRepository } from '../infrastructure/repositories/RoomUserRepository';
import { createPartialMock } from '@/testing/mocks';

jest.mock('../infrastructure/repositories/RoomUserRepository', () => ({
  roomUserRepository: {
    hasBandMembersStrict: jest.fn(),
  },
}));

describe('RoomCleanupService', () => {
  let roomCleanupService: RoomCleanupService;
  let mockRoomRepository: jest.Mocked<RoomRepository>;

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

  const mockHasBandMembersStrict = roomUserRepository.hasBandMembersStrict as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRoomRepository = createPartialMock<RoomRepository>({
      getRoom: jest.fn(),
      deleteRoom: jest.fn(),
    });

    // Reset room state
void mockRoom.bandMembers.clear();
void mockRoom.audiences.clear();

    // Default: hasBandMembersStrict returns false (no members) unless overridden per test
void mockHasBandMembersStrict.mockResolvedValue(false);

    // Spy on singleton method
    jest.spyOn(namespaceGracePeriodManager, 'getRoomGracePeriodUsers').mockReturnValue([]);
    jest.spyOn(namespaceGracePeriodManager, 'removeFromGracePeriod').mockReturnValue(true);

    roomCleanupService = new RoomCleanupService(mockRoomRepository);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('shouldCloseRoom', () => {
    it('should return true if room has no users', async () => {
void mockRoom.bandMembers.clear();
void mockRoom.audiences.clear();
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      
      const shouldClose = await roomCleanupService.shouldCloseRoom('room-1');
      expect(shouldClose).toBe(true);
    });

    it('should return false if room has users', async () => {
void mockRoom.bandMembers.set('user-1', { role: 'room_owner', isReady: true } as BandMember);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      
      const shouldClose = await roomCleanupService.shouldCloseRoom('room-1');
      expect(shouldClose).toBe(false);
    });

    it('should return true if room does not exist', async () => {
void mockRoomRepository.getRoom.mockResolvedValue(undefined);
      const shouldClose = await roomCleanupService.shouldCloseRoom('room-1');
      expect(shouldClose).toBe(true);
    });
  });

  describe('shouldCloseRoom — hasBandMembersStrict fail-safe (DEV-137)', () => {
    it('returns false when hasBandMembersStrict throws (Redis error) even though bandMembers appears empty', async () => {
      // bandMembers is empty — simulates getBandMembers returning [] due to Redis error
void mockRoom.bandMembers.clear();
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
void mockHasBandMembersStrict.mockRejectedValue(new Error('Redis connection refused'));

      const shouldClose = await roomCleanupService.shouldCloseRoom('room-1');

      expect(shouldClose).toBe(false);
    });

    it('returns false when hasBandMembersStrict confirms members exist (bandMembers was empty due to stale cache)', async () => {
void mockRoom.bandMembers.clear();
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
void mockHasBandMembersStrict.mockResolvedValue(true);

      const shouldClose = await roomCleanupService.shouldCloseRoom('room-1');

      expect(shouldClose).toBe(false);
    });

    it('does not call hasBandMembersStrict when bandMembers already shows active members', async () => {
void mockRoom.bandMembers.set('user-1', { role: 'band_member', isReady: true } as BandMember);
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const shouldClose = await roomCleanupService.shouldCloseRoom('room-1');

      expect(shouldClose).toBe(false);
      expect(mockHasBandMembersStrict).not.toHaveBeenCalled();
    });

    it('returns true when both bandMembers and hasBandMembersStrict confirm empty room with no grace period users', async () => {
void mockRoom.bandMembers.clear();
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
void mockHasBandMembersStrict.mockResolvedValue(false);
      jest.spyOn(namespaceGracePeriodManager, 'getRoomGracePeriodUsers').mockReturnValue([]);

      const shouldClose = await roomCleanupService.shouldCloseRoom('room-1');

      expect(shouldClose).toBe(true);
    });
  });

  describe('shouldCloseRoom — isolated tour room short-circuit (DEV-221)', () => {
    it('closes an isolated room immediately once it has no active band members, even during the owner grace period', async () => {
      const isolatedRoom: Room = { ...mockRoom, isIsolated: true };
      isolatedRoom.bandMembers.clear();
      void mockRoomRepository.getRoom.mockResolvedValue(isolatedRoom);
      void mockHasBandMembersStrict.mockResolvedValue(false);

      // Without the short-circuit, this grace-period owner entry would grant a reprieve
      // (see the non-isolated regression test below) — the isolated room must close anyway.
      const graceOwner: BandMember = { id: 'user-1', username: 'owner', role: 'room_owner', isReady: true };
      jest.spyOn(namespaceGracePeriodManager, 'getRoomGracePeriodUsers').mockReturnValue([
        {
          userId: 'user-1',
          roomId: 'room-1',
          namespacePath: '/perform/room-1',
          timestamp: Date.now(),
          isIntendedLeave: false,
          userData: graceOwner,
        },
      ]);
      jest.spyOn(roomCleanupService, 'hasUserIntentionallyLeft').mockResolvedValue(false);

      await expect(roomCleanupService.shouldCloseRoom('room-1')).resolves.toBe(true);
    });

    it('does not short-circuit a non-isolated room — grace-period musician still keeps it alive', async () => {
      void mockRoom.bandMembers.clear();
      void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);
      void mockHasBandMembersStrict.mockResolvedValue(false);
      const graceOwner: BandMember = { id: 'user-1', username: 'owner', role: 'room_owner', isReady: true };
      jest.spyOn(namespaceGracePeriodManager, 'getRoomGracePeriodUsers').mockReturnValue([
        {
          userId: 'user-1',
          roomId: 'room-1',
          namespacePath: '/perform/room-1',
          timestamp: Date.now(),
          isIntendedLeave: false,
          userData: graceOwner,
        },
      ]);
      jest.spyOn(roomCleanupService, 'hasUserIntentionallyLeft').mockResolvedValue(false);

      await expect(roomCleanupService.shouldCloseRoom('room-1')).resolves.toBe(false);
    });
  });

  describe('Intentional Leave Tracking', () => {
      it('should mark and check intentional leave', async () => {
          const user = { id: 'user-1', username: 'test' } as User;
          
void roomCleanupService.markIntentionalLeave('user-1', 'room-1', user);
          
          await expect(roomCleanupService.hasUserIntentionallyLeft('user-1', 'room-1')).resolves.toBe(true);
      });

      it('should remove from intentional leave', async () => {
        const user = { id: 'user-1', username: 'test' } as User;
void roomCleanupService.markIntentionalLeave('user-1', 'room-1', user);
        
void roomCleanupService.removeFromIntentionallyLeft('user-1');
        
        await expect(roomCleanupService.hasUserIntentionallyLeft('user-1', 'room-1')).resolves.toBe(false);
      });
  });
});

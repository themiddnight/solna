import { RoomSettingsService } from '@/domains/room-management/infrastructure/services/RoomSettingsService';
import type { RoomRepository } from '@/domains/room-management/infrastructure/repositories/RoomRepository';
import type { Room } from '@/types';
import { RoomType } from '@/types';
import { createPartialMock } from '@/testing/mocks';

describe('RoomSettingsService', () => {
  let roomSettingsService: RoomSettingsService;
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

  beforeEach(() => {
    mockRoomRepository = createPartialMock<RoomRepository>({
      getRoom: jest.fn(),
      saveRoom: jest.fn(),
      invalidateRoomCache: jest.fn(),
      invalidateListCaches: jest.fn(),
    });

    roomSettingsService = new RoomSettingsService(mockRoomRepository);
  });

  describe('updateRoomSettings', () => {
    it('should update allowed settings', async () => {
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const settings = {
        isPrivate: true,
        isHidden: true,
        description: 'Updated description'
      };

      const didUpdate = await roomSettingsService.updateRoomSettings('room-1', settings);

      expect(didUpdate).toBe(true);
      expect(mockRoom.isPrivate).toBe(true);
      expect(mockRoom.isHidden).toBe(true);
      expect(mockRoom.description).toBe('Updated description');
      // It modifies the room object directly (in-memory), so no saveRoom needed unless implemented
      expect(mockRoomRepository.invalidateRoomCache).toHaveBeenCalledWith('room-1');
    });

    it('should ignore invalid settings keys', async () => {
      mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

      const settings: Record<string, unknown> = {
        invalidKey: 'should not be saved',
        name: 'New Name' // name is allowed
      };

      const didUpdate = await roomSettingsService.updateRoomSettings('room-1', settings as Partial<Room>);

      expect(didUpdate).toBe(true);
      expect(mockRoom.name).toBe('New Name');
      expect(Object.prototype.hasOwnProperty.call(mockRoom, 'invalidKey')).toBe(false);
    });

    it('should return false for non-existent room', async () => {
void mockRoomRepository.getRoom.mockResolvedValue(undefined);
        const didUpdate = await roomSettingsService.updateRoomSettings('room-1', {});
        expect(didUpdate).toBe(false);
    });
  });

  describe('toggleBroadcast', () => {
      it('should toggle broadcast state', async () => {
          mockRoom.isBroadcasting = false;
void mockRoomRepository.getRoom.mockResolvedValue(mockRoom);

          const didToggle = await roomSettingsService.toggleBroadcast('room-1', true);

          expect(didToggle).toBe(true);
          expect(mockRoom.isBroadcasting).toBe(true);
          expect(mockRoomRepository.invalidateRoomCache).toHaveBeenCalledWith('room-1');
      });
  });
});

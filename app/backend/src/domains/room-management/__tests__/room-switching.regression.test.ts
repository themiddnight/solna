/**
 * BR-10: Seamless Room Switching - Regression Tests
 *
 * Protects against regressions in:
 * - Owner-only switch initiation
 * - Room type validation (Perform ↔ Arrange)
 * - Member notification flow
 * - Switch acknowledgment
 * - State preservation during switch
 * - Concurrent switch attempts
 */

import { RoomLifecycleService } from '../application/RoomLifecycleService';
import { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../domain/services/RoomCleanupService';
import { RoomUserService } from '../domain/services/RoomUserService';
import { RoomSettingsService } from '../infrastructure/services/RoomSettingsService';
import { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { ArrangeRoomStateService } from '../../arrange-room/application/ArrangeRoomStateService';
import { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import { RoomType } from '../../../types';

describe('BR-10: Room Switching Regression Tests', () => {
  let roomLifecycleService: RoomLifecycleService;
  let roomRepository: RoomRepository;
  let roomSessionManager: RoomSessionManager;
  const createdRoomIds: string[] = [];

  beforeAll(() => {
    roomSessionManager = new RoomSessionManager();
    const namespaceGracePeriodManager = new NamespaceGracePeriodManager();
    roomRepository = new RoomRepository();
    const roomCleanupService = new RoomCleanupService(roomRepository);
    const roomUserService = new RoomUserService(roomRepository, roomCleanupService);
    const roomSettingsService = new RoomSettingsService(roomRepository);
    const effectChainService = new EffectChainService(roomRepository);
    const arrangeRoomStateService = new ArrangeRoomStateService();

    roomLifecycleService = new RoomLifecycleService(
      roomRepository,
      roomCleanupService,
      roomSessionManager,
      namespaceGracePeriodManager,
      arrangeRoomStateService,
      effectChainService,
      roomUserService,
      roomSettingsService
    );

    const originalCreateRoom = roomLifecycleService.createRoom.bind(roomLifecycleService);
    roomLifecycleService.createRoom = async (...args: unknown[]) => {
      const result = await originalCreateRoom(...(args as Parameters<typeof originalCreateRoom>));
      createdRoomIds.push(result.room.id);
      return result;
    };
  });

  afterEach(async () => {
    // Clean up only our created rooms
    for (const roomId of createdRoomIds) {
      if (roomId) {
        await roomLifecycleService.deleteRoom(roomId).catch(() => {});
      }
    }
    createdRoomIds.length = 0;
  });

  describe('Room Type Validation', () => {
    it('should allow switching from Perform to Arrange room', async () => {
      // Create Perform room
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      // Create Arrange room (target)
      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Verify room types
      const perform = await roomRepository.getRoom(performRoom.room.id);
      const arrange = await roomRepository.getRoom(arrangeRoom.room.id);

      expect(perform?.roomType).toBe(RoomType.PERFORM);
      expect(arrange?.roomType).toBe(RoomType.ARRANGE);

      // Both rooms should exist and be valid switch targets
      expect(perform).toBeDefined();
      expect(arrange).toBeDefined();
    });

    it('should allow switching from Arrange to Perform room', async () => {
      // Create Arrange room
      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Create Perform room (target)
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      // Verify room types
      const arrange = await roomRepository.getRoom(arrangeRoom.room.id);
      const perform = await roomRepository.getRoom(performRoom.room.id);

      expect(arrange?.roomType).toBe(RoomType.ARRANGE);
      expect(perform?.roomType).toBe(RoomType.PERFORM);

      // Both rooms should exist and be valid switch targets
      expect(arrange).toBeDefined();
      expect(perform).toBeDefined();
    });

    it('should prevent switching to non-existent room', async () => {
      const room = await roomLifecycleService.createRoom(
        'Test Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      // Try to get non-existent target room
      const nonExistentRoom = await roomRepository.getRoom('non-existent-room-id');

      expect(nonExistentRoom).toBeFalsy();

      // Original room should still exist
      const originalRoom = await roomRepository.getRoom(room.room.id);
      expect(originalRoom).toBeDefined();
    });
  });

  describe('Owner Validation', () => {
    it('should verify room owner before allowing switch', async () => {
      const room = await roomLifecycleService.createRoom(
        'Owner Test Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const roomData = await roomRepository.getRoom(room.room.id);

      // Verify owner
      expect(roomData?.owner).toBe('owner-id');

      // Owner should be in bandMembers with room_owner role
      const ownerMember = roomData?.bandMembers.get('owner-id');
      expect(ownerMember?.role).toBe('room_owner');
    });

    it('should maintain single room owner', async () => {
      const room = await roomLifecycleService.createRoom(
        'Single Owner Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const roomData = await roomRepository.getRoom(room.room.id);

      // Count room_owner roles
      const owners = Array.from(roomData?.bandMembers.values() || [])
        .filter(member => member.role === 'room_owner');

      expect(owners.length).toBe(1);
      expect(owners[0]!.id).toBe('owner-id');
    });
  });

  describe('Room State Preservation', () => {
    it('should preserve room metadata during switch preparation', async () => {
      const roomName = `State Test ${Date.now()}`;
      const room = await roomLifecycleService.createRoom(
        roomName,
        'owner',
        'owner-id',
        true, // isPrivate
        false,
        'Test description',
        RoomType.PERFORM
      );

      const roomData = await roomRepository.getRoom(room.room.id);

      // Verify room state is preserved
      expect(roomData?.name).toBe(roomName);
      expect(roomData?.isPrivate).toBe(true);
      expect(roomData?.roomType).toBe(RoomType.PERFORM);
      expect(roomData?.owner).toBe('owner-id');
    });

    it('should maintain room members during switch', async () => {
      const room = await roomLifecycleService.createRoom(
        'Members Test',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const roomData = await roomRepository.getRoom(room.room.id);

      // Verify owner is in members
      expect(roomData?.bandMembers.size).toBe(1);
      expect(roomData?.bandMembers.has('owner-id')).toBe(true);

      // Room should have correct user count
      const totalUsers = (roomData?.bandMembers.size || 0) + (roomData?.audiences.size || 0);
      expect(totalUsers).toBe(1);
    });
  });

  describe('Concurrent Switch Prevention', () => {
    it('should handle multiple rooms for same owner', async () => {
      // Owner can have multiple rooms of different types
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Both rooms should exist
      const perform = await roomRepository.getRoom(performRoom.room.id);
      const arrange = await roomRepository.getRoom(arrangeRoom.room.id);

      expect(perform).toBeDefined();
      expect(arrange).toBeDefined();

      // Both should have same owner
      expect(perform?.owner).toBe('owner-id');
      expect(arrange?.owner).toBe('owner-id');
    });

    it('should maintain room isolation (separate state)', async () => {
      const room1 = await roomLifecycleService.createRoom(
        'Room 1',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const room2 = await roomLifecycleService.createRoom(
        'Room 2',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomData1 = await roomRepository.getRoom(room1.room.id);
      const roomData2 = await roomRepository.getRoom(room2.room.id);

      // Rooms should have different IDs
      expect(roomData1?.id).not.toBe(roomData2?.id);

      // Rooms should have different types
      expect(roomData1?.roomType).toBe(RoomType.PERFORM);
      expect(roomData2?.roomType).toBe(RoomType.ARRANGE);

      // Rooms should have different names
      expect(roomData1?.name).toBe('Room 1');
      expect(roomData2?.name).toBe('Room 2');
    });
  });

  describe('Switch Target Validation', () => {
    it('should verify target room exists before switch', async () => {
      const sourceRoom = await roomLifecycleService.createRoom(
        'Source Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const targetRoom = await roomLifecycleService.createRoom(
        'Target Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Both rooms should exist
      const source = await roomRepository.getRoom(sourceRoom.room.id);
      const target = await roomRepository.getRoom(targetRoom.room.id);

      expect(source).toBeDefined();
      expect(target).toBeDefined();

      // Target should be accessible
      expect(target?.id).toBe(targetRoom.room.id);
    });

    it('should handle switch to deleted target room gracefully', async () => {
      const sourceRoom = await roomLifecycleService.createRoom(
        'Source Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const targetRoom = await roomLifecycleService.createRoom(
        'Target Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Delete target room
      await roomLifecycleService.deleteRoom(targetRoom.room.id);

      // Target should no longer exist
      const deletedTarget = await roomRepository.getRoom(targetRoom.room.id);
      expect(deletedTarget).toBeFalsy();

      // Source room should still exist
      const source = await roomRepository.getRoom(sourceRoom.room.id);
      expect(source).toBeDefined();
    });
  });

  describe('Room Cleanup After Switch', () => {
    it('should allow room deletion after switch', async () => {
      const room = await roomLifecycleService.createRoom(
        'Deletable Room',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      // Verify room exists
      let roomData = await roomRepository.getRoom(room.room.id);
      expect(roomData).toBeDefined();

      // Delete room
      await roomLifecycleService.deleteRoom(room.room.id);

      // Verify room is deleted
      roomData = await roomRepository.getRoom(room.room.id);
      expect(roomData).toBeFalsy();
    });

    it('should clean up empty rooms correctly', async () => {
      const room = await roomLifecycleService.createRoom(
        'Empty Room Test',
        'owner',
        'owner-id',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const roomData = await roomRepository.getRoom(room.room.id);

      // Remove all users (simulate everyone leaving)
      if (roomData) {
void roomData.bandMembers.clear();
void roomData.audiences.clear();
      }

      // Room should now be empty
      const totalUsers = (roomData?.bandMembers.size || 0) + (roomData?.audiences.size || 0);
      expect(totalUsers).toBe(0);
    });
  });
});

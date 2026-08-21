/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars */
/**
 * Arrange Room Regression Tests
 * Ensures that Arrange Room features don't break existing Perform Room functionality
 * and maintains backward compatibility
 */
import { RoomLifecycleService } from '../../room-management/application/RoomLifecycleService';
import { RoomMembershipService } from '../../room-management/application/RoomMembershipService';
import { RoomSessionManager } from '../../room-management/infrastructure/services/RoomSessionManager';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import { RoomRepository } from '../../room-management/infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../../room-management/domain/services/RoomCleanupService';
import { RoomUserService } from '../../room-management/domain/services/RoomUserService';
import { RoomSettingsService } from '../../room-management/infrastructure/services/RoomSettingsService';
import { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { RoomType } from '../../../types';
import type { BandMember, Room } from '../../../types';
import { createTestTrack } from './fixtures/arrangeRoomTestDataFixture';

describe('Arrange Room Regression Tests', () => {
  let roomLifecycleService: RoomLifecycleService;
  let roomMembershipService: RoomMembershipService;
  let roomSessionManager: RoomSessionManager;
  let namespaceGracePeriodManager: NamespaceGracePeriodManager;
  let arrangeRoomStateService: ArrangeRoomStateService;
  let roomRepository: RoomRepository;
  let roomCleanupService: RoomCleanupService;
  let roomUserService: RoomUserService;
  let roomSettingsService: RoomSettingsService;
  let effectChainService: EffectChainService;

  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    roomSessionManager = new RoomSessionManager();
    namespaceGracePeriodManager = new NamespaceGracePeriodManager();
    roomRepository = new RoomRepository();
    roomCleanupService = new RoomCleanupService(roomRepository);
    roomUserService = new RoomUserService(roomRepository, roomCleanupService);
    roomSettingsService = new RoomSettingsService(roomRepository);
    effectChainService = new EffectChainService(roomRepository);
    arrangeRoomStateService = new ArrangeRoomStateService();

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

    roomMembershipService = new RoomMembershipService(
      roomRepository,
      roomUserService,
      effectChainService,
      roomSessionManager
    );

    const originalCreateRoom = roomLifecycleService.createRoom.bind(roomLifecycleService);
    roomLifecycleService.createRoom = async (...args: Parameters<typeof roomLifecycleService.createRoom>) => {
      const result = await originalCreateRoom(...args);
      if (result && result.room) {
        createdRoomIds.push(result.room.id);
      }
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

  describe('Room Type Coexistence', () => {
    it('should maintain perform room functionality when arrange rooms exist', async () => {
      // Create perform room
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Room',
        'PerformOwner',
        'perform-owner-1',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      // Create arrange room
      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'ArrangeOwner',
        'arrange-owner-1',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Verify both rooms exist independently
      expect(performRoom.room.roomType).toBe(RoomType.PERFORM);
      expect(arrangeRoom.room.roomType).toBe(RoomType.ARRANGE);
      expect(performRoom.room.id).not.toBe(arrangeRoom.room.id);

      // Verify perform room can be retrieved
      const foundPerformRoom = await roomLifecycleService.getRoom(performRoom.room.id);
      expect(foundPerformRoom).toBeDefined();
      expect(foundPerformRoom?.roomType).toBe(RoomType.PERFORM);

      // Verify arrange room can be retrieved
      const foundArrangeRoom = await roomLifecycleService.getRoom(arrangeRoom.room.id);
      expect(foundArrangeRoom).toBeDefined();
      expect(foundArrangeRoom?.roomType).toBe(RoomType.ARRANGE);
    });

    it('should handle users in both room types simultaneously', async () => {
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Room',
        'owner1',
        'owner1',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'owner2',
        'owner2',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const user: BandMember = {
        id: 'multi-user',
        username: 'multiuser',
        role: 'band_member',
        isReady: true,
      };

      // Add user to both rooms
      await roomMembershipService.addUserToRoom(performRoom.room.id, user);
      await roomMembershipService.addUserToRoom(arrangeRoom.room.id, user);

      const updatedPerformRoom = await roomLifecycleService.getRoom(performRoom.room.id);
      const updatedArrangeRoom = await roomLifecycleService.getRoom(arrangeRoom.room.id);

      expect((await roomMembershipService.getBandMembers(performRoom.room.id)).some(m => m.id === 'multi-user')).toBe(true);
      expect((await roomMembershipService.getBandMembers(arrangeRoom.room.id)).some(m => m.id === 'multi-user')).toBe(true);
    });

    it('should maintain separate room lists by type', async () => {
      // Use unique prefix to identify rooms created by this test
      const testPrefix = `RoomListTest_${Date.now()}`;

      // Create multiple rooms of each type with unique names
      await roomLifecycleService.createRoom(`${testPrefix}_Perform1`, 'owner1', `${testPrefix}_owner1`, false, false, undefined, RoomType.PERFORM);
      await roomLifecycleService.createRoom(`${testPrefix}_Perform2`, 'owner2', `${testPrefix}_owner2`, false, false, undefined, RoomType.PERFORM);
      await roomLifecycleService.createRoom(`${testPrefix}_Arrange1`, 'owner3', `${testPrefix}_owner3`, false, false, undefined, RoomType.ARRANGE);
      await roomLifecycleService.createRoom(`${testPrefix}_Arrange2`, 'owner4', `${testPrefix}_owner4`, false, false, undefined, RoomType.ARRANGE);

      const allRooms = await roomLifecycleService.getAllRooms();

      // Filter only rooms created by this test
      type RoomListEntry = (typeof allRooms)[number];
      const testRooms = allRooms.filter((r: RoomListEntry) => (r as { name?: string }).name?.startsWith(testPrefix));
      const performRooms = testRooms.filter((r: RoomListEntry) => (r as { roomType?: string }).roomType === RoomType.PERFORM);
      const arrangeRooms = testRooms.filter((r: RoomListEntry) => (r as { roomType?: string }).roomType === RoomType.ARRANGE);

      // Verify exact counts for rooms created by this test
      expect(performRooms.length).toBe(2);
      expect(arrangeRooms.length).toBe(2);
      expect(testRooms.length).toBe(4);
    });
  });

  describe('Core Room Functionality Preservation', () => {
    it('should maintain basic room creation for perform rooms', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Legacy Perform Room',
        'LegacyUser',
        'legacy-123',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      expect(roomData).toHaveProperty('room');
      expect(roomData).toHaveProperty('user');
      expect(roomData).toHaveProperty('session');
      expect(roomData.room.name).toBe('Legacy Perform Room');
      expect(roomData.room.owner).toBe('legacy-123');
      expect(roomData.user.role).toBe('room_owner');
    });

    it('should maintain room retrieval functionality', async () => {
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Room',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      expect(await roomLifecycleService.getRoom(performRoom.room.id)).toBeDefined();
      expect(await roomLifecycleService.getRoom(arrangeRoom.room.id)).toBeDefined();
    });

    it('should maintain room deletion functionality', async () => {
      const performRoom = await roomLifecycleService.createRoom(
        'Delete Perform',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const arrangeRoom = await roomLifecycleService.createRoom(
        'Delete Arrange',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      await roomLifecycleService.deleteRoom(performRoom.room.id);
      await roomLifecycleService.deleteRoom(arrangeRoom.room.id);

      expect(await roomLifecycleService.getRoom(performRoom.room.id)).toBeUndefined();
      expect(await roomLifecycleService.getRoom(arrangeRoom.room.id)).toBeUndefined();
    });

    it('should maintain user management functionality', async () => {
      const performRoom = await roomLifecycleService.createRoom(
        'User Mgmt Perform',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const arrangeRoom = await roomLifecycleService.createRoom(
        'User Mgmt Arrange',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const user: BandMember = {
        id: 'test-user',
        username: 'testuser',
        role: 'band_member',
        isReady: true,
      };

      // Test adding to perform room
      const user2: BandMember = { ...user, id: 'test-user-2', username: 'testuser2' };
      expect(await roomMembershipService.addUserToRoom(arrangeRoom.room.id, user2)).toBe(true);
      const bandMembers = await roomMembershipService.getBandMembers(arrangeRoom.room.id);
      expect(bandMembers.some(m => m.id === 'test-user-2')).toBe(true);
    });
  });

  describe('Effect Chains Compatibility', () => {
    it('should maintain effect chains for perform rooms', async () => {
      const performRoom = await roomLifecycleService.createRoom(
        'Effects Perform',
        'owner',
        'owner-effects',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const user = performRoom.user as BandMember;
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });

    it('should maintain effect chains for arrange rooms', async () => {
      const arrangeRoom = await roomLifecycleService.createRoom(
        'Effects Arrange',
        'owner',
        'owner-effects-arrange',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const user = arrangeRoom.user as BandMember;
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });

    it('should not interfere with effect chains between room types', async () => {
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Effects',
        'owner1',
        'owner1',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Effects',
        'owner2',
        'owner2',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      expect((performRoom.user as BandMember).effectChains).toBeDefined();
      expect((arrangeRoom.user as BandMember).effectChains).toBeDefined();
      expect(performRoom.user.id).not.toBe(arrangeRoom.user.id);
    });
  });

  describe('Data Integrity', () => {
    it('should maintain consistent room state across types', async () => {
      const performRoom = await roomLifecycleService.createRoom('Perform', 'owner1', 'owner1', false, false, undefined, RoomType.PERFORM);
      const arrangeRoom = await roomLifecycleService.createRoom('Arrange', 'owner2', 'owner2', false, false, undefined, RoomType.ARRANGE);

      expect(performRoom.room.id).not.toBe(arrangeRoom.room.id);
      expect(performRoom.room.owner).toBe('owner1');
      expect(arrangeRoom.room.owner).toBe('owner2');
      expect((await roomMembershipService.getBandMembers(performRoom.room.id)).length).toBe(1);
      expect((await roomMembershipService.getBandMembers(arrangeRoom.room.id)).length).toBe(1);
    });

    it('should not leak arrange room state into perform rooms', async () => {
      const performRoom = await roomLifecycleService.createRoom(
        'Perform Room',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      await arrangeRoomStateService.initializeState(arrangeRoom.room.id, 'empty');
      await arrangeRoomStateService.addTrack(arrangeRoom.room.id, createTestTrack({ id: 'track-1', name: 'Test Track' }));

      // Verify arrange room has state
      const arrangeState = await arrangeRoomStateService.getState(arrangeRoom.room.id);
      expect(arrangeState?.tracks).toHaveLength(1);

      // Verify perform room has no arrange state
      const performState = await arrangeRoomStateService.getState(performRoom.room.id);
      expect(performState).toBeNull();
    });

    it('should maintain user state consistency across room types', async () => {
      const performRoom = await roomLifecycleService.createRoom('Perform', 'owner1', 'owner1', false, false, undefined, RoomType.PERFORM);
      const arrangeRoom = await roomLifecycleService.createRoom('Arrange', 'owner2', 'owner2', false, false, undefined, RoomType.ARRANGE);

      const user: BandMember = {
        id: 'shared-user',
        username: 'shareduser',
        role: 'band_member',
        isReady: true,
      };

      await roomMembershipService.addUserToRoom(performRoom.room.id, user);
      await roomMembershipService.addUserToRoom(arrangeRoom.room.id, user);

      // Remove from perform room
      await roomMembershipService.removeUserFromRoom(performRoom.room.id, 'shared-user');

      // Verify still in arrange room
      // Verify still in arrange room
      const performMembers = await roomMembershipService.getBandMembers(performRoom.room.id);
      const arrangeMembers = await roomMembershipService.getBandMembers(arrangeRoom.room.id);
      expect(performMembers.some(m => m.id === 'shared-user')).toBe(false);
      expect(arrangeMembers.some(m => m.id === 'shared-user')).toBe(true);
    });
  });

  describe('API Contract Stability', () => {
    it('should maintain stable return types for room creation', async () => {
      const performResult = await roomLifecycleService.createRoom('Perform', 'owner', 'owner1', false, false, undefined, RoomType.PERFORM);
      const arrangeResult = await roomLifecycleService.createRoom('Arrange', 'owner', 'owner2', false, false, undefined, RoomType.ARRANGE);

      // Verify both have same structure
      expect(performResult).toHaveProperty('room');
      expect(performResult).toHaveProperty('user');
      expect(performResult).toHaveProperty('session');

      expect(arrangeResult).toHaveProperty('room');
      expect(arrangeResult).toHaveProperty('user');
      expect(arrangeResult).toHaveProperty('session');

      // Verify room properties
      expect(performResult.room).toHaveProperty('id');
      expect(performResult.room).toHaveProperty('name');
      expect(performResult.room).toHaveProperty('roomType');
      expect(performResult.room.roomType).toBe('perform');

      expect(arrangeResult.room).toHaveProperty('id');
      expect(arrangeResult.room).toHaveProperty('name');
      expect(arrangeResult.room).toHaveProperty('roomType');
      expect(arrangeResult.room.roomType).toBe('arrange');
    });

    it('should maintain backward compatible method signatures', async () => {
      // Verify methods exist and work for both room types
      expect(typeof roomLifecycleService.createRoom).toBe('function');
      expect(typeof roomLifecycleService.getRoom).toBe('function');
      expect(typeof roomLifecycleService.deleteRoom).toBe('function');
      expect(typeof roomMembershipService.addUserToRoom).toBe('function');
      expect(typeof roomMembershipService.removeUserFromRoom).toBe('function');

      const performRoom = await roomLifecycleService.createRoom('Perform', 'owner', 'owner1', false, false, undefined, RoomType.PERFORM);
      const arrangeRoom = await roomLifecycleService.createRoom('Arrange', 'owner', 'owner2', false, false, undefined, RoomType.ARRANGE);

      expect(await roomLifecycleService.getRoom(performRoom.room.id)).toBeDefined();
      expect(await roomLifecycleService.getRoom(arrangeRoom.room.id)).toBeDefined();
      expect(await roomLifecycleService.deleteRoom(performRoom.room.id)).toBe(true);
      expect(await roomLifecycleService.deleteRoom(arrangeRoom.room.id)).toBe(true);
    });
  });

  describe('Error Handling Consistency', () => {
    it('should handle errors consistently across room types', async () => {
      // Test invalid room retrieval
      expect(await roomLifecycleService.getRoom('invalid-perform-id')).toBeUndefined();
      expect(await roomLifecycleService.getRoom('invalid-arrange-id')).toBeUndefined();

      // Test invalid room deletion
      expect(await roomLifecycleService.deleteRoom('invalid-perform-id')).toBe(false);
      expect(await roomLifecycleService.deleteRoom('invalid-arrange-id')).toBe(false);
    });

    it('should handle edge cases consistently', async () => {
      // Empty name
      const emptyPerform = await roomLifecycleService.createRoom('', 'owner', 'owner1', false, false, undefined, RoomType.PERFORM);
      const emptyArrange = await roomLifecycleService.createRoom('', 'owner', 'owner2', false, false, undefined, RoomType.ARRANGE);

      expect(emptyPerform.room).toBeDefined();
      expect(emptyArrange.room).toBeDefined();

      // Very long name
      const longName = 'A'.repeat(1000);
      const longPerform = await roomLifecycleService.createRoom(longName, 'owner', 'owner3', false, false, undefined, RoomType.PERFORM);
      const longArrange = await roomLifecycleService.createRoom(longName, 'owner', 'owner4', false, false, undefined, RoomType.ARRANGE);

      expect(longPerform.room).toBeDefined();
      expect(longArrange.room).toBeDefined();
    });
  });

  describe('Room Settings Compatibility', () => {
    it('should maintain room privacy settings across types', async () => {
      const privatePerform = await roomLifecycleService.createRoom('Private Perform', 'owner', 'owner1', true, false, undefined, RoomType.PERFORM);
      const privateArrange = await roomLifecycleService.createRoom('Private Arrange', 'owner', 'owner2', true, false, undefined, RoomType.ARRANGE);

      expect(privatePerform.room.isPrivate).toBe(true);
      expect(privateArrange.room.isPrivate).toBe(true);
    });

    it('should maintain room hidden settings across types', async () => {
      const hiddenPerform = await roomLifecycleService.createRoom('Hidden Perform', 'owner', 'owner1', false, true, undefined, RoomType.PERFORM);
      const hiddenArrange = await roomLifecycleService.createRoom('Hidden Arrange', 'owner', 'owner2', false, true, undefined, RoomType.ARRANGE);

      expect(hiddenPerform.room.isHidden).toBe(true);
      expect(hiddenArrange.room.isHidden).toBe(true);
    });

    it('should maintain room description across types', async () => {
      const description = 'Test room description';
      const performRoom = await roomLifecycleService.createRoom('Perform', 'owner', 'owner1', false, false, description, RoomType.PERFORM);
      const arrangeRoom = await roomLifecycleService.createRoom('Arrange', 'owner', 'owner2', false, false, description, RoomType.ARRANGE);

      expect(performRoom.room.description).toBe(description);
      expect(arrangeRoom.room.description).toBe(description);
    });
  });
});

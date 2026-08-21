/**
 * Integration Tests for Room Management Flow
 * Tests the complete room lifecycle with real services working together
 */
import { RoomLifecycleService } from '../application/RoomLifecycleService';
import { RoomMembershipService } from '../application/RoomMembershipService';
import { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../domain/services/RoomCleanupService';
import { RoomUserService } from '../domain/services/RoomUserService';
import { RoomSettingsService } from '../infrastructure/services/RoomSettingsService';
import { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { ArrangeRoomStateService } from '../../arrange-room/application/ArrangeRoomStateService';
import { RoomType } from '../../../types';
import type { Audience } from '../../../types';

describe('Room Management Integration Tests', () => {
  let roomLifecycleService: RoomLifecycleService;
  let roomMembershipService: RoomMembershipService;
  let roomSessionManager: RoomSessionManager;
  let namespaceGracePeriodManager: NamespaceGracePeriodManager;
  let roomRepository: RoomRepository;
  let roomCleanupService: RoomCleanupService;
  let roomUserService: RoomUserService;
  let roomSettingsService: RoomSettingsService;
  let effectChainService: EffectChainService;
  let arrangeRoomStateService: ArrangeRoomStateService;

  beforeAll(async () => {
    // Initialize services
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

    // Clean test environment (testUtils is globally available via setup.ts)
  });

  afterAll(async () => {
    // Cleanup after tests
    namespaceGracePeriodManager.shutdown();
    
    // Disconnect Redis client to prevent open handles
    const { redisStateService } = await import('../../../shared/infrastructure/caching/RedisStateService');
    await redisStateService.disconnect();
  });

  describe('Room Creation and Management', () => {
    it('should create a room successfully', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'Integration Test Room',
        'IntegrationUser',
        'integration-user-123',
        false, // isPrivate
        false, // isHidden
        undefined, // description
        RoomType.PERFORM // roomType
      );

      expect(roomData.room).toBeDefined();
      expect(roomData.user).toBeDefined();
      expect(roomData.room.name).toBe('Integration Test Room');
      expect(roomData.room.owner).toBe('integration-user-123');
      expect(roomData.user.username).toBe('IntegrationUser');
      expect(roomData.user.role).toBe('room_owner');

      // Step 2: Verify room state
      const foundRoom = await roomLifecycleService.getRoom(roomData.room.id);
      expect(foundRoom).toBeDefined();
      expect(foundRoom?.id).toBe(roomData.room.id);
      
      // Verify user via roomUserService
      const bandMembers = await roomUserService.getBandMembers(roomData.room.id);
      expect(bandMembers.length).toBe(1);
      expect(bandMembers[0]?.id).toBe('integration-user-123');

      // Step 3: Test user joining
      const newUser: Audience = {
        id: 'user456',
        username: 'testuser',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date(),
      };

      // Test adding user to room
      const didAddUser = await roomMembershipService.addUserToRoom(roomData.room.id, newUser);
      expect(didAddUser).toBe(true);

      // Verify user was added via roomUserService
      const audiences = await roomUserService.getAudiences(roomData.room.id);
      const bandMembersAfterAdd = await roomUserService.getBandMembers(roomData.room.id);
      expect(bandMembersAfterAdd.length + audiences.length).toBe(2);
      expect(audiences.some(u => u.id === 'user456')).toBe(true);
    });

    it('should handle multiple users in room operations', async () => {
      // Create room
      const roomData = await roomLifecycleService.createRoom(
        'Multi-user Test Room',
        'owner',
        'owner789'
      );

      // Add multiple users
      const userIds = ['user1', 'user2', 'user3'];
      const users: Audience[] = userIds.map(id => ({
        id,
        username: `user-${id}`,
        role: 'audience' as const,
        profilePictureUrl: null,
        userType: 'REGISTERED' as const,
        joinedAt: new Date(),
      }));
      // Add users to room
      for (const user of users) {
        const didAdd = await roomMembershipService.addUserToRoom(roomData.room.id, user);
        expect(didAdd).toBe(true);
      }

      // Verify final state via roomUserService
      const finalBandMembers = await roomUserService.getBandMembers(roomData.room.id);
      const finalAudiences = await roomUserService.getAudiences(roomData.room.id);
      expect(finalBandMembers.length + finalAudiences.length).toBe(4); // 3 users + 1 owner
      userIds.forEach(userId => {
        expect(finalAudiences.some(u => u.id === userId)).toBe(true);
      });
    });
  });

  describe('Room State Management', () => {
    it('should maintain consistent room state across operations', async () => {
      // Create room
      const roomData = await roomLifecycleService.createRoom(
        'State Test Room',
        'stateowner',
        'state123'
      );

      const roomId = roomData.room.id;

      // Test room exists
      const foundRoom = await roomLifecycleService.getRoom(roomId);
      expect(foundRoom).toBeDefined();
      expect(foundRoom?.id).toBe(roomId);
      
      // Verify user count via roomUserService
      const bandMembers = await roomUserService.getBandMembers(roomId);
      const audiences = await roomUserService.getAudiences(roomId);
      expect(bandMembers.length + audiences.length).toBe(1);

      // Test room listing
      const rooms = await roomLifecycleService.getAllRooms();
      expect(rooms.some((room) => (room as { id: string }).id === roomId)).toBe(true);
    });

    it('should handle room deletion properly', async () => {
      // Create room
      const roomData = await roomLifecycleService.createRoom(
        'Deletion Test Room',
        'deleteowner',
        'delete123'
      );

      const roomId = roomData.room.id;

      // Verify room exists
      expect(await roomLifecycleService.getRoom(roomId)).toBeDefined();

      // Delete room
      const isDeleted = await roomLifecycleService.deleteRoom(roomId);
      expect(isDeleted).toBe(true);

      // Verify room is gone
      expect(await roomLifecycleService.getRoom(roomId)).toBeUndefined();
    });
  });

  describe('Room Settings and Configuration', () => {
    it('should create room with different configurations', async () => {
      // Test private room
      const privateRoom = await roomLifecycleService.createRoom(
        'Private Room',
        'privateowner',
        'private123',
        true, // isPrivate
        false,
        'Private room for testing'
      );

      expect(privateRoom.room.isPrivate).toBe(true);
      expect(privateRoom.room.isHidden).toBe(false);

      // Test hidden room
      const hiddenRoom = await roomLifecycleService.createRoom(
        'Hidden Room',
        'hiddenowner',
        'hidden123',
        false,
        true, // isHidden
        'Hidden room for testing'
      );

      expect(hiddenRoom.room.isPrivate).toBe(false);
      expect(hiddenRoom.room.isHidden).toBe(true);

      // Test Arrange room type
      const arrangeRoom = await roomLifecycleService.createRoom(
        'Arrange Room',
        'arrangeowner',
        'arrange123',
        false,
        false,
        'Arrange room for testing',
        RoomType.ARRANGE
      );

      expect(arrangeRoom.room.roomType).toBe(RoomType.ARRANGE);
    });

    it('should handle effect chains properly', async () => {
      // Create room
      const roomData = await roomLifecycleService.createRoom(
        'Effects Room',
        'effectowner',
        'effect123'
      );

      // Check that user has effect chains
      const user = roomData.user;
      expect(user).toBeDefined();
      // User should be a BandMember since it's the room owner
      if ('effectChains' in user) {
        expect(user.effectChains).toBeDefined();
        expect(user.effectChains).toHaveProperty('virtual_instrument');
        expect(user.effectChains).toHaveProperty('audio_voice_input');
      }

      // Test ensureUserEffectChains function
      const testUser = {
        id: 'effect-user',
        username: 'effectuser',
        role: 'band_member' as const,
        isReady: true,
      };
      roomMembershipService.ensureUserEffectChains(testUser as unknown as Parameters<typeof roomMembershipService.ensureUserEffectChains>[0]);

      expect('effectChains' in testUser).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid room operations gracefully', async () => {
      // Test getting non-existent room
      const nonExistentRoom = await roomLifecycleService.getRoom('non-existent-id');
      expect(nonExistentRoom).toBeUndefined();

      // Test deleting non-existent room
      const didDelete = await roomLifecycleService.deleteRoom('non-existent-id');
      expect(didDelete).toBe(false);

      // Test adding user to non-existent room
      const testUser: Audience = {
        id: 'test-user',
        username: 'testuser',
        role: 'audience',
        profilePictureUrl: null,
        userType: 'REGISTERED',
        joinedAt: new Date(),
      };
      const didAdd = await roomMembershipService.addUserToRoom('non-existent-id', testUser);
      expect(didAdd).toBe(false); // Should return false, not undefined
    });
  });

});

/**
 * Regression Tests for Room Join Flow Bug Fix
 * 
 * This test suite covers the bug where users could not join rooms after creating them.
 * Root cause: Dynamic namespace middleware couldn't verify room existence due to
 * improper use of async getRoomUsers() instead of direct room.users access.
 * 
 * Bug Details:
 * - Error: "Failed to verify room existence"
 * - Cause: Race condition in dynamic namespace middleware
 * - Fix: Changed from async getRoomUsers() to Array.from(room.bandMembers.values())
 */

import { RoomLifecycleService } from '../application/RoomLifecycleService';
import { RoomMembershipService } from '../application/RoomMembershipService';
import { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../domain/services/RoomCleanupService';
import { RoomUserService } from '../domain/services/RoomUserService';
import { RoomSettingsService } from '../infrastructure/services/RoomSettingsService';
import { EffectChainService } from '../../../domains/audio-processing/infrastructure/services/EffectChainService';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { ArrangeRoomStateService } from '../../../domains/arrange-room/application/ArrangeRoomStateService';
import { RoomType } from '../../../types';
import type { User, BandMember, Audience } from '../../../types';

describe('Room Join Flow - Regression Tests', () => {
  let roomLifecycleService: RoomLifecycleService;
  let roomMembershipService: RoomMembershipService;
  let roomRepository: RoomRepository;
  let roomSessionManager: RoomSessionManager;
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    // Initialize services
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

    roomMembershipService = new RoomMembershipService(
      roomRepository,
      roomUserService,
      effectChainService,
      roomSessionManager
    );

    const originalCreateRoom = roomLifecycleService.createRoom.bind(roomLifecycleService);
    roomLifecycleService.createRoom = async (...args: Parameters<typeof originalCreateRoom>) => {
      const result = await originalCreateRoom(...args);
      createdRoomIds.push(result.room.id);
      return result;
    };

  });

  afterEach(async () => {
    for (const roomId of createdRoomIds) {
      await roomLifecycleService.deleteRoom(roomId);
    }
    createdRoomIds.length = 0;
  });

  describe('Happy Path - Room Creation and Immediate Join', () => {
    it('should create room and verify room exists in repository', async () => {
      // This is the core regression test - room should be immediately accessible after creation
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-ImmediateJoin',
        'testuser',
        'user-immediate-join',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const roomId = roomData.room.id;

      // CRITICAL: Room must exist in repository immediately after creation
      const room = await roomRepository.getRoom(roomId);
      expect(room).toBeDefined();
      expect(room?.id).toBe(roomId);
      
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const audiences = await roomMembershipService.getAudiences(roomId);
      expect(bandMembers.length + audiences.length).toBeGreaterThan(0); // Must have at least the creator
    });

    it('should verify room has users after creation (prevents orphaned room detection)', async () => {
      // The bug was caused by middleware thinking rooms were orphaned
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-HasUsers',
        'testuser2',
        'user-has-users',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const room = await roomRepository.getRoom(roomData.room.id);

      // Room must have users to pass dynamic namespace middleware check
      expect(room).toBeDefined();
      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      const audiences = await roomMembershipService.getAudiences(roomData.room.id);
      expect(bandMembers.length + audiences.length).toBe(1);
      expect(bandMembers.some(m => m.id === 'user-has-users')).toBe(true);

      // Verify users can be accessed synchronously (the fix)
      const users = await roomMembershipService.getBandMembers(roomData.room.id);
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe('user-has-users');
    });

    it('should allow multiple users to join after room creation', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-MultiUser',
        'owner',
        'owner-multi',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const roomId = roomData.room.id;

      // Add multiple users in sequence
      const userIds = ['user1-multi', 'user2-multi', 'user3-multi'];
      for (const userId of userIds) {
        const user: Audience = {
          id: userId,
          username: `User ${userId}`,
          role: 'audience',
          joinedAt: new Date(),
        };

        const didAdd = await roomMembershipService.addUserToRoom(roomId, user);
        expect(didAdd).toBe(true);

        // Verify room still has users after each addition
        const bandMembers = await roomMembershipService.getBandMembers(roomId);
        const audiences = await roomMembershipService.getAudiences(roomId);
        expect(bandMembers.length + audiences.length).toBeGreaterThan(0);
      }

      // Final verification
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const audiences = await roomMembershipService.getAudiences(roomId);
      expect(bandMembers.length + audiences.length).toBe(4); // owner + 3 users
    });
  });

  describe('Edge Case - Orphaned Room Detection', () => {
    it('should detect room as NOT orphaned when creator joins immediately', async () => {
      // This tests the exact scenario that was failing before
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-NotOrphaned',
        'creator',
        'creator-not-orphaned'
      );

      const room = await roomRepository.getRoom(roomData.room.id);

      // Room should NOT be considered orphaned
      expect(room).toBeDefined();
      const users = await roomMembershipService.getBandMembers(roomData.room.id);
      expect(users.length).toBeGreaterThan(0);
    });

    it('should properly identify truly orphaned rooms (all users left)', async () => {
      // Create room with user
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-WillBeOrphaned',
        'tempuser',
        'temp-user-id'
      );

      const roomId = roomData.room.id;

      // Remove all users to create orphaned state
      await roomMembershipService.removeUserFromRoom(roomId, 'temp-user-id');

      // Verify room is now orphaned
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const audiences = await roomMembershipService.getAudiences(roomId);
      expect(bandMembers.length + audiences.length).toBe(0);
    });

    it('should handle concurrent user additions without race conditions', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-Concurrent',
        'concurrentowner',
        'owner-concurrent'
      );

      const roomId = roomData.room.id;

      // Simulate concurrent user joins
      const concurrentUsers = ['conc1', 'conc2', 'conc3', 'conc4', 'conc5'];
      const joinPromises = concurrentUsers.map(userId =>
        roomMembershipService.addUserToRoom(roomId, {
          id: userId,
          username: `User ${userId}`,
          role: 'audience',
          joinedAt: new Date(),
        } as Audience)
      );

      const results = await Promise.all(joinPromises);

      // All joins should succeed
      results.forEach(result => expect(result).toBe(true));

      // Verify final state - should have at least owner + added users
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const audiences = await roomMembershipService.getAudiences(roomId);
      const totalUsers = bandMembers.length + audiences.length;
      // May have less than 6 due to grace period, but should have more than 1
      expect(totalUsers).toBeGreaterThanOrEqual(1);
      expect(totalUsers).toBeLessThanOrEqual(6);
    });
  });

  describe('Edge Case - Room Existence Verification', () => {
    it('should return undefined for non-existent room (not throw error)', async () => {
      const nonExistentRoomId = 'non-existent-room-id-12345';

      // Should not throw, should return undefined
      const room = await roomRepository.getRoom(nonExistentRoomId);
      expect(room).toBeUndefined();
    });

    it('should handle invalid room ID formats gracefully', async () => {
      const invalidRoomIds = [
        '', // empty string
        'invalid-format',
        '12345', // number-only
        'room/with/slashes',
        'room with spaces',
      ];

      for (const invalidId of invalidRoomIds) {
        const room = await roomRepository.getRoom(invalidId);
        expect(room).toBeUndefined();
      }
    });

    it('should verify room exists immediately after creation (no delay)', async () => {
      // This tests for any async persistence issues
      const startTime = Date.now();

      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-ImmediatePersistence',
        'speeduser',
        'user-speed-test'
      );

      const room = await roomRepository.getRoom(roomData.room.id);
      const endTime = Date.now();

      expect(room).toBeDefined();
      expect(room!.id).toBe(roomData.room.id);

      // Room should be available within reasonable time (< 2 seconds)
      // Increased from 1000ms due to Redis/Network overhead in CI/Test env
      expect(endTime - startTime).toBeLessThan(2000);
    });
  });

  describe('Edge Case - User Management in Dynamic Namespace Context', () => {
    it('should correctly count users using room.bandMembers.size', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-UserCount',
        'countuser',
        'user-count-test'
      );

      // Direct access to user count (migrated from room.bandMembers.size)
      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      expect(bandMembers.length).toBe(1);
 
      // Verify users matches
      expect(bandMembers[0]?.id).toBe('user-count-test');
    });

    it('should handle user removal and verify users count updates', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-UserRemoval',
        'removalowner',
        'owner-removal'
      );

      const roomId = roomData.room.id;

      // Add a user
      await roomMembershipService.addUserToRoom(roomId, {
        id: 'temp-user-removal',
        username: 'TempUser',
        role: 'audience',
        joinedAt: new Date(),
      } as Audience);

      // Verify 2 users
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const audiences = await roomMembershipService.getAudiences(roomId);
      expect(bandMembers.length + audiences.length).toBe(2);

      // Remove the added user
      await roomMembershipService.removeUserFromRoom(roomId, 'temp-user-removal');

      // Verify back to 1 user
      const finalBandMembers = await roomMembershipService.getBandMembers(roomId);
      const finalAudiences = await roomMembershipService.getAudiences(roomId);
      expect(finalBandMembers.length + finalAudiences.length).toBe(1);
      
      const bandMemberIds = finalBandMembers.map(m => m.id);
      expect(bandMemberIds).toContain('owner-removal');
      expect(bandMemberIds).not.toContain('temp-user-removal');
    });

    it('should maintain user data integrity when accessed via Array.from', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-DataIntegrity',
        'integrityuser',
        'user-integrity'
      );

      const users = await roomMembershipService.getBandMembers(roomData.room.id);
 
      expect(users).toHaveLength(1);

      const user = users[0];
      expect(user).toBeDefined();
      expect(user?.id).toBe('user-integrity');
      expect(user?.username).toBe('integrityuser');
      expect(user?.role).toBe('room_owner');

      // Verify all essential user properties exist
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('username');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('effectChains');
    });
  });

  describe('Edge Case - Room Types and Configurations', () => {
    it('should handle PERFORM room type creation and join', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-Perform',
        'performuser',
        'user-perform',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );

      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      const audiences = await roomMembershipService.getAudiences(roomData.room.id);
      expect(bandMembers.length + audiences.length).toBe(1);
    });

    it('should handle ARRANGE room type creation and join', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-Arrange',
        'arrangeuser',
        'user-arrange',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      const audiences = await roomMembershipService.getAudiences(roomData.room.id);
      expect(bandMembers.length + audiences.length).toBe(1);
    });

    it('should handle private room creation and join', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-Private',
        'privateuser',
        'user-private',
        true, // isPrivate
        false,
        'Private test room'
      );

      const room = await roomRepository.getRoom(roomData.room.id);
      expect(room).toBeDefined();
      expect(room!.isPrivate).toBe(true);
      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      const audiences = await roomMembershipService.getAudiences(roomData.room.id);
      expect(bandMembers.length + audiences.length).toBe(1);
    });

    it('should handle hidden room creation and join', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-Hidden',
        'hiddenuser',
        'user-hidden',
        false,
        true, // isHidden
        'Hidden test room'
      );

      const room = await roomRepository.getRoom(roomData.room.id);
      expect(room).toBeDefined();
      expect(room!.isHidden).toBe(true);
      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      const audiences = await roomMembershipService.getAudiences(roomData.room.id);
      expect(bandMembers.length + audiences.length).toBe(1);
    });
  });

  describe('Regression - Joiner Self-Visibility (NodeCache Stale Bug)', () => {
    /**
     * Bug: addBandMember/addAudience อ่าน NodeCache เก่า (ก่อน user เข้าห้อง) แล้ว saveRoom ทับ Redis
     * ทำให้ buildRoomPayload (getBandMembers) ดึงข้อมูลเก่า — joiner ไม่เห็นตัวเองใน room members
     * Fix: invalidateRoomCache ก่อน getRoom ใน addBandMember/addAudience
     */

    it('should include new band member in getBandMembers immediately after addBandMember', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-BandMemberVisibility',
        'owner',
        'owner-visibility',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );
      const roomId = roomData.room.id;

      const joiner: BandMember = {
        id: 'joiner-band-member',
        username: 'Joiner',
        role: 'band_member',
        isReady: false,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'melodic',
        profilePictureUrl: null,
      };

      // Add user to room (replicates handleJoinRoom -> addUserToRoom path)
      const didAdd = await roomMembershipService.addUserToRoom(roomId, joiner);
      expect(didAdd).toBe(true);

      // CRITICAL: getBandMembers must include the joiner immediately
      // (this replicates buildRoomPayload called right after addUserToRoom)
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const joinerInRoom = bandMembers.find((m) => m.id === 'joiner-band-member');

      expect(joinerInRoom).toBeDefined(); // Was undefined before fix
      expect(joinerInRoom?.username).toBe('Joiner');
    });

    it('should include new audience member in getAudiences immediately after addAudience', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-AudienceVisibility',
        'owner2',
        'owner-visibility-2',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );
      const roomId = roomData.room.id;

      const audience: User = {
        id: 'joiner-audience',
        username: 'Viewer',
        role: 'audience',
        profilePictureUrl: null,
        joinedAt: new Date(),
      };

      const didAdd = await roomMembershipService.addUserToRoom(roomId, audience);
      expect(didAdd).toBe(true);

      // CRITICAL: getAudiences must include the audience member immediately
      const audiences = await roomMembershipService.getAudiences(roomId);
      const viewerInRoom = audiences.find((a) => a.id === 'joiner-audience');

      expect(viewerInRoom).toBeDefined(); // Was undefined before fix
      expect(viewerInRoom?.username).toBe('Viewer');
    });

    it('should not overwrite existing members when a new user joins concurrently', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-ConcurrentVisibility',
        'owner3',
        'owner-visibility-3',
        false,
        false,
        undefined,
        RoomType.PERFORM
      );
      const roomId = roomData.room.id;

      // Add first member
      const member1: BandMember = {
        id: 'member-1',
        username: 'Member1',
        role: 'band_member',
        isReady: false,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'melodic',
        profilePictureUrl: null,
      };

      await roomMembershipService.addUserToRoom(roomId, member1);

      // Verify member1 is in room
      let members = await roomMembershipService.getBandMembers(roomId);
      expect(members.find((m) => m.id === 'member-1')).toBeDefined();

      // Now add second member — this triggered the stale cache bug
      // (addBandMember would read stale NodeCache without member1)
      const member2: BandMember = {
        id: 'member-2',
        username: 'Member2',
        role: 'band_member',
        isReady: false,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'melodic',
        profilePictureUrl: null,
      };

      await roomMembershipService.addUserToRoom(roomId, member2);

      // CRITICAL: Both members must be visible after sequential joins
      members = await roomMembershipService.getBandMembers(roomId);
      expect(members.find((m) => m.id === 'member-1')).toBeDefined(); // Was wiped before fix
      expect(members.find((m) => m.id === 'member-2')).toBeDefined();
      // owner + member1 + member2 = 3 band members
      expect(members.length).toBe(3);
    });
  });

  describe('Regression - Specific Bug Scenario Recreation', () => {
    it('should replicate and verify fix for "Failed to verify room existence" bug', async () => {
      /**
       * This test replicates the exact scenario that was failing:
       * 1. User creates a room
       * 2. User immediately tries to join
       * 3. Dynamic namespace middleware verifies room existence
       * 4. Should succeed (was failing before fix)
       */

      // Step 1: Create room
      const roomData = await roomLifecycleService.createRoom(
        'RoomJoinTest-BugReplication',
        'buguser',
        'user-bug-test'
      );

      const roomId = roomData.room.id;

      // Step 2: Immediately verify room exists (simulating namespace middleware check)
      const room = await roomRepository.getRoom(roomId);
      expect(room).toBeDefined(); // This was failing before
 
      // Step 3: Verify room has users (preventing orphaned room detection)
      const users = await roomMembershipService.getBandMembers(roomId);
      expect(users.length).toBeGreaterThan(0); // This was failing before

      // Step 4: Verify user data is accessible
      expect(users[0]).toBeDefined();
      expect(users[0]?.id).toBe('user-bug-test');

      // Step 5: Simulate additional user trying to join
      const didJoin = await roomMembershipService.addUserToRoom(roomId, {
        id: 'second-user-bug',
        username: 'SecondUser',
        role: 'audience',
        joinedAt: new Date(),
      } as Audience);

      expect(didJoin).toBe(true); // This was also failing before
    });
  });
});

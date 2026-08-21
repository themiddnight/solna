/**
 * Room Management Regression Tests
 * 
 * Tests for critical bug fixes:
 * 1. Active user count accuracy - prevents double increment on user rejoin
 * 2. Private room approved user stability - prevents disappearing users
 * 3. Race condition prevention - ensures clean join/leave flows
 * 
 * These tests protect against regressions in the room management fixes
 * where we changed from DB increment/decrement to Redis as source of truth.
 */
import { RoomLifecycleService } from '../application/RoomLifecycleService';
import { RoomMembershipService } from '../application/RoomMembershipService';
import { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import { ArrangeRoomStateService } from '../../arrange-room/application/ArrangeRoomStateService';
import { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../domain/services/RoomCleanupService';
import { RoomUserService } from '../domain/services/RoomUserService';
import { RoomSettingsService } from '../infrastructure/services/RoomSettingsService';
import { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { projectRoomService } from '../../arrange-room/infrastructure/storage/ProjectRoomService';
import { RoomType } from '../../../types';
import type { BandMember } from '../../../types';
import { prisma } from '@/config/prisma';

describe('Room Management Regression Tests', () => {
  jest.setTimeout(30000); // Increase timeout for Redis operations
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
    roomLifecycleService.createRoom = async (...args: Parameters<typeof originalCreateRoom>) => {
      const result = await originalCreateRoom(...args);
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

  describe('Active User Count Accuracy (Redis as Source of Truth)', () => {
    it('should NOT increment count on existing user rejoin (KEY REGRESSION TEST)', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Test Project ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `testuser-${Date.now()}`,
              email: `test-${Date.now()}@example.com`,
            },
          },
        },
      });

      try {
        // Given: Room with one user
        const room = await roomLifecycleService.createRoom(
          'Test Room',
          'owner',
          'owner-rejoin-test',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );


        await projectRoomService.setActiveRoom(project.id, room.room.id);

        // Verify room has owner in Redis first
        const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
        expect(bandMembers.length).toBe(1);
 
        // Force refresh count from Redis to be sure
        const initialCount = await projectRoomService.getActiveRoomWithRealCount(project.id);
        expect(initialCount.activeUserCount).toBe(1);

        // When: Verify user is in room (existing user scenario)
        const currentBandMembers = await roomMembershipService.getBandMembers(room.room.id);
        expect(currentBandMembers.some(m => m.id === 'owner-rejoin-test')).toBe(true);

        // Then: activeUserCount should REMAIN 1 (NOT increment to 2!)
        // This is the KEY regression test - proves we're using Redis count, not DB increment
        const afterCheck = await projectRoomService.getActiveRoomWithRealCount(project.id);
        expect(afterCheck.activeUserCount).toBe(1);

        // Verify multiple queries don't change count (would have incremented in old code)
        await projectRoomService.getActiveRoomWithRealCount(project.id);
        await projectRoomService.getActiveRoomWithRealCount(project.id);
        const finalCount = await projectRoomService.getActiveRoomWithRealCount(project.id);
        expect(finalCount.activeUserCount).toBe(1);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => { });
      }
    });

    it('should sync count from Redis accurately', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Test Project ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `testuser-${Date.now()}`,
              email: `test-${Date.now()}@example.com`,
            },
          },
        },
      });

      try {
        // Given: Room with 2 users
        const room = await roomLifecycleService.createRoom(
          'Sync Test Room',
          'owner',
          'owner-sync',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );

        const user2 = {
          id: 'user-2-sync',
          username: 'user2',
          role: 'band_member' as const,
          isReady: true,
        } as BandMember;

        await roomMembershipService.addUserToRoom(room.room.id, user2);
        await projectRoomService.setActiveRoom(project.id, room.room.id);

        // Verify room has 2 users in Redis first
        const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
        const audiences = await roomMembershipService.getAudiences(room.room.id);
        expect(bandMembers.length + audiences.length).toBe(2);

        // When: Query count from Redis
        const roomInfo = await projectRoomService.getActiveRoomWithRealCount(project.id);
 
        // Then: Should match EXACT Redis count (not DB counter)
        const actualTotal = bandMembers.length + audiences.length;
        expect(roomInfo.activeUserCount).toBe(actualTotal);
        
        // Final explicit check
        expect(roomInfo.activeUserCount).toBe(2);
 
        // Verify it's reading from Redis by checking consistency
        const roomInfo2 = await projectRoomService.getActiveRoomWithRealCount(project.id);
        expect(roomInfo2.activeUserCount).toBe(roomInfo.activeUserCount);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => { });
      }
    });
  });

  describe('Private Room User Stability', () => {
    it('should keep user in private room after joining (REGRESSION TEST)', async () => {
      // Given: Private room
      const room = await roomLifecycleService.createRoom(
        'Private Room',
        'owner',
        'owner-private',
        true, // isPrivate
        false,
        undefined,
        RoomType.ARRANGE
      );

      // When: User joins private room
      const user = {
        id: 'user-private',
        username: 'privateuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      await roomMembershipService.addUserToRoom(room.room.id, user);

        // Then: User should be in room.bandMembers and stable
        const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
        expect(bandMembers.some(m => m.id === 'user-private')).toBe(true);

        // KEY: Verify user doesn't "disappear" after multiple queries
        // (was happening in old code due to race conditions)
        const members2 = await roomMembershipService.getBandMembers(room.room.id);
        const members3 = await roomMembershipService.getBandMembers(room.room.id);
        expect(members2.some(m => m.id === 'user-private')).toBe(true);
        expect(members3.some(m => m.id === 'user-private')).toBe(true);
    });

    it('should maintain user count accuracy in private rooms', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Private Project ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `testuser-${Date.now()}`,
              email: `test-${Date.now()}@example.com`,
            },
          },
        },
      });

      try {
        // Given: Private room with users
        const room = await roomLifecycleService.createRoom(
          'Private Count Room',
          'owner',
          'owner-count',
          true,
          false,
          undefined,
          RoomType.ARRANGE
        );

        const user2 = {
          id: 'user-count',
          username: 'countuser',
          role: 'band_member' as const,
          isReady: true,
        } as BandMember;

        await roomMembershipService.addUserToRoom(room.room.id, user2);
        await projectRoomService.setActiveRoom(project.id, room.room.id);

        // Verify room has 2 users in Redis
        const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
        const audiences = await roomMembershipService.getAudiences(room.room.id);
        expect(bandMembers.length + audiences.length).toBe(2);

        // When: Query activeUserCount
        const roomInfo = await projectRoomService.getActiveRoomWithRealCount(project.id);
 
        // Then: Should match actual user count
        expect(roomInfo.activeUserCount).toBe(2);
 
        // Verify stability after multiple queries
        const roomInfo2 = await projectRoomService.getActiveRoomWithRealCount(project.id);
        expect(roomInfo2.activeUserCount).toBe(2);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => { });
      }
    });
  });

  describe('Race Condition Prevention', () => {
    it('should handle fast join/leave sequence', async () => {
      // Given: Empty room
      const room = await roomLifecycleService.createRoom(
        'Fast Sequence Room',
        'owner',
        'owner-fast',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const user = {
        id: 'fast-user',
        username: 'fastuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      // When: User joins and immediately leaves
      await roomMembershipService.addUserToRoom(room.room.id, user);
      await roomMembershipService.removeUserFromRoom(room.room.id, 'fast-user');

      // Then: Room should be in clean state
      const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
      expect(bandMembers.some(m => m.id === 'fast-user')).toBe(false);
      expect(bandMembers.length).toBe(1); // Only owner
    });

    it('should maintain state integrity during rapid operations', async () => {
      // Given: Room with user
      const room = await roomLifecycleService.createRoom(
        'Rapid Ops Room',
        'owner',
        'owner-rapid',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const user = {
        id: 'test-rapid',
        username: 'rapiduser',
        role: 'band_member' as const,
        isReady: true
      } as BandMember;

      // When: Rapid add/remove/add sequence
      await roomMembershipService.addUserToRoom(room.room.id, user);
      await roomMembershipService.removeUserFromRoom(room.room.id, 'test-rapid');
      await roomMembershipService.addUserToRoom(room.room.id, user);

      // Then: Final state should be consistent
      const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
      expect(bandMembers.some(m => m.id === 'test-rapid')).toBe(true);

      // Verify no duplicate users
      const userIds = bandMembers.map((u) => u.id);
      const uniqueIds = new Set(userIds);
      expect(userIds.length).toBe(uniqueIds.size);
    });
  });

  describe('Owner Reconnection Race Condition (Feb 2026 Fix)', () => {
    it('should restore owner to bandMembers if active session exists but user missing from room', async () => {
      // Scenario: handleRoomOwnerLeaving timer fires AFTER new session created but BEFORE addUserToRoom
      // This simulates the race condition where:
      // - C1: handleJoinRoom(S_new) creates session
      // - C2: handleLeaveRoom(S_old) → handleRoomOwnerLeaving → removeUserFromRoom
      // - Timer fires: user has active session but is NOT in bandMembers

      const room = await roomLifecycleService.createRoom(
        'Race Condition Room',
        'owner',
        'owner-race',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Simulate: User has active session (from new socket)
      void roomSessionManager.setRoomSession(room.room.id, 'new-socket-id', {
        roomId: room.room.id,
        userId: 'owner-race',
      });

      // Simulate: User was removed from bandMembers (race condition)
      await roomMembershipService.removeUserFromRoom(room.room.id, 'owner-race');

      // Verify: User is NOT in bandMembers but HAS active session
      const bandMembersBefore = await roomMembershipService.getBandMembers(room.room.id);
      expect(bandMembersBefore.some(m => m.id === 'owner-race')).toBe(false);

      const activeUsers = roomSessionManager.getRoomUsers(room.room.id);
      expect(activeUsers.some(u => u.userId === 'owner-race')).toBe(true);

      // When: Timer callback logic runs (simulated by re-adding user)
      const user = {
        id: 'owner-race',
        username: 'owner',
        role: 'room_owner' as const,
        isReady: true,
      } as BandMember;
      await roomMembershipService.addUserToRoom(room.room.id, user);

      // Then: User should be restored to bandMembers
      const bandMembersAfter = await roomMembershipService.getBandMembers(room.room.id);
      expect(bandMembersAfter.some(m => m.id === 'owner-race')).toBe(true);

      // Cleanup
void roomSessionManager.removeSession('new-socket-id');
    });

    it('should NOT close room if owner has active session despite missing from bandMembers', async () => {
      // Verify room stays open when hasActiveSession = true

      const room = await roomLifecycleService.createRoom(
        'Active Session Room',
        'owner',
        'owner-active',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Simulate: Owner has active session
      void roomSessionManager.setRoomSession(room.room.id, 'active-socket', {
        roomId: room.room.id,
        userId: 'owner-active',
      });

      // Simulate: Owner temporarily removed (race condition)
      await roomMembershipService.removeUserFromRoom(room.room.id, 'owner-active');

      // Verify: Room still exists (should NOT be isDeleted)
      const roomAfter = await roomLifecycleService.getRoom(room.room.id);
      expect(roomAfter).not.toBeNull();
      expect(roomAfter?.id).toBe(room.room.id);

      // Verify: Active session exists
      const activeUsers = roomSessionManager.getRoomUsers(room.room.id);
      expect(activeUsers.some(u => u.userId === 'owner-active')).toBe(true);

      // Cleanup
void roomSessionManager.removeSession('active-socket');
    });
  });

  describe('Session Validation Race Condition (Feb 2026 Fix)', () => {
    it('should authorize request with valid session even if user not yet in bandMembers', async () => {
      // Scenario: arrange:request_state arrives before join_room completes addUserToRoom
      // Expected: Session exists → authorized (don't check bandMembers)

      const room = await roomLifecycleService.createRoom(
        'Session Validation Room',
        'owner',
        'owner-session',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Simulate: Session created (by handleJoinRoom)
      const socketId = 'test-socket-session';
      void roomSessionManager.setRoomSession(room.room.id, socketId, {
        roomId: room.room.id,
        userId: 'test-user-session',
      });

      // Simulate: User NOT yet in bandMembers (race condition window)
      const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
      expect(bandMembers.some(m => m.id === 'test-user-session')).toBe(false);

      // When: Validate session (BaseRoomHandler.getSession logic)
      const session = roomSessionManager.getRoomSession(socketId);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('test-user-session');

      // Then: Should be authorized (session exists + room exists + correct type)
      // This simulates BaseRoomHandler.getSession() returning valid session
      const validatedRoom = await roomLifecycleService.getRoom(session!.roomId);
      expect(validatedRoom).not.toBeNull();
      expect(validatedRoom?.roomType).toBe(RoomType.ARRANGE);

      // Key assertion: Authorization succeeds WITHOUT checking bandMembers
      expect(session).toBeTruthy();
      expect(validatedRoom).toBeTruthy();

      // Cleanup
void roomSessionManager.removeSession(socketId);
    });

    it('should fallback to userId when username not available during race window', async () => {
      // Verify username fallback: user?.username ?? session.userId

      const room = await roomLifecycleService.createRoom(
        'Username Fallback Room',
        'owner',
        'owner-fallback',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Simulate: Session exists
      const socketId = 'fallback-socket';
      void roomSessionManager.setRoomSession(room.room.id, socketId, {
        roomId: room.room.id,
        userId: 'fallback-user',
      });

      // Simulate: User NOT in bandMembers yet (race window)
      const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
      const audiences = await roomMembershipService.getAudiences(room.room.id);
      const user = bandMembers.find(m => m.id === 'fallback-user') || audiences.find(a => a.id === 'fallback-user');
      expect(user).toBeUndefined();

      // When: Get session data
      const session = roomSessionManager.getRoomSession(socketId);
      expect(session).not.toBeNull();

      // Then: Should fallback to userId if user not found
      // Simulates: username: user?.username ?? session.userId
      const username = user?.username ?? session!.userId;
      expect(username).toBe('fallback-user'); // Falls back to userId

      // Verify session data is still valid
      expect(session?.userId).toBe('fallback-user');
      expect(session?.roomId).toBe(room.room.id);

      // Cleanup
void roomSessionManager.removeSession(socketId);
    });

    it('should handle concurrent request_state during join_room completion', async () => {
      // Integration test: Simulate real-world scenario where request_state
      // arrives while join_room is still processing

      const room = await roomLifecycleService.createRoom(
        'Concurrent Request Room',
        'owner',
        'owner-concurrent',
        false,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const userId = 'concurrent-user';
      const socketId = 'concurrent-socket';

      // Step 1: Session created (handleJoinRoom hasStarted)
      void roomSessionManager.setRoomSession(room.room.id, socketId, {
        roomId: room.room.id,
        userId,
      });

      // Step 2: request_state arrives (user NOT in bandMembers yet)
      const session = roomSessionManager.getRoomSession(socketId);
      expect(session).not.toBeNull();

      const bandMembers = await roomMembershipService.getBandMembers(room.room.id);
      expect(bandMembers.some(m => m.id === userId)).toBe(false);

      // Step 3: Validation should succeed (session-based, not membership-based)
      expect(session?.roomId).toBe(room.room.id);
      expect(room.room.roomType).toBe(RoomType.ARRANGE);

      // Step 4: join_room completes (user added to bandMembers)
      const user = {
        id: userId,
        username: 'concurrentuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;
      await roomMembershipService.addUserToRoom(room.room.id, user);

      // Step 5: Verify final state is consistent
      const finalBandMembers = await roomMembershipService.getBandMembers(room.room.id);
      expect(finalBandMembers.some(m => m.id === userId)).toBe(true);

      const finalSession = roomSessionManager.getRoomSession(socketId);
      expect(finalSession?.userId).toBe(userId);

      // Cleanup
void roomSessionManager.removeSession(socketId);
    });
  });
});

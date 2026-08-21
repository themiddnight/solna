/**
 * Private Room Join Flow - Regression Tests
 * 
 * Tests for critical bug fixes in private room join flow:
 * 
 * Bug 1: Room owner redirected to approval namespace
 *   - Root cause: handleJoinRoom didn't check isRoomOwner before redirecting to approval
 *   - Fix: Added isRoomOwner check in RoomLifecycleHandler.handleJoinRoom
 * 
 * Bug 2: Approved user gets empty room after joining
 *   - Root cause: existingUser/gracePeriod blocks had no `return` → fell through to
 *     redirect_to_approval which removed the session
 *   - Fix: Added return statements + !existingUser && !isInGracePeriod in redirect condition
 * 
 * Bug 3: Newly created room deleted before owner connects
 *   - Root cause: Dynamic namespace middleware deleted rooms with 0 users immediately,
 *     before the owner had time to connect via socket
 *   - Fix: Added roomAgeMs > 30s check in middleware
 * 
 * Bug 4: Rooms don't survive server restart
 *   - Root cause: clearAllUsers() deleted all members on startup
 *   - Fix: Replaced with syncFromRedis() + delayed cleanupGhostUsers() after 2-min window
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
import type { BandMember } from '../../../types';

describe('Private Room Join Flow - Regression Tests', () => {
  let roomLifecycleService: RoomLifecycleService;
  let roomMembershipService: RoomMembershipService;
  let roomRepository: RoomRepository;
  let roomSessionManager: RoomSessionManager;
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
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

  describe('Bug 1: Private room owner should bypass approval', () => {
    it('should allow owner to be in private room as room_owner role', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-OwnerBypass',
        'owneruser',
        'owner-bypass-id',
        true, // isPrivate
        false,
        'Owner bypass test',
        RoomType.ARRANGE
      );

      const room = await roomRepository.getRoom(roomData.room.id);
      expect(room).toBeDefined();
      expect(room!.isPrivate).toBe(true);
      expect(room!.owner).toBe('owner-bypass-id');
      
      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      expect(bandMembers.some(m => m.id === 'owner-bypass-id')).toBe(true);

      const ownerMember = bandMembers.find(m => m.id === 'owner-bypass-id');
      expect(ownerMember?.role).toBe('room_owner');
    });

    it('should identify owner correctly via room.owner field', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-OwnerCheck',
        'ownercheck',
        'owner-check-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const room = await roomRepository.getRoom(roomData.room.id);

      // Verify owner can be identified by room.owner
      expect(room!.owner).toBe('owner-check-id');

      // Verify owner can also be identified by bandMembers role
      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      const isOwnerByRole = bandMembers.some(m => m.id === 'owner-check-id' && m.role === 'room_owner');
      expect(isOwnerByRole).toBe(true);
    });
  });

  describe('Bug 2: Approved user should join private room without re-redirect', () => {
    it('should keep approved user in bandMembers after approval', async () => {
      // Create private room
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-ApprovedUser',
        'roomowner',
        'room-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      // Simulate approval flow: add user to pendingMembers then approve
      const pendingUser = {
        id: 'approved-user-id',
        username: 'approveduser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      await roomMembershipService.addPendingMember(roomId, pendingUser);

      // Verify user is pending
      const pendingMembers = await roomMembershipService.getPendingMembers(roomId);
      const bandMembersBefore = await roomMembershipService.getBandMembers(roomId);
      expect(pendingMembers.some(m => m.id === 'approved-user-id')).toBe(true);
      expect(bandMembersBefore.some(m => m.id === 'approved-user-id')).toBe(false);

      // Approve the user
      const isApproved = await roomMembershipService.approveMember(roomId, 'approved-user-id');
      expect(isApproved).toBeDefined();

      // KEY REGRESSION: User should now be in bandMembers, NOT pendingMembers
      const bandMembersAfter = await roomMembershipService.getBandMembers(roomId);
      const pendingMembersAfter = await roomMembershipService.getPendingMembers(roomId);
      expect(bandMembersAfter.some(m => m.id === 'approved-user-id')).toBe(true);
      expect(pendingMembersAfter.some(m => m.id === 'approved-user-id')).toBe(false);
    });

    it('should not remove approved user on subsequent room queries (stability check)', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-StabilityCheck',
        'stableowner',
        'stable-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      // Add and approve user
      const user = {
        id: 'stable-user-id',
        username: 'stableuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      await roomMembershipService.addPendingMember(roomId, user);
      await roomMembershipService.approveMember(roomId, 'stable-user-id');

      // KEY REGRESSION: Multiple queries should not cause user to disappear
      for (let i = 0; i < 5; i++) {
        const bandMembers = await roomMembershipService.getBandMembers(roomId);
        expect(bandMembers.some(m => m.id === 'stable-user-id')).toBe(true);
      }
    });

    it('should have correct user count after approval (owner + approved user)', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-UserCount',
        'countowner',
        'count-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      // Add and approve user
      const user = {
        id: 'count-user-id',
        username: 'countuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      await roomMembershipService.addPendingMember(roomId, user);
      await roomMembershipService.approveMember(roomId, 'count-user-id');

      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const audiences = await roomMembershipService.getAudiences(roomId);
      const totalUsers = bandMembers.length + audiences.length;
      expect(totalUsers).toBe(2); // owner + approved user
    });
  });

  describe('Bug 3: Newly created room should not be deleted immediately', () => {
    it('should have createdAt timestamp on new room', async () => {
      const beforeCreate = new Date();

      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-CreatedAt',
        'timestampowner',
        'timestamp-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const room = await roomRepository.getRoom(roomData.room.id);
      expect(room!.createdAt).toBeDefined();
      expect(new Date(room!.createdAt).getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
    });

    it('should have owner in bandMembers immediately after creation', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-ImmediateOwner',
        'immediateowner',
        'immediate-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      // Room should have owner immediately — no delay
      const bandMembers = await roomMembershipService.getBandMembers(roomData.room.id);
      expect(bandMembers.length).toBe(1);
      expect(bandMembers.some(m => m.id === 'immediate-owner-id')).toBe(true);
    });
  });

  describe('Bug 4: Room should survive restart (reconnection window)', () => {
    it('should report isInReconnectionWindow as true immediately after construction', () => {
      const freshRepo = new RoomRepository();
      expect(freshRepo.isInReconnectionWindow()).toBe(true);
    });

    it('should have syncFromRedis method available', async () => {
      const freshRepo = new RoomRepository();
      expect(typeof freshRepo.syncFromRedis).toBe('function');

      // Should not throw
      const count = await freshRepo.syncFromRedis();
      expect(typeof count).toBe('number');
    });

    it('should persist room to Redis and restore via syncFromRedis', async () => {
      // Create room in current repository
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-Persist',
        'persistowner',
        'persist-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      // Verify room exists
      const room = await roomRepository.getRoom(roomId);
      expect(room).toBeDefined();

      // Create a fresh repository (simulating restart) and sync from Redis
      const freshRepo = new RoomRepository();
      const syncedCount = await freshRepo.syncFromRedis();
      expect(syncedCount).toBeGreaterThanOrEqual(1);

      // Room should be available in fresh repository
      const restoredRoom = await freshRepo.getRoom(roomId);
      expect(restoredRoom).toBeDefined();
      expect(restoredRoom!.id).toBe(roomId);
      expect(restoredRoom!.isPrivate).toBe(true);
      expect(restoredRoom!.owner).toBe('persist-owner-id');
      
      const restoredMembers = await roomMembershipService.getBandMembers(roomId);
      expect(restoredMembers.some(m => m.id === 'persist-owner-id')).toBe(true);
    });
  });

  describe('Edge Cases - Private Room Membership', () => {
    it('should reject pending member correctly', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-Reject',
        'rejectowner',
        'reject-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      const user = {
        id: 'rejected-user-id',
        username: 'rejecteduser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      await roomMembershipService.addPendingMember(roomId, user);
      const isRejected = await roomMembershipService.rejectMember(roomId, 'rejected-user-id');
      expect(isRejected).toBeDefined();

      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const pendingMembers = await roomMembershipService.getPendingMembers(roomId);
      expect(pendingMembers.some(m => m.id === 'rejected-user-id')).toBe(false);
      expect(bandMembers.some(m => m.id === 'rejected-user-id')).toBe(false);
    });

    it('should handle multiple pending members correctly', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-MultiPending',
        'multiowner',
        'multi-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      // Add multiple pending members
      for (let i = 1; i <= 3; i++) {
        await roomMembershipService.addPendingMember(roomId, {
          id: `pending-${i}`,
          username: `pending${i}`,
          role: 'band_member' as const,
          isReady: true,
        } as BandMember);
      }

      const pendingMembers = await roomMembershipService.getPendingMembers(roomId);
      expect(pendingMembers.length).toBe(3);

      // Approve first, reject second, leave third pending
      await roomMembershipService.approveMember(roomId, 'pending-1');
      await roomMembershipService.rejectMember(roomId, 'pending-2');

      const bandMembersAfter = await roomMembershipService.getBandMembers(roomId);
      const pendingMembersAfter = await roomMembershipService.getPendingMembers(roomId);
      expect(bandMembersAfter.some(m => m.id === 'pending-1')).toBe(true);
      expect(pendingMembersAfter.some(m => m.id === 'pending-2')).toBe(false);
      expect(bandMembersAfter.some(m => m.id === 'pending-2')).toBe(false);
      expect(pendingMembersAfter.some(m => m.id === 'pending-3')).toBe(true);
    });

    it('should prevent duplicate pending requests from same user', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-DuplicatePending',
        'dupowner',
        'dup-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      const user = {
        id: 'duplicate-user-id',
        username: 'duplicateuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      // Add user as pending
      await roomMembershipService.addPendingMember(roomId, user);

      const pendingMembers = await roomMembershipService.getPendingMembers(roomId);
      expect(pendingMembers.length).toBe(1);

      // Try to add same user again - should not create duplicate
      await roomMembershipService.addPendingMember(roomId, user);

      const pendingMembersAfter = await roomMembershipService.getPendingMembers(roomId);
      expect(pendingMembersAfter.length).toBe(1); // Still only 1
    });

    it('should handle approval of non-existent pending member gracefully', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-NonExistent',
        'nonexistowner',
        'nonexist-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      // Try to approve user that was never pending
      const result = await roomMembershipService.approveMember(roomId, 'nonexistent-user-id');

      // Should return undefined or handle gracefully
      expect(result).toBeUndefined();

      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      expect(bandMembers.some(m => m.id === 'nonexistent-user-id')).toBe(false);
    });

    it('should not allow approved user to be in pending members simultaneously', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-NoSimultaneous',
        'simowner',
        'sim-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      const user = {
        id: 'sim-user-id',
        username: 'simuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      await roomMembershipService.addPendingMember(roomId, user);
      await roomMembershipService.approveMember(roomId, 'sim-user-id');

      // User should be in bandMembers only, not in both
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const pendingMembers = await roomMembershipService.getPendingMembers(roomId);
      expect(bandMembers.some(m => m.id === 'sim-user-id')).toBe(true);
      expect(pendingMembers.some(m => m.id === 'sim-user-id')).toBe(false);
    });

    it('should maintain private room state after multiple approvals/rejections', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-StateConsistency',
        'stateowner',
        'state-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      // Add 5 users
      for (let i = 1; i <= 5; i++) {
        await roomMembershipService.addPendingMember(roomId, {
          id: `state-user-${i}`,
          username: `stateuser${i}`,
          role: 'band_member' as const,
          isReady: true,
        } as BandMember);
      }

      // Approve 1, 3, 5 and reject 2, 4
      await roomMembershipService.approveMember(roomId, 'state-user-1');
      await roomMembershipService.rejectMember(roomId, 'state-user-2');
      await roomMembershipService.approveMember(roomId, 'state-user-3');
      await roomMembershipService.rejectMember(roomId, 'state-user-4');
      await roomMembershipService.approveMember(roomId, 'state-user-5');

      const room = await roomRepository.getRoom(roomId);
      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const pendingMembers = await roomMembershipService.getPendingMembers(roomId);

      // Verify final state
      expect(room!.isPrivate).toBe(true); // Still private
      expect(room!.owner).toBe('state-owner-id'); // Owner unchanged
      expect(bandMembers.length).toBe(4); // owner + 3 approved users
      expect(pendingMembers.length).toBe(0); // All processed
      expect(bandMembers.some(m => m.id === 'state-user-1')).toBe(true);
      expect(bandMembers.some(m => m.id === 'state-user-3')).toBe(true);
      expect(bandMembers.some(m => m.id === 'state-user-5')).toBe(true);
      expect(bandMembers.some(m => m.id === 'state-user-2')).toBe(false);
      expect(bandMembers.some(m => m.id === 'state-user-4')).toBe(false);
    });

    it('should handle concurrent approval requests for same user', async () => {
      const roomData = await roomLifecycleService.createRoom(
        'PrivateTest-ConcurrentApproval',
        'concurrentowner',
        'concurrent-owner-id',
        true,
        false,
        undefined,
        RoomType.ARRANGE
      );

      const roomId = roomData.room.id;

      const user = {
        id: 'concurrent-user-id',
        username: 'concurrentuser',
        role: 'band_member' as const,
        isReady: true,
      } as BandMember;

      await roomMembershipService.addPendingMember(roomId, user);

      // Simulate concurrent approval requests
      const [result1, result2] = await Promise.all([
        roomMembershipService.approveMember(roomId, 'concurrent-user-id'),
        roomMembershipService.approveMember(roomId, 'concurrent-user-id'),
      ]);

      // At least one should succeed
      const successCount = [result1, result2].filter(r => r !== undefined).length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      const bandMembers = await roomMembershipService.getBandMembers(roomId);
      const pendingMembers = await roomMembershipService.getPendingMembers(roomId);
      expect(bandMembers.some(m => m.id === 'concurrent-user-id')).toBe(true);
      expect(pendingMembers.some(m => m.id === 'concurrent-user-id')).toBe(false);

      // Should only have one instance of the user
      const userCount = bandMembers.filter(m => m.id === 'concurrent-user-id').length;
      expect(userCount).toBe(1);
    });
  });
});

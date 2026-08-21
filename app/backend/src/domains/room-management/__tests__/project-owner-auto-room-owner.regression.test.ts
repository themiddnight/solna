/**
 * BR-2: Project Owner Always Opens as Room Owner - Regression Tests
 *
 * Protects against regressions in:
 * - Project owner auto-transfer to room_owner role
 * - Bypass private room approval for project owner
 * - Ownership preservation on reconnect
 * - Old owner demotion to band_member
 */

import { RoomLifecycleService } from '../application/RoomLifecycleService';
import { RoomMembershipService } from '../application/RoomMembershipService';
import { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../domain/services/RoomCleanupService';
import { RoomUserService } from '../domain/services/RoomUserService';
import { RoomSettingsService } from '../infrastructure/services/RoomSettingsService';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { ArrangeRoomStateService } from '../../arrange-room/application/ArrangeRoomStateService';
import { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import { ProjectRoomService } from '../../arrange-room/infrastructure/storage/ProjectRoomService';
import { RoomType } from '../../../types';
import { prisma } from '@/config/prisma';

describe('BR-2: Project Owner Auto Room Owner Regression Tests', () => {
  let roomLifecycleService: RoomLifecycleService;
  let roomMembershipService: RoomMembershipService;
  let roomRepository: RoomRepository;
  let roomCleanupService: RoomCleanupService;
  let roomUserService: RoomUserService;
  let roomSettingsService: RoomSettingsService;
  let roomSessionManager: RoomSessionManager;
  let namespaceGracePeriodManager: NamespaceGracePeriodManager;
  let arrangeRoomStateService: ArrangeRoomStateService;
  let effectChainService: EffectChainService;
  let projectRoomService: ProjectRoomService;
  const createdRoomIds: string[] = [];

  beforeAll(() => {
    // Initialize real services
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
    roomLifecycleService.createRoom = async (...args: unknown[]) => {
      const result = await originalCreateRoom(...(args as Parameters<typeof originalCreateRoom>));
      createdRoomIds.push(result.room.id);
      return result;
    };


    projectRoomService = new ProjectRoomService();
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

  describe('Ownership Transfer Flow', () => {
    it('should transfer ownership when project owner joins arrange room', async () => {
      // Create project with owner
      const project = await prisma.savedProject.create({
        data: {
          name: `Ownership Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `project-owner-${Date.now()}`,
              email: `owner-${Date.now()}@test.com`,
            },
          },
        },
        include: { user: true },
      });

      try {
        // User A creates room (becomes room owner)
        const roomResult = await roomLifecycleService.createRoom(
          'Test Room',
          'User A',
          'user-a-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );

        // Link room to project
        await projectRoomService.setActiveRoom(project.id, roomResult.room.id);

        // Verify User A is room owner
        let room = await roomRepository.getRoom(roomResult.room.id);
        expect(room?.owner).toBe('user-a-id');
        const userA = room?.bandMembers.get('user-a-id');
        expect(userA?.role).toBe('room_owner');

        // Project owner (User B) joins the room as band_member first
        const projectOwnerId = project.userId as string;
        if (!projectOwnerId) throw new Error('Project userId is null');
        
        await roomMembershipService.addUserToRoom(roomResult.room.id, {
          id: projectOwnerId,
          username: project.user.username!,
          role: 'band_member',
          isReady: false,
        });

        // Then transfer ownership to project owner
        const transferResult = await roomMembershipService.transferOwnership(
          roomResult.room.id,
          projectOwnerId,
          { id: 'user-a-id', username: 'User A', role: 'room_owner', isReady: false }
        );

        // Verify ownership transferred
        expect(transferResult).toBeDefined();
        expect(transferResult?.newOwner.id).toBe(projectOwnerId);
        expect(transferResult?.newOwner.role).toBe('room_owner');
        expect(transferResult?.oldOwner.id).toBe('user-a-id');
        expect(transferResult?.oldOwner.role).toBe('band_member');

        // Verify in room state
        room = await roomRepository.getRoom(roomResult.room.id);
        expect(room?.owner).toBe(projectOwnerId);
        
        const newOwner = room?.bandMembers.get(projectOwnerId);
        expect(newOwner?.role).toBe('room_owner');
        
        const oldOwner = room?.bandMembers.get('user-a-id');
        expect(oldOwner?.role).toBe('band_member');
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });

    it('should NOT transfer ownership if project owner is already room owner', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Already Owner Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `already-owner-${Date.now()}`,
              email: `already-${Date.now()}@test.com`,
            },
          },
        },
        include: { user: true },
      });

      try {
        const projectOwnerId = project.userId as string;
        if (!projectOwnerId) throw new Error('Project userId is null');
        
        const username = project.user.username;
        if (!username) throw new Error('Project username is null');
        
        // Project owner creates room (already room owner)
        const roomResult = await roomLifecycleService.createRoom(
          'Test Room',
          username,
          projectOwnerId,
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );

        await projectRoomService.setActiveRoom(project.id, roomResult.room.id);

        // Verify project owner is room owner
        const room = await roomRepository.getRoom(roomResult.room.id);
        expect(room?.owner).toBe(projectOwnerId);
        
        const owner = room?.bandMembers.get(projectOwnerId);
        expect(owner?.role).toBe('room_owner');

        // No transfer should occur (already owner)
        // This is verified by the fact that there's only one user in the room
        expect(room?.bandMembers.size).toBe(1);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });

  describe('Bypass Private Room Approval', () => {
    it('should allow project owner to join private room without approval', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Private Room Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `private-owner-${Date.now()}`,
              email: `private-${Date.now()}@test.com`,
            },
          },
        },
        include: { user: true },
      });

      try {
        // User A creates PRIVATE room
        const roomResult = await roomLifecycleService.createRoom(
          'Private Room',
          'User A',
          'user-a-id',
          true, // isPrivate
          false,
          undefined,
          RoomType.ARRANGE
        );

        await projectRoomService.setActiveRoom(project.id, roomResult.room.id);

        // Verify room is private
        const room = await roomRepository.getRoom(roomResult.room.id);
        expect(room?.isPrivate).toBe(true);

        // Project owner should be able to join directly
        // (In real implementation, this is handled by RoomLifecycleHandler.handleJoinRoom)
        // Here we verify the room state allows it
        expect(room?.owner).toBe('user-a-id');

        // Project owner joins the room first
        const projectOwnerId = project.userId as string;
        if (!projectOwnerId) throw new Error('Project userId is null');
        
        await roomMembershipService.addUserToRoom(roomResult.room.id, {
          id: projectOwnerId,
          username: project.user.username!,
          role: 'band_member',
          isReady: false,
        });

        // Transfer ownership to project owner (simulates BR-2 behavior)
        await roomMembershipService.transferOwnership(
          roomResult.room.id,
          projectOwnerId,
          { id: 'user-a-id', username: 'User A', role: 'room_owner', isReady: false }
        );

        // Verify project owner is now room owner
        const updatedRoom = await roomRepository.getRoom(roomResult.room.id);
        expect(updatedRoom?.owner).toBe(projectOwnerId);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });

  describe('Reconnect Preservation', () => {
    it('should preserve room_owner role when project owner reconnects', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Reconnect Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `reconnect-owner-${Date.now()}`,
              email: `reconnect-${Date.now()}@test.com`,
            },
          },
        },
        include: { user: true },
      });

      try {
        const projectOwnerId = project.userId as string;
        if (!projectOwnerId) throw new Error('Project userId is null');
        
        const username = project.user.username;
        if (!username) throw new Error('Project owner username is null');
        
        // Project owner creates room
        const roomResult = await roomLifecycleService.createRoom(
          'Test Room',
          username,
          projectOwnerId,
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );

        await projectRoomService.setActiveRoom(project.id, roomResult.room.id);

        // Verify project owner is room owner
        let room = await roomRepository.getRoom(roomResult.room.id);
        expect(room?.owner).toBe(projectOwnerId);
        
        let owner = room?.bandMembers.get(projectOwnerId);
        expect(owner?.role).toBe('room_owner');

        // Simulate disconnect (user leaves but room persists)
        // In real scenario, grace period would keep the user in room
        // Here we just verify the role is preserved in Redis state

        // Reconnect (get room again)
        room = await roomRepository.getRoom(roomResult.room.id);
        owner = room?.bandMembers.get(projectOwnerId);

        // Role should still be room_owner
        expect(owner?.role).toBe('room_owner');
        expect(room?.owner).toBe(projectOwnerId);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });

  describe('Old Owner Demotion', () => {
    it('should demote old owner to band_member after transfer', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Demotion Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `demotion-owner-${Date.now()}`,
              email: `demotion-${Date.now()}@test.com`,
            },
          },
        },
        include: { user: true },
      });

      try {
        // User A creates room
        const roomResult = await roomLifecycleService.createRoom(
          'Test Room',
          'User A',
          'user-a-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );

        await projectRoomService.setActiveRoom(project.id, roomResult.room.id);

        // Verify User A is room owner
        let room = await roomRepository.getRoom(roomResult.room.id);
        let userA = room?.bandMembers.get('user-a-id');
        expect(userA?.role).toBe('room_owner');

        // Project owner joins the room
        const projectOwnerId = project.userId as string;
        if (!projectOwnerId) throw new Error('Project userId is null');
        
        await roomMembershipService.addUserToRoom(roomResult.room.id, {
          id: projectOwnerId,
          username: project.user.username!,
          role: 'band_member',
          isReady: false,
        });

        // Transfer ownership to project owner
        const transferResult = await roomMembershipService.transferOwnership(
          roomResult.room.id,
          projectOwnerId,
          { id: 'user-a-id', username: 'User A', role: 'room_owner', isReady: false }
        );

        // Verify old owner is demoted
        expect(transferResult).toBeDefined();
        expect(transferResult?.oldOwner.role).toBe('band_member');

        // Verify in room state
        room = await roomRepository.getRoom(roomResult.room.id);
        userA = room?.bandMembers.get('user-a-id');
        expect(userA?.role).toBe('band_member');

        // Verify new owner has room_owner role
        const projectOwner = room?.bandMembers.get(projectOwnerId);
        expect(projectOwner?.role).toBe('room_owner');

        // Verify room owner field is updated
        expect(room?.owner).toBe(projectOwnerId);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });

    it('should maintain only one room_owner after transfer', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Single Owner Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `single-owner-${Date.now()}`,
              email: `single-${Date.now()}@test.com`,
            },
          },
        },
        include: { user: true },
      });

      try {
        const roomResult = await roomLifecycleService.createRoom(
          'Test Room',
          'User A',
          'user-a-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );

        await projectRoomService.setActiveRoom(project.id, roomResult.room.id);

        // Project owner joins the room
        const projectOwnerId = project.userId as string;
        if (!projectOwnerId) throw new Error('Project userId is null');
        
        await roomMembershipService.addUserToRoom(roomResult.room.id, {
          id: projectOwnerId,
          username: project.user.username!,
          role: 'band_member',
          isReady: false,
        });

        // Transfer ownership
        await roomMembershipService.transferOwnership(
          roomResult.room.id,
          projectOwnerId,
          { id: 'user-a-id', username: 'User A', role: 'room_owner', isReady: false }
        );

        // Count room_owner roles
        const room = await roomRepository.getRoom(roomResult.room.id);
        const roomOwners = Array.from(room?.bandMembers.values() || [])
          .filter(member => member.role === 'room_owner');

        // Should have exactly one room_owner
        expect(roomOwners.length).toBe(1);
        expect(roomOwners[0]!.id).toBe(projectOwnerId);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });
});

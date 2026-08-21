/**
 * BR-1: 1 Opened Project = 1 Arrange Room - Integration Tests
 * 
 * Tests concurrent project opening scenarios with real services.
 * Protects against regressions in:
 * - Concurrent requests trying to open the same project
 * - 409 conflict detection and handling
 * - Self-heal scenarios (stale mapping cleanup)
 * - Redis atomic operations (Lua script)
 */

import { ProjectRoomService } from '../infrastructure/storage/ProjectRoomService';
import { RoomLifecycleService } from '../../room-management/application/RoomLifecycleService';
import { RoomRepository } from '../../room-management/infrastructure/repositories/RoomRepository';
import { RoomCleanupService } from '../../room-management/domain/services/RoomCleanupService';
import { RoomUserService } from '../../room-management/domain/services/RoomUserService';
import { RoomSettingsService } from '../../room-management/infrastructure/services/RoomSettingsService';
import { RoomSessionManager } from '../../room-management/infrastructure/services/RoomSessionManager';
import { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import { RoomType } from '../../../types';
import { prisma } from '@/config/prisma';

describe('BR-1: Project Room Mapping Integration Tests', () => {
  let projectRoomService: ProjectRoomService;
  let roomLifecycleService: RoomLifecycleService;
  let roomRepository: RoomRepository;
  let roomCleanupService: RoomCleanupService;
  let roomUserService: RoomUserService;
  let roomSettingsService: RoomSettingsService;
  let roomSessionManager: RoomSessionManager;
  let namespaceGracePeriodManager: NamespaceGracePeriodManager;
  let arrangeRoomStateService: ArrangeRoomStateService;
  let effectChainService: EffectChainService;

  const createdRoomIds: string[] = [];

  beforeAll(() => {
    // Initialize real services (not mocks)
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

  describe('Concurrent Project Opening', () => {
    it('should allow only one active room per project (concurrent requests)', async () => {
      // Create a test project
      const project = await prisma.savedProject.create({
        data: {
          name: `Concurrent Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `user-concurrent-${Date.now()}`,
              email: `concurrent-${Date.now()}@test.com`,
            },
          },
        },
      });

      try {
        // User A creates room for the project
        const roomA = await roomLifecycleService.createRoom(
          'Room A',
          'user-a',
          'user-a-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(roomA.room.id);

        // User B creates another room for the SAME project
        const roomB = await roomLifecycleService.createRoom(
          'Room B',
          'user-b',
          'user-b-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(roomB.room.id);

        // Simulate concurrent trySetActiveRoom calls
        const [resultA, resultB] = await Promise.all([
          projectRoomService.trySetActiveRoom(project.id, roomA.room.id),
          projectRoomService.trySetActiveRoom(project.id, roomB.room.id),
        ]);

        // One should succeed (null), one should conflict
        const successCount = [resultA, resultB].filter(r => r === null).length;
        const conflictCount = [resultA, resultB].filter(r => r !== null).length;

        expect(successCount).toBe(1);
        expect(conflictCount).toBe(1);

        // Verify only one room is mapped
        const activeRoom = await projectRoomService.getActiveRoom(project.id);
        expect(activeRoom.activeRoomId).toBeTruthy();
        expect([roomA.room.id, roomB.room.id]).toContain(activeRoom.activeRoomId);

        // The conflicting result should contain the winning room ID
        const conflict = [resultA, resultB].find(r => r !== null);
        expect(conflict?.conflictRoomId).toBe(activeRoom.activeRoomId);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });

    it('should handle rapid sequential requests correctly', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Sequential Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `user-sequential-${Date.now()}`,
              email: `sequential-${Date.now()}@test.com`,
            },
          },
        },
      });

      try {
        // Create 3 rooms
        const rooms = await Promise.all([
          roomLifecycleService.createRoom('Room 1', 'user-1', 'user-1-id', false, false, undefined, RoomType.ARRANGE),
          roomLifecycleService.createRoom('Room 2', 'user-2', 'user-2-id', false, false, undefined, RoomType.ARRANGE),
          roomLifecycleService.createRoom('Room 3', 'user-3', 'user-3-id', false, false, undefined, RoomType.ARRANGE),
        ]);
        createdRoomIds.push(...rooms.map(r => r.room.id));

        // Try to set active room rapidly
        const results = await Promise.all(
          rooms.map(r => projectRoomService.trySetActiveRoom(project.id, r.room.id))
        );

        // Only one should succeed
        const successCount = results.filter(r => r === null).length;
        expect(successCount).toBe(1);

        // All conflicts should point to the same room
        const conflicts = results.filter(r => r !== null);
        const conflictRoomIds = conflicts.map(c => c!.conflictRoomId);
        const uniqueConflictIds = new Set(conflictRoomIds);
        expect(uniqueConflictIds.size).toBe(1);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });

  describe('Self-Heal Scenarios', () => {
    it('should self-heal stale mapping (room deleted but mapping remains)', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Self-Heal Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `user-selfheal-${Date.now()}`,
              email: `selfheal-${Date.now()}@test.com`,
            },
          },
        },
      });

      try {
        // Create room and set as active
        const room1 = await roomLifecycleService.createRoom(
          'Room 1',
          'user-1',
          'user-1-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(room1.room.id);

        await projectRoomService.setActiveRoom(project.id, room1.room.id);

        // Verify mapping exists
        let activeRoom = await projectRoomService.getActiveRoom(project.id);
        expect(activeRoom.activeRoomId).toBe(room1.room.id);

        // Delete the room (simulates room cleanup without clearing mapping)
        await roomLifecycleService.deleteRoom(room1.room.id);

        // Create new room and try to set as active
        const room2 = await roomLifecycleService.createRoom(
          'Room 2',
          'user-2',
          'user-2-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(room2.room.id);

        // trySetActiveRoom should detect stale mapping and self-heal
        const result = await projectRoomService.trySetActiveRoom(project.id, room2.room.id);

        // Should succeed (self-healed)
        expect(result).toBeNull();

        // Verify new room is now active
        activeRoom = await projectRoomService.getActiveRoom(project.id);
        expect(activeRoom.activeRoomId).toBe(room2.room.id);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });

    it('should detect conflict when mapped room still has users', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Active Room Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `user-active-${Date.now()}`,
              email: `active-${Date.now()}@test.com`,
            },
          },
        },
      });

      try {
        // Create room with owner
        const room1 = await roomLifecycleService.createRoom(
          'Room 1',
          'user-1',
          'user-1-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(room1.room.id);

        await projectRoomService.setActiveRoom(project.id, room1.room.id);

        // Verify room has users
        const room = await roomRepository.getRoom(room1.room.id);
        expect(room?.bandMembers.size).toBeGreaterThan(0);

        // Create new room
        const room2 = await roomLifecycleService.createRoom(
          'Room 2',
          'user-2',
          'user-2-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(room2.room.id);

        // trySetActiveRoom should detect active room and return conflict
        const result = await projectRoomService.trySetActiveRoom(project.id, room2.room.id);

        // Should return conflict (room1 still has users)
        expect(result).not.toBeNull();
        expect(result?.conflictRoomId).toBe(room1.room.id);

        // Verify original room is still active
        const activeRoom = await projectRoomService.getActiveRoom(project.id);
        expect(activeRoom.activeRoomId).toBe(room1.room.id);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });

  describe('Idempotent Operations', () => {
    it('should allow setting the same room multiple times (idempotent)', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Idempotent Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `user-idempotent-${Date.now()}`,
              email: `idempotent-${Date.now()}@test.com`,
            },
          },
        },
      });

      try {
        const room = await roomLifecycleService.createRoom(
          'Test Room',
          'user-1',
          'user-1-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(room.room.id);

        // Set active room multiple times
        const result1 = await projectRoomService.trySetActiveRoom(project.id, room.room.id);
        const result2 = await projectRoomService.trySetActiveRoom(project.id, room.room.id);
        const result3 = await projectRoomService.trySetActiveRoom(project.id, room.room.id);

        // All should succeed (idempotent)
        expect(result1).toBeNull();
        expect(result2).toBeNull();
        expect(result3).toBeNull();

        // Verify mapping is correct
        const activeRoom = await projectRoomService.getActiveRoom(project.id);
        expect(activeRoom.activeRoomId).toBe(room.room.id);
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });

  describe('Cleanup Operations', () => {
    it('should clear mapping when room is deleted', async () => {
      const project = await prisma.savedProject.create({
        data: {
          name: `Cleanup Test ${Date.now()}`,
          roomType: 'arrange',
          user: {
            create: {
              username: `user-cleanup-${Date.now()}`,
              email: `cleanup-${Date.now()}@test.com`,
            },
          },
        },
      });

      try {
        const room = await roomLifecycleService.createRoom(
          'Test Room',
          'user-1',
          'user-1-id',
          false,
          false,
          undefined,
          RoomType.ARRANGE
        );
        createdRoomIds.push(room.room.id);

        await projectRoomService.setActiveRoom(project.id, room.room.id);

        // Verify mapping exists
        let activeRoom = await projectRoomService.getActiveRoom(project.id);
        expect(activeRoom.activeRoomId).toBe(room.room.id);

        // Delete room (should trigger cleanup)
        await roomLifecycleService.deleteRoom(room.room.id);

        // Verify mapping is cleared
        activeRoom = await projectRoomService.getActiveRoom(project.id);
        expect(activeRoom.activeRoomId).toBeNull();
      } finally {
        await prisma.savedProject.delete({ where: { id: project.id } }).catch(() => {});
      }
    });
  });
});

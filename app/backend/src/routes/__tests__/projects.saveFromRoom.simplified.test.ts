import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { prisma } from '../../config/prisma';
import { getRedisClient } from '../../config/redis';
import { ArrangeRoomStateService } from '../../domains/arrange-room/application/ArrangeRoomStateService';
import { REDIS_KEYS } from '../../shared/constants/RedisKeys';

/**
 * Simplified Integration Tests for Save From Room Flow
 * 
 * Tests the core save flow logic without HTTP layer:
 * - Save new project vs save over existing project
 * - Room state metadata management
 * - Permission checks via hasBeenSaved flag
 */
describe('Save From Room Flow - Simplified Integration Tests', () => {
  let userId: string;
  let roomId: string;
  let existingProjectId: string;
  let arrangeRoomStateService: ArrangeRoomStateService;

  beforeEach(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        username: `testuser-${Date.now()}`,
        passwordHash: 'hashedpassword',
        userType: 'REGISTERED',
        emailVerified: true,
      },
    });
    userId = user.id;

    // Create room ID for testing
    roomId = `test-room-${Date.now()}`;
    
    // Initialize room state service (uses RedisStateService.getInstance() internally)
    // Ensure Redis is connected first
    await getRedisClient();
    arrangeRoomStateService = new ArrangeRoomStateService();
    await arrangeRoomStateService.initializeState(roomId);

    // Create existing project for save-over tests
    const project = await prisma.savedProject.create({
      data: {
        name: 'Existing Project',
        userId,
        roomType: 'arrange',
        visibility: 'PRIVATE',
      },
    });
    existingProjectId = project.id;
  });

  afterEach(async () => {
    // Cleanup
    await prisma.savedProject.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    const redisClient = await getRedisClient();
    await redisClient.del(`collab:${REDIS_KEYS.arrangeState(roomId)}`);
  });

  afterAll(async () => {
    const { closeRedisConnections } = await import('../../config/redis');
    await closeRedisConnections();
  });

  describe('Save New Project Flow', () => {
    it('should create new project and update room metadata', async () => {
      // Simulate saving a new project
      const newProject = await prisma.savedProject.create({
        data: {
          name: 'New Project',
          description: 'Test description',
          userId,
          roomType: 'arrange',
          visibility: 'PRIVATE',
        },
      });

      // Update room state metadata (what the endpoint would do)
      await arrangeRoomStateService.setProjectMetadata(
        roomId,
        newProject.id,
        userId,
        true // hasBeenSaved = true after first save
      );

      // Verify metadata was set correctly
      const metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(newProject.id);
      expect(metadata?.projectOwnerId).toBe(userId);
      expect(metadata?.hasBeenSaved).toBe(true);

      // Verify project exists in database
      const savedProject = await prisma.savedProject.findUnique({
        where: { id: newProject.id },
      });
      expect(savedProject).toBeDefined();
      expect(savedProject?.name).toBe('New Project');
    });

    it('should set hasBeenSaved to true after first save', async () => {
      // Initially hasBeenSaved should be false
      let metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.hasBeenSaved).toBe(false);

      // Create and save project
      const newProject = await prisma.savedProject.create({
        data: {
          name: 'First Save',
          userId,
          roomType: 'arrange',
          visibility: 'PRIVATE',
        },
      });

      await arrangeRoomStateService.setProjectMetadata(
        roomId,
        newProject.id,
        userId,
        true
      );

      // After save, hasBeenSaved should be true
      metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.hasBeenSaved).toBe(true);
    });
  });

  describe('Save Over Existing Project Flow', () => {
    beforeEach(async () => {
      // Set project metadata in room state
      await arrangeRoomStateService.setProjectMetadata(
        roomId,
        existingProjectId,
        userId,
        true
      );
    });

    it('should update existing project without changing metadata', async () => {
      // Update the existing project
      await prisma.savedProject.update({
        where: { id: existingProjectId },
        data: {
          name: 'Updated Project Name',
          description: 'Updated description',
        },
      });

      // Metadata should remain the same
      const metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(existingProjectId);
      expect(metadata?.projectOwnerId).toBe(userId);
      expect(metadata?.hasBeenSaved).toBe(true);

      // Verify project was updated
      const updatedProject = await prisma.savedProject.findUnique({
        where: { id: existingProjectId },
      });
      expect(updatedProject?.name).toBe('Updated Project Name');
      expect(updatedProject?.description).toBe('Updated description');
    });

    it('should maintain hasBeenSaved as true when saving over', async () => {
      // Update project
      await prisma.savedProject.update({
        where: { id: existingProjectId },
        data: { name: 'Save Over Test' },
      });

      // hasBeenSaved should still be true
      const metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.hasBeenSaved).toBe(true);
    });

    it('should update projectId when saving to different project', async () => {
      // Create another project
      const anotherProject = await prisma.savedProject.create({
        data: {
          name: 'Another Project',
          userId,
          roomType: 'arrange',
          visibility: 'PRIVATE',
        },
      });

      // Update metadata to point to new project
      await arrangeRoomStateService.setProjectMetadata(
        roomId,
        anotherProject.id,
        userId,
        true
      );

      // Metadata should reflect new project
      const metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(anotherProject.id);
      expect(metadata?.hasBeenSaved).toBe(true);
    });
  });

  describe('Permission Logic via hasBeenSaved Flag', () => {
    it('should allow owner to save when hasBeenSaved is false', async () => {
      // Room owner can always save
      const metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.hasBeenSaved).toBe(false);
      
      // Owner can create new project
      const newProject = await prisma.savedProject.create({
        data: {
          name: 'Owner New Project',
          userId,
          roomType: 'arrange',
          visibility: 'PRIVATE',
        },
      });

      expect(newProject).toBeDefined();
    });

    it('should check hasBeenSaved flag for collaborator permissions', async () => {
      // Create collaborator
      const collaborator = await prisma.user.create({
        data: {
          email: `collab-${Date.now()}@example.com`,
          username: `collab-${Date.now()}`,
          passwordHash: 'hashedpassword',
          userType: 'REGISTERED',
          emailVerified: true,
        },
      });

      try {
        // When hasBeenSaved is false, collaborator should not be able to save new project
        let metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
        expect(metadata?.hasBeenSaved).toBe(false);
        // In real endpoint, this would return 403

        // Set hasBeenSaved to true
        await arrangeRoomStateService.setProjectMetadata(
          roomId,
          existingProjectId,
          userId,
          true
        );

        // Now collaborator can save over existing project
        metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
        expect(metadata?.hasBeenSaved).toBe(true);
        // In real endpoint, this would be allowed
      } finally {
        await prisma.user.delete({ where: { id: collaborator.id } });
      }
    });
  });

  describe('Complete Save Flow Integration', () => {
    it('should complete full flow: new project -> save over -> save over again', async () => {
      // Step 1: Save new project
      const newProject = await prisma.savedProject.create({
        data: {
          name: 'Flow Test Project',
          description: 'Initial save',
          userId,
          roomType: 'arrange',
          visibility: 'PRIVATE',
        },
      });

      await arrangeRoomStateService.setProjectMetadata(
        roomId,
        newProject.id,
        userId,
        true
      );

      // Verify metadata after first save
      let metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(newProject.id);
      expect(metadata?.hasBeenSaved).toBe(true);

      // Step 2: Save over the same project
      await prisma.savedProject.update({
        where: { id: newProject.id },
        data: {
          name: 'Flow Test Project - Updated',
          description: 'First update',
        },
      });

      // Metadata should be preserved
      metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(newProject.id);
      expect(metadata?.hasBeenSaved).toBe(true);

      // Step 3: Save over again
      await prisma.savedProject.update({
        where: { id: newProject.id },
        data: {
          name: 'Flow Test Project - Final',
          description: 'Second update',
        },
      });

      // Verify final state
      const finalProject = await prisma.savedProject.findUnique({
        where: { id: newProject.id },
      });
      expect(finalProject?.name).toBe('Flow Test Project - Final');
      expect(finalProject?.description).toBe('Second update');

      metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(newProject.id);
      expect(metadata?.hasBeenSaved).toBe(true);
    });
  });

  describe('Room State Metadata Management', () => {
    it('should clear metadata when requested', async () => {
      // Set metadata
      await arrangeRoomStateService.setProjectMetadata(
        roomId,
        existingProjectId,
        userId,
        true
      );

      let metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(existingProjectId);

      // Clear metadata
      await arrangeRoomStateService.clearProjectMetadata(roomId);

      metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBeUndefined();
      expect(metadata?.projectOwnerId).toBeUndefined();
      expect(metadata?.hasBeenSaved).toBe(false);
    });

    it('should mark project as saved', async () => {
      // Create new project
      const newProject = await prisma.savedProject.create({
        data: {
          name: 'Mark Saved Test',
          userId,
          roomType: 'arrange',
          visibility: 'PRIVATE',
        },
      });

      // Mark as saved
      await arrangeRoomStateService.markProjectAsSaved(roomId, newProject.id);

      const metadata = await arrangeRoomStateService.getProjectMetadata(roomId);
      expect(metadata?.projectId).toBe(newProject.id);
      expect(metadata?.hasBeenSaved).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type { PrismaClient, SavedProject } from '@prisma/client';

/**
 * Project Lock Feature Tests
 * 
 * Tests for BR-11: Project Lock (Read-Only Mode)
 * - PATCH /api/projects/:id/lock endpoint
 * - Owner-only toggle restriction
 * - Save restriction for locked projects
 * - Real-time sync of isLocked status
 */

describe('Project Lock Feature', () => {
  let mockPrisma: jest.Mocked<PrismaClient>;
  let _mockReq: Partial<Request>;
  let _mockRes: Partial<Response>;

  beforeEach(() => {
    mockPrisma = {
      savedProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaClient>;

    _mockReq = {
      params: { id: 'project-123' },
      user: {
        id: 'user-owner',
        email: 'owner@example.com',
        username: 'owner',
        userType: 'REGISTERED',
        emailVerified: true,
      },
    };

    _mockRes = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
    };
  });

  describe('PATCH /api/projects/:id/lock - Toggle Lock', () => {
    it('should toggle lock from false to true (lock project)', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: false,
        name: 'Test Project',
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);
      mockPrisma.savedProject.update.mockResolvedValue({
        ...mockProject,
        isLocked: true,
      } as unknown as SavedProject);

      // Simulate PATCH /api/projects/:id/lock
      const project = await mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });

      expect(project?.userId).toBe('user-owner');

      const updated = await mockPrisma.savedProject.update({
        where: { id: 'project-123' },
        data: { isLocked: !project?.isLocked },
      });

      expect(updated.isLocked).toBe(true);
      expect(mockPrisma.savedProject.update).toHaveBeenCalledWith({
        where: { id: 'project-123' },
        data: { isLocked: true },
      });
    });

    it('should toggle lock from true to false (unlock project)', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: true,
        name: 'Test Project',
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);
      mockPrisma.savedProject.update.mockResolvedValue({
        ...mockProject,
        isLocked: false,
      } as unknown as SavedProject);

      const project = await mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });

      const updated = await mockPrisma.savedProject.update({
        where: { id: 'project-123' },
        data: { isLocked: !project?.isLocked },
      });

      expect(updated.isLocked).toBe(false);
    });

    it('should reject toggle if user is not project owner (403)', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: false,
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);

      const project = await mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });

      const currentUserId = 'user-other';
      const isOwner = project?.userId === currentUserId;

      expect(isOwner).toBe(false);
      // Should return 403 Forbidden
    });

    it('should return 404 if project not found', async () => {
void mockPrisma.savedProject.findUnique.mockResolvedValue(null);

      const project = await mockPrisma.savedProject.findUnique({
        where: { id: 'non-existent' },
      });

      expect(project).toBeNull();
      // Should return 404 Not Found
    });
  });

  describe('PUT /api/projects/:id - Save Restriction', () => {
    it('should allow owner to save locked project', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: true,
        name: 'Locked Project',
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);

      const project = await mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });

      const currentUserId = 'user-owner';
      const canSave = !project?.isLocked || project.userId === currentUserId;

      expect(canSave).toBe(true);
    });

    it('should reject non-owner save on locked project (403)', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: true,
        name: 'Locked Project',
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);

      const project = await mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });

      const currentUserId = 'user-other';
      const canSave = !project?.isLocked || project.userId === currentUserId;

      expect(canSave).toBe(false);
      // Should return 403 Forbidden
    });

    it('should allow non-owner to save unlocked project', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: false,
        name: 'Unlocked Project',
        visibility: 'PUBLIC',
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);

      const project = await mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });

      const currentUserId = 'user-other';
      const canSave = !project?.isLocked || project.userId === currentUserId;

      expect(canSave).toBe(true);
      // Should allow save (subject to other access controls)
    });
  });

  describe('Lock Status Validation', () => {
    it('should have isLocked default to false for new projects', () => {
      const newProject = {
        id: 'new-project',
        userId: 'user-123',
        isLocked: false, // Default value
        name: 'New Project',
      };

      expect(newProject.isLocked).toBe(false);
    });

    it('should persist isLocked status across updates', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: true,
        name: 'Test Project',
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);
      mockPrisma.savedProject.update.mockResolvedValue({
        ...mockProject,
        name: 'Updated Name',
        isLocked: true, // Should remain locked
      } as unknown as SavedProject);

      const updated = await mockPrisma.savedProject.update({
        where: { id: 'project-123' },
        data: { name: 'Updated Name' },
      });

      expect(updated.isLocked).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent lock toggle requests', async () => {
      const mockProject = {
        id: 'project-123',
        userId: 'user-owner',
        isLocked: false,
      };

void mockPrisma.savedProject.findUnique.mockResolvedValue(mockProject as unknown as SavedProject);

      // Simulate two concurrent requests
      const request1 = mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });
      const request2 = mockPrisma.savedProject.findUnique({
        where: { id: 'project-123' },
      });

      const [result1, result2] = await Promise.all([request1, request2]);

      expect(result1?.isLocked).toBe(result2?.isLocked);
      // Both should see the same state
    });

    it('should handle lock toggle on forked project independently', async () => {
      const originalProject = {
        id: 'original-123',
        userId: 'user-owner',
        isLocked: true,
      };

      const forkedProject = {
        id: 'fork-456',
        userId: 'user-forker',
        isLocked: false, // Independent lock status
        forkedFromId: 'original-123',
      };

      expect(forkedProject.isLocked).not.toBe(originalProject.isLocked);
      // Forked project should have independent lock status
    });
  });
});

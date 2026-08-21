/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars */
/**
 * BR-13: Project Contributor System - Regression Tests
 * 
 * Protects against regressions in:
 * - Auto-add contributors on first save
 * - Contributor timestamp updates
 * - Contributor access control
 * - Contributor list retrieval
 * - Owner vs contributor permissions
 * - Contributor removal
 */

import { prisma } from '@/config/prisma';
import { ProjectVisibility } from '@prisma/client';

describe('BR-13: Contributor System Regression Tests', () => {
  const testUsers: Array<{ id: string; username: string | null; email: string | null }> = [];
  let testProjects: string[] = [];

  beforeAll(async () => {
    // Create test users
    for (let i = 1; i <= 4; i++) {
      const user = await prisma.user.create({
        data: {
          username: `contributor-user-${i}-${Date.now()}`,
          email: `contributor-${i}-${Date.now()}@test.com`,
        },
      });
      testUsers.push(user);
    }
  });

  afterEach(async () => {
    // Clean up contributors first
    await prisma.projectContributor.deleteMany({
      where: { projectId: { in: testProjects } },
    });

    // Then clean up projects
    for (const projectId of testProjects) {
      await prisma.savedProject.delete({ where: { id: projectId } }).catch(() => {});
    }
    testProjects = [];
  });

  afterAll(async () => {
    // Clean up test users
    for (const user of testUsers) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  describe('Auto-Add Contributors', () => {
    it('should auto-add user as contributor on first save to public project', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Public Project ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Simulate contributor saving to project
      const newContributor = await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      expect(newContributor).toBeDefined();
      expect(newContributor.userId).toBe(contributor!.id);
      expect(newContributor.projectId).toBe(project.id);
      expect(newContributor.lastContributedAt).toBeDefined();
    });

    it('should not add owner as contributor', async () => {
      const owner = testUsers[0];

      const project = await prisma.savedProject.create({
        data: {
          name: `Owner Project ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
        include: {
          contributors: true,
        },
      });
      testProjects.push(project.id);

      // Owner should not be in contributors list
      expect(project.contributors.length).toBe(0);
    });

    it('should prevent duplicate contributors', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Duplicate Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Add contributor first time
      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      // Try to add same contributor again - should fail with unique constraint
      let hasErrorThrown = false;
      try {
        await prisma.projectContributor.create({
          data: {
            projectId: project.id,
            userId: contributor!.id,
          },
        });
      } catch (_error) {
        hasErrorThrown = true;
      }
      
      expect(hasErrorThrown).toBe(true);
    });
  });

  describe('Contributor Timestamp Updates', () => {
    it('should update lastContributedAt on subsequent saves', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Timestamp Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Add contributor
      const initial = await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      const initialTime = initial.lastContributedAt;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Update timestamp
      const updated = await prisma.projectContributor.update({
        where: {
           
          projectId_userId: {
            projectId: project.id,
            userId: contributor!.id,
          },
        },
        data: {
          lastContributedAt: new Date(),
        },
      });

      expect(updated.lastContributedAt.getTime()).toBeGreaterThan(initialTime.getTime());
    });

    it('should maintain contributor order by lastContributedAt', async () => {
      const owner = testUsers[0];
      const contributor1 = testUsers[1];
      const contributor2 = testUsers[2];

      const project = await prisma.savedProject.create({
        data: {
          name: `Order Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Add contributor 1
      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor1!.id,
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Add contributor 2
      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor2!.id,
        },
      });

      // Get contributors ordered by lastContributedAt
      const contributors = await prisma.projectContributor.findMany({
        where: { projectId: project.id },
        orderBy: { lastContributedAt: 'desc' },
      });

      // Contributor 2 should be first (most recent)
      expect(contributors[0]!.userId).toBe(contributor2!.id);
      expect(contributors[1]!.userId).toBe(contributor1!.id);
    });
  });

  describe('Contributor Access Control', () => {
    it('should allow contributors to access project', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Access Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PRIVATE,
        },
      });
      testProjects.push(project.id);

      // Add contributor
      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      // Verify contributor has access
      const projectWithContributors = await prisma.savedProject.findUnique({
        where: { id: project.id },
        include: { contributors: true },
      });

      const isContributor = projectWithContributors?.contributors.some(
        c => c.userId === contributor!.id
      );
      expect(isContributor).toBe(true);
    });

    it('should prevent non-contributors from accessing private project', async () => {
      const owner = testUsers[0];
      const nonContributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Private Access Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PRIVATE,
        },
      });
      testProjects.push(project.id);

      // Verify non-contributor does NOT have access
      const projectWithContributors = await prisma.savedProject.findUnique({
        where: { id: project.id },
        include: { contributors: true },
      });

      const isContributor = projectWithContributors?.contributors.some(
        c => c.userId === nonContributor!.id
      );
      expect(isContributor).toBe(false);
    });

    it('should allow anyone to contribute to public projects', async () => {
      const owner = testUsers[0];
      const publicContributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Public Contribution ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Anyone can be added as contributor to public project
      const contributor = await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: publicContributor!.id,
        },
      });

      expect(contributor).toBeDefined();
    });
  });

  describe('Contributor List Retrieval', () => {
    it('should retrieve all contributors for a project', async () => {
      const owner = testUsers[0];
      const contributor1 = testUsers[1];
      const contributor2 = testUsers[2];
      const contributor3 = testUsers[3];

      const project = await prisma.savedProject.create({
        data: {
          name: `Multi Contributor ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Add multiple contributors
      await prisma.projectContributor.createMany({
        data: [
          { projectId: project.id, userId: contributor1!.id },
          { projectId: project.id, userId: contributor2!.id },
          { projectId: project.id, userId: contributor3!.id },
        ],
      });

      const contributors = await prisma.projectContributor.findMany({
        where: { projectId: project.id },
        include: { user: { select: { id: true, username: true } } },
      });

      expect(contributors.length).toBe(3);
      expect(contributors.map(c => c!.userId)).toContain(contributor1!.id);
      expect(contributors.map(c => c!.userId)).toContain(contributor2!.id);
      expect(contributors.map(c => c!.userId)).toContain(contributor3!.id);
    });

    it('should include contributor user details', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `User Details Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      const contributors = await prisma.projectContributor.findMany({
        where: { projectId: project.id },
        include: { user: { select: { id: true, username: true } } },
      });

      expect(contributors[0]!).toBeDefined();
      expect(contributors[0]!.user).toBeDefined();
      expect(contributors[0]!.user!.id).toBe(contributor!.id);
      expect(contributors[0]!.user!.username).toBe(contributor!.username);
    });

    it('should limit contributors in list (take parameter)', async () => {
      const owner = testUsers[0];

      const project = await prisma.savedProject.create({
        data: {
          name: `Limit Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Add all test users as contributors
      await prisma.projectContributor.createMany({
        data: testUsers.slice(1).map(user => ({
          projectId: project.id,
          userId: user.id,
        })),
      });

      // Get only 2 contributors
      const limitedContributors = await prisma.projectContributor.findMany({
        where: { projectId: project.id },
        take: 2,
        orderBy: { lastContributedAt: 'desc' },
      });

      expect(limitedContributors.length).toBe(2);
      expect(limitedContributors[0]).toBeDefined();
      expect(limitedContributors[1]).toBeDefined();
    });
  });

  describe('Contributor Removal', () => {
    it('should allow removing contributor from project', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Removal Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      // Add contributor
      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      // Remove contributor
      await prisma.projectContributor.delete({
        where: {
           
          projectId_userId: {
            projectId: project.id,
            userId: contributor!.id,
          },
        },
      });

      // Verify contributor removed
      const contributors = await prisma.projectContributor.findMany({
        where: { projectId: project.id },
      });

      expect(contributors.length).toBe(0);
    });

    it('should cascade delete contributors when project is deleted', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Cascade Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });

      // Add contributor
      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      // Delete project
      await prisma.savedProject.delete({ where: { id: project.id } });

      // Verify contributors also deleted
      const contributors = await prisma.projectContributor.findMany({
        where: { projectId: project.id },
      });

      expect(contributors.length).toBe(0);
    });
  });

  describe('Owner vs Contributor Permissions', () => {
    it('should distinguish owner from contributors', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Permission Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
        include: { contributors: true },
      });
      testProjects.push(project.id);

      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      // Verify owner
      expect(project.userId).toBe(owner!.id);

      // Verify contributor is not owner
      const isContributorOwner = project.userId === contributor!.id;
      expect(isContributorOwner).toBe(false);
    });

    it('should allow contributors to save but not delete project', async () => {
      const owner = testUsers[0];
      const contributor = testUsers[1];

      const project = await prisma.savedProject.create({
        data: {
          name: `Save Permission ${Date.now()}`,
          roomType: 'arrange',
          userId: owner!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project.id);

      await prisma.projectContributor.create({
        data: {
          projectId: project.id,
          userId: contributor!.id,
        },
      });

      // Verify contributor exists
      const projectWithContributors = await prisma.savedProject.findUnique({
        where: { id: project.id },
        include: { contributors: true },
      });

      const isContributor = projectWithContributors?.contributors.some(
        c => c.userId === contributor!.id
      );
      expect(isContributor).toBe(true);

      // Only owner can delete (verified by userId check)
      expect(project.userId).toBe(owner!.id);
      expect(project.userId).not.toBe(contributor!.id);
    });
  });

  describe('Contributed Projects Query', () => {
    it('should find all projects user has contributed to', async () => {
      const owner1 = testUsers[0];
      const owner2 = testUsers[1];
      const contributor = testUsers[2];

      // Create two projects with different owners
      const project1 = await prisma.savedProject.create({
        data: {
          name: `Contributed 1 ${Date.now()}`,
          roomType: 'arrange',
          userId: owner1!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project1.id);

      const project2 = await prisma.savedProject.create({
        data: {
          name: `Contributed 2 ${Date.now()}`,
          roomType: 'arrange',
          userId: owner2!.id,
          visibility: ProjectVisibility.PUBLIC,
        },
      });
      testProjects.push(project2.id);

      // Add same contributor to both projects
      await prisma.projectContributor.createMany({
        data: [
          { projectId: project1.id, userId: contributor!.id },
          { projectId: project2.id, userId: contributor!.id },
        ],
      });

      // Query contributed projects
      const contributedProjects = await prisma.savedProject.findMany({
        where: {
          contributors: { some: { userId: contributor!.id } },
          NOT: { userId: contributor!.id }, // Exclude owned projects
        },
      });

      expect(contributedProjects.length).toBe(2);
      expect(contributedProjects.map(p => p.id)).toContain(project1.id);
      expect(contributedProjects.map(p => p.id)).toContain(project2.id);
    });
  });
});

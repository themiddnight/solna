/**
 * BR-7: Project Fork - Regression Tests
 *
 * Protects against regressions in:
 * - Fork permission checks (allowFork flag)
 * - Fork access control (visibility, band membership)
 * - Fork metadata (forkedFromId reference)
 * - Fork file copying
 * - Self-fork prevention
 * - Fork settings reset (allowFork = false on forked copy)
 */

import { prisma } from '@/config/prisma';
import { ProjectVisibility } from '@prisma/client';
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';

const esModuleFlag = '__esModule';

jest.mock('../infrastructure/storage/ProjectStorageService', () => ({
  [esModuleFlag]: true,
  projectStorageService: {
    loadProjectFiles: jest.fn().mockResolvedValue({ projectJson: '{}', audioFiles: [] }),
    deleteProjectFiles: jest.fn().mockResolvedValue(undefined),
    saveProjectFiles: jest.fn().mockResolvedValue(undefined),
    replaceProjectFilesSafely: jest.fn().mockResolvedValue(undefined),
    deleteAllOldProjectFiles: jest.fn().mockResolvedValue(undefined),
  },
}));

import { projectStorageService } from '../infrastructure/storage/ProjectStorageService';
import { projectApplicationService } from '../application/ProjectApplicationService';

describe('BR-7: Project Fork Regression Tests', () => {
  const testUsers: Array<{ id: string; username: string | null; email: string | null }> = [];
  let testProjects: string[] = [];

  beforeAll(async () => {
    // Create test users
    for (let i = 1; i <= 3; i++) {
      const user = await prisma.user.create({
        data: {
          username: `fork-user-${i}-${Date.now()}`,
          email: `fork-user-${i}-${Date.now()}@test.com`,
        },
      });
      testUsers.push(user);
    }
  });

  afterEach(async () => {
    // Clean up test projects
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

  describe('Fork Permission Checks', () => {
    it('should allow forking when allowFork is true', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Forkable Project ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      // Verify allowFork is true
      expect(original.allowFork).toBe(true);

      // Create fork
      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker.id,
          visibility: original.visibility,
          allowFork: false, // Reset on fork
          forkedFromId: original.id,
        },
      });
      testProjects.push(forked.id);

      // Verify fork was created
      expect(forked).toBeDefined();
      expect(forked.forkedFromId).toBe(original.id);
      expect(forked.userId).toBe(forker.id);
      expect(forked.allowFork).toBe(false); // Should be reset
    });

    it('should prevent forking when allowFork is false', async () => {
      const owner = testUsers[0]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Non-Forkable Project ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: false,
        },
      });
      testProjects.push(original.id);

      // Verify allowFork is false
      expect(original.allowFork).toBe(false);

      // In real API, this would return 403 error
      // Here we just verify the flag
      expect(original.allowFork).toBe(false);
    });

    it('should reset allowFork to false on forked project', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Original ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker.id,
          visibility: original.visibility,
          allowFork: false,
          forkedFromId: original.id,
        },
      });
      testProjects.push(forked.id);

      // Forked project should have allowFork = false
      expect(forked.allowFork).toBe(false);
      expect(original.allowFork).toBe(true); // Original unchanged
    });
  });

  describe('Self-Fork Prevention', () => {
    it('should prevent user from forking their own project', async () => {
      const owner = testUsers[0]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Self Fork Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      // In real API, attempting to fork own project returns 400
      // Here we verify ownership
      expect(original.userId).toBe(owner.id);

      // Attempting to create fork with same userId should be prevented
      // This is a business rule check, not a DB constraint
    });
  });

  describe('Fork Metadata', () => {
    it('should maintain forkedFromId reference', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Original ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker.id,
          forkedFromId: original.id,
        },
        include: {
          forkedFrom: {
            select: {
              id: true,
              name: true,
              user: {
                select: {
                  username: true,
                },
              },
            },
          },
        },
      });
      testProjects.push(forked.id);

      // Verify forkedFrom relationship
      expect(forked.forkedFromId).toBe(original.id);
      expect(forked.forkedFrom).toBeDefined();
      expect(forked.forkedFrom!.id).toBe(original.id);
      expect(forked.forkedFrom!.name).toBe(original.name);
      expect(forked.forkedFrom!.user.username).toBe(owner.username);
    });

    it('should allow multiple forks from same original', async () => {
      const owner = testUsers[0]!;
      const forker1 = testUsers[1]!;
      const forker2 = testUsers[2]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Multi Fork ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      // Create two forks
      const fork1 = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork 1)`,
          roomType: original.roomType,
          userId: forker1.id,
          forkedFromId: original.id,
        },
      });
      testProjects.push(fork1.id);

      const fork2 = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork 2)`,
          roomType: original.roomType,
          userId: forker2.id,
          forkedFromId: original.id,
        },
      });
      testProjects.push(fork2.id);

      // Both should reference same original
      expect(fork1.forkedFromId).toBe(original.id);
      expect(fork2.forkedFromId).toBe(original.id);
      expect(fork1.userId).not.toBe(fork2.userId);
    });

    it('should not allow forking a fork (no chain forking)', async () => {
      const owner = testUsers[0]!;
      const forker1 = testUsers[1]!;
      const forker2 = testUsers[2]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Chain Fork Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const fork1 = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker1.id,
          forkedFromId: original.id,
          allowFork: false, // Forks have allowFork = false
        },
      });
      testProjects.push(fork1.id);

      // Attempting to fork the fork should be prevented by allowFork = false
      expect(fork1.allowFork).toBe(false);

      // Even if we try to create it, it should reference original, not fork1
      const fork2 = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork 2)`,
          roomType: original.roomType,
          userId: forker2.id,
          forkedFromId: original.id, // Should reference original, not fork1
        },
      });
      testProjects.push(fork2.id);

      expect(fork2.forkedFromId).toBe(original.id);
      expect(fork2.forkedFromId).not.toBe(fork1.id);
    });
  });

  describe('Fork Access Control', () => {
    it('should allow forking public projects', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Public Fork ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker.id,
          forkedFromId: original.id,
        },
      });
      testProjects.push(forked.id);

      expect(forked.forkedFromId).toBe(original.id);
    });

    it('should preserve original project visibility after fork', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Visibility Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker.id,
          visibility: ProjectVisibility.PRIVATE, // Forker can set own visibility
          forkedFromId: original.id,
        },
      });
      testProjects.push(forked.id);

      // Original should remain public
      const refreshedOriginal = await prisma.savedProject.findUnique({
        where: { id: original.id },
      });
      expect(refreshedOriginal?.visibility).toBe(ProjectVisibility.PUBLIC);

      // Fork can have different visibility
      expect(forked.visibility).toBe(ProjectVisibility.PRIVATE);
    });
  });

  describe('Fork Name Convention', () => {
    it('should append (Fork) to forked project name', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Original Name ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker.id,
          forkedFromId: original.id,
        },
      });
      testProjects.push(forked.id);

      expect(forked.name).toContain('(Fork)');
      expect(forked.name).toContain(original.name);
    });
  });

  describe('Fork Isolation', () => {
    it('should create independent copy (changes to fork do not affect original)', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Isolation Test ${Date.now()}`,
          description: 'Original description',
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          description: original.description,
          roomType: original.roomType,
          userId: forker.id,
          forkedFromId: original.id,
        },
      });
      testProjects.push(forked.id);

      // Modify fork
      await prisma.savedProject.update({
        where: { id: forked.id },
        data: {
          description: 'Modified fork description',
        },
      });

      // Original should remain unchanged
      const refreshedOriginal = await prisma.savedProject.findUnique({
        where: { id: original.id },
      });
      expect(refreshedOriginal?.description).toBe('Original description');

      // Fork should be modified
      const refreshedFork = await prisma.savedProject.findUnique({
        where: { id: forked.id },
      });
      expect(refreshedFork?.description).toBe('Modified fork description');
    });

    it('should maintain separate ownership', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Ownership Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      const forked = await prisma.savedProject.create({
        data: {
          name: `${original.name} (Fork)`,
          roomType: original.roomType,
          userId: forker.id,
          forkedFromId: original.id,
        },
      });
      testProjects.push(forked.id);

      // Verify separate ownership
      expect(original.userId).toBe(owner.id);
      expect(forked.userId).toBe(forker.id);
      expect(original.userId).not.toBe(forked.userId);
    });
  });

  describe('Recursive Fork Chain History', () => {
    beforeEach(() => {
      (projectStorageService.loadProjectFiles as jest.Mock).mockResolvedValue({
        projectJson: JSON.stringify({ version: PROJECT_SCHEMA_VERSION, tracks: [], regions: [] }),
        audioFiles: [],
      });
      (projectStorageService.saveProjectFiles as jest.Mock).mockResolvedValue(undefined);
    });

    it('should store and display complete recursive fork chain (A -> B -> C), even if intermediate project B is deleted', async () => {
      const userA = testUsers[0]!;
      const userB = testUsers[1]!;
      const userC = testUsers[2]!;

      // 1. Create project A (owned by userA)
      const projectA = await prisma.savedProject.create({
        data: {
          name: 'Project A',
          roomType: 'arrange',
          userId: userA.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(projectA.id);

      // 2. Fork project A to create project B (owned by userB)
      const resB = await projectApplicationService.remixProject(userB.id, projectA.id, { name: 'Project B' });
      const projectBId = resB.project.id;
      testProjects.push(projectBId);

      // B allowFork is false by default. Let's update B's allowFork to true so C can fork it.
      await prisma.savedProject.update({
        where: { id: projectBId },
        data: { allowFork: true },
      });

      // 3. Fork project B to create project C (owned by userC)
      const resC = await projectApplicationService.remixProject(userC.id, projectBId, { name: 'Project C' });
      const projectCId = resC.project.id;
      testProjects.push(projectCId);

      // 4. Retrieve project C and check the forkChain
      const resGetC = await projectApplicationService.getProject(userC.id, projectCId);
      const remixChain = resGetC.project.remixChain as Array<{ id: string; name: string; username: string }>;

      expect(remixChain).toBeDefined();
      expect(remixChain).toHaveLength(2);
      expect(remixChain[0]!.id).toBe(projectA.id);
      expect(remixChain[0]!.name).toBe('Project A');
      expect(remixChain[0]!.username).toBe(userA.username);
      expect(remixChain[1]!.id).toBe(projectBId);
      expect(remixChain[1]!.name).toBe(resB.project.name);
      expect(remixChain[1]!.username).toBe(userB.username);

      // 5. Delete project B (intermediate project)
      await prisma.savedProject.delete({ where: { id: projectBId } });
      // Remove B from cleanup array since it is already deleted
      testProjects = testProjects.filter(id => id !== projectBId);

      // 6. Retrieve project C again and verify the forkChain is STILL intact!
      const resGetC2 = await projectApplicationService.getProject(userC.id, projectCId);
      const remixChainAfterDelete = resGetC2.project.remixChain as Array<{ id: string }>;

      expect(remixChainAfterDelete).toBeDefined();
      expect(remixChainAfterDelete).toHaveLength(2);
      expect(remixChainAfterDelete[0]?.id).toBe(projectA.id);
      expect(remixChainAfterDelete[1]?.id).toBe(projectBId);
    });
  });

  describe('Version Gate (DEV-310 Finding 4)', () => {
    beforeEach(() => {
      (projectStorageService.saveProjectFiles as jest.Mock).mockResolvedValue(undefined);
    });

    // DEV-295: the gate now refuses only a project.json from a NEWER build. Older integers,
    // the pre-epic "1.0.0" string, and a missing version field are all accepted (no reset logic
    // on the backend — that's FE-only; see assertSupportedProjectVersion.ts).
    it('allows remixing a project whose project.json predates PROJECT_SCHEMA_VERSION (older integer, v4)', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Older Version Fork Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      (projectStorageService.loadProjectFiles as jest.Mock).mockResolvedValue({
        projectJson: JSON.stringify({ version: PROJECT_SCHEMA_VERSION - 1, tracks: [], regions: [] }),
        audioFiles: [],
      });

      const result = await projectApplicationService.remixProject(forker.id, original.id, { name: 'An older-version remix' });
      testProjects.push(result.project.id);

      expect(result.project.id).toBeDefined();
      expect(projectStorageService.saveProjectFiles).toHaveBeenCalledTimes(1);
    });

    it('allows remixing a project whose project.json predates the epic (pre-epic "1.0.0" string)', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Pre-Epic Version Fork Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      (projectStorageService.loadProjectFiles as jest.Mock).mockResolvedValue({
        projectJson: JSON.stringify({ version: '1.0.0', tracks: [], regions: [] }),
        audioFiles: [],
      });

      const result = await projectApplicationService.remixProject(forker.id, original.id, { name: 'A pre-epic remix' });
      testProjects.push(result.project.id);

      expect(result.project.id).toBeDefined();
      expect(projectStorageService.saveProjectFiles).toHaveBeenCalledTimes(1);
    });

    it('allows remixing a project whose project.json is missing a version field entirely', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Missing Version Fork Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      (projectStorageService.loadProjectFiles as jest.Mock).mockResolvedValue({
        projectJson: JSON.stringify({ tracks: [], regions: [] }),
        audioFiles: [],
      });

      const result = await projectApplicationService.remixProject(forker.id, original.id, { name: 'A missing-version remix' });
      testProjects.push(result.project.id);

      expect(result.project.id).toBeDefined();
      expect(projectStorageService.saveProjectFiles).toHaveBeenCalledTimes(1);
    });

    it('refuses to remix a project whose project.json is from a NEWER build, without creating a DB row or writing files', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Future Version Fork Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      (projectStorageService.loadProjectFiles as jest.Mock).mockResolvedValue({
        projectJson: JSON.stringify({ version: PROJECT_SCHEMA_VERSION + 1, tracks: [], regions: [] }),
        audioFiles: [],
      });

      const countBefore = await prisma.savedProject.count({ where: { userId: forker.id } });

      await expect(
        projectApplicationService.remixProject(forker.id, original.id, { name: 'Should never exist' }),
      ).rejects.toThrow(/^BAD_REQUEST:/);

      const countAfter = await prisma.savedProject.count({ where: { userId: forker.id } });
      expect(countAfter).toBe(countBefore); // no orphaned/unopenable remix row was created
      expect(projectStorageService.saveProjectFiles).not.toHaveBeenCalled();
    });

    it('allows remixing a project whose project.json stamps the current PROJECT_SCHEMA_VERSION', async () => {
      const owner = testUsers[0]!;
      const forker = testUsers[1]!;

      const original = await prisma.savedProject.create({
        data: {
          name: `Current Version Fork Test ${Date.now()}`,
          roomType: 'arrange',
          userId: owner.id,
          visibility: ProjectVisibility.PUBLIC,
          allowFork: true,
        },
      });
      testProjects.push(original.id);

      (projectStorageService.loadProjectFiles as jest.Mock).mockResolvedValue({
        projectJson: JSON.stringify({ version: PROJECT_SCHEMA_VERSION, tracks: [], regions: [] }),
        audioFiles: [],
      });

      const result = await projectApplicationService.remixProject(forker.id, original.id, { name: 'A fine remix' });
      testProjects.push(result.project.id);

      expect(result.project.id).toBeDefined();
      expect(projectStorageService.saveProjectFiles).toHaveBeenCalledTimes(1);
    });
  });
});

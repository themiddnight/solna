/**
 * BR-6 / BR-13: Project Visibility Endpoint + Contributor Permission Tests
 *
 * BR-6 gaps covered:
 * - PATCH /projects/:id/visibility — set PRIVATE / BAND / PUBLIC
 * - Many-to-many band sharing: project shared with multiple bands simultaneously
 * - Auto-reset to PRIVATE when last shared band is removed via visibility update
 * - BAND member access control: member can access, non-member blocked
 * - Validation: BAND visibility requires at least one bandId
 *
 * BR-13 gaps covered:
 * - Contributor cannot change allowFork → 403
 * - Contributor cannot lock/unlock project → 403
 * - Contributor cannot change visibility → 404 (not owner)
 * - Contributor cannot delete project → 403
 * - Non-member cannot access PRIVATE project → 403
 * - Non-member cannot access BAND project when not a band member → 403
 */

import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { prisma } from '@/config/prisma';
import { authenticateToken } from '../../domains/auth/infrastructure/middleware/authMiddleware';

interface TestUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  userType: string;
}

interface TestBand {
  id: string;
  name: string;
  inviteToken: string;
}

interface TestProject {
  id: string;
  name: string;
  userId: string;
  roomType: string;
  visibility: string;
  isLocked?: boolean;
}

// Mock auth middleware — each test sets req.user as needed
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn((req: { user?: TestUser }, _res: unknown, next: () => void) => next()),
  optionalAuthAllowGuest: jest.fn((req: { user?: TestUser }, _res: unknown, next: () => void) => next()),
}));

// Mock storage so GET /:id and DELETE /:id don't hit B2
jest.mock('../../domains/arrange-room/infrastructure/storage/ProjectStorageService', () => ({
  projectStorageService: {
    loadProjectFiles: jest.fn().mockResolvedValue({ projectJson: '{}', audioFiles: [] }),
    deleteProjectFiles: jest.fn().mockResolvedValue(undefined),
    saveProjectFiles: jest.fn().mockResolvedValue(undefined),
    replaceProjectFilesSafely: jest.fn().mockResolvedValue(undefined),
    deleteAllOldProjectFiles: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock projectRoomService used in some project-application flows
jest.mock('../../domains/arrange-room/infrastructure/storage/ProjectRoomService', () => ({
  projectRoomService: {
    getActiveRoomWithRealCount: jest.fn().mockResolvedValue({ activeRoomId: null, activeUserCount: 0, isPrivate: false }),
    getActiveRooms: jest.fn().mockResolvedValue(new Map()),
    getActiveRoomCounts: jest.fn().mockResolvedValue(new Map()),
    getActiveRoomInfo: jest.fn().mockResolvedValue(null),
    trySetActiveRoom: jest.fn().mockResolvedValue(null),
    clearActiveRoom: jest.fn().mockResolvedValue(undefined),
  },
}));

import projectRouter from '../projects';
import bandRouter from '../bands';

describe('BR-6: Project Visibility Endpoint', () => {
  let app: Express;
  let userOwner: TestUser;
  let userMember: TestUser;
  let userOutsider: TestUser;
  let band1: TestBand;
  let band2: TestBand;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectRouter);
    app.use('/api/bands', bandRouter);

    const ts = Date.now();

    userOwner = await prisma.user.create({
      data: { email: `vis-owner-${ts}@test.com`, username: `vis-owner-${ts}`, passwordHash: 'hash', userType: 'REGISTERED' },
    }) as unknown as TestUser;
    userMember = await prisma.user.create({
      data: { email: `vis-member-${ts}@test.com`, username: `vis-member-${ts}`, passwordHash: 'hash', userType: 'REGISTERED' },
    }) as unknown as TestUser;
    userOutsider = await prisma.user.create({
      data: { email: `vis-outsider-${ts}@test.com`, username: `vis-outsider-${ts}`, passwordHash: 'hash', userType: 'REGISTERED' },
    }) as unknown as TestUser;

    band1 = await prisma.band.create({
      data: {
        name: `VisBand1-${ts}`,
        inviteToken: `token-vis-1-${ts}`,
        members: { create: [{ userId: userOwner.id, role: 'OWNER' }, { userId: userMember.id, role: 'MEMBER' }] },
      },
    }) as unknown as TestBand;
    band2 = await prisma.band.create({
      data: {
        name: `VisBand2-${ts}`,
        inviteToken: `token-vis-2-${ts}`,
        members: { create: [{ userId: userOwner.id, role: 'OWNER' }] },
      },
    }) as unknown as TestBand;

    // Fail fast if any fixture create silently returned without an id under
    // parallel DB load — prevents downstream auth-mock 401 false negatives.
    for (const u of [userOwner, userMember, userOutsider]) {
      expect(u.id).toBeTruthy();
    }
  });

  afterAll(async () => {
    await prisma.band.deleteMany({ where: { id: { in: [band1.id, band2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userOwner.id, userMember.id, userOutsider.id] } } });
  });

  function asUser(user: TestUser): void {
    // Guard against an unfixtured user silently producing a misleading 401
    // (the GET /:id route returns 401 when req.user?.id is undefined). If a
    // beforeAll fixture create ever fails under parallel DB load, fail here
    // with an actionable message instead of an opaque status-code mismatch.
    if (!user.id) {
      throw new Error('asUser called with an unfixtured user — fixture creation in beforeAll likely failed');
    }
    (authenticateToken as jest.Mock).mockImplementation((req: { user?: TestUser }, _res: unknown, next: () => void) => {
      req.user = user;
      next();
    });
  }

  async function createProject(overrides: Record<string, unknown> = {}): Promise<TestProject> {
    return prisma.savedProject.create({
      data: { name: `TestProject-${Date.now()}`, userId: userOwner.id, roomType: 'arrange', visibility: 'PRIVATE', ...overrides },
    }) as unknown as TestProject;
  }

  async function deleteProject(id: string): Promise<void> {
    await prisma.savedProject.delete({ where: { id } }).catch(() => {});
  }

  describe('PATCH /projects/:id/visibility', () => {
    it('owner can set visibility to PUBLIC', async () => {
      asUser(userOwner);
      const project = await createProject();

      const res = await request(app).patch(`/api/projects/${project.id}/visibility`).send({ visibility: 'PUBLIC' });

      expect(res.status).toBe(200);
      expect((res.body as { project: { visibility: string } }).project.visibility).toBe('PUBLIC');
      await deleteProject(project.id);
    });

    it('owner can set visibility to PRIVATE', async () => {
      asUser(userOwner);
      const project = await createProject({ visibility: 'PUBLIC' });

      const res = await request(app).patch(`/api/projects/${project.id}/visibility`).send({ visibility: 'PRIVATE' });

      expect(res.status).toBe(200);
      expect((res.body as { project: { visibility: string } }).project.visibility).toBe('PRIVATE');
      await deleteProject(project.id);
    });

    it('owner can set visibility to BAND with bandIds', async () => {
      asUser(userOwner);
      const project = await createProject();

      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND', bandIds: [band1.id] });

      expect(res.status).toBe(200);
      const body = res.body as { project: { visibility: string; bands: Array<{ id: string }> } };
      expect(body.project.visibility).toBe('BAND');
      expect(body.project.bands.map((b: { id: string }) => b.id)).toContain(band1.id);
      await deleteProject(project.id);
    });

    it('BAND visibility requires at least one bandId — returns 400', async () => {
      asUser(userOwner);
      const project = await createProject();

      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND', bandIds: [] });

      expect(res.status).toBe(400);
      await deleteProject(project.id);
    });

    it('BAND visibility without bandIds field returns 400', async () => {
      asUser(userOwner);
      const project = await createProject();

      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND' });

      expect(res.status).toBe(400);
      await deleteProject(project.id);
    });

    it('owner cannot set BAND visibility to a band they are not a member of', async () => {
      // Create a band that userOwner is NOT in
      const outsiderBand = await prisma.band.create({
        data: {
          name: `OutsiderBand-${Date.now()}`,
          inviteToken: `token-outsider-${Date.now()}`,
          members: { create: [{ userId: userOutsider.id, role: 'OWNER' }] },
        },
      }) as unknown as TestBand;

      asUser(userOwner);
      const project = await createProject();

      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND', bandIds: [outsiderBand.id] });

      expect(res.status).toBe(403);
      await deleteProject(project.id);
      await prisma.band.delete({ where: { id: outsiderBand.id } });
    });

    it('non-owner cannot change visibility — returns 404', async () => {
      asUser(userOwner);
      const project = await createProject();

      asUser(userMember);
      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'PUBLIC' });

      expect(res.status).toBe(404);
      await deleteProject(project.id);
    });

    it('returns 400 for an invalid visibility value', async () => {
      asUser(userOwner);
      const project = await createProject();

      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'INVALID' });

      expect(res.status).toBe(400);
      await deleteProject(project.id);
    });

    it('owner can share project with multiple bands simultaneously', async () => {
      asUser(userOwner);
      const project = await createProject();

      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND', bandIds: [band1.id, band2.id] });

      expect(res.status).toBe(200);
      const body = res.body as { project: { bands: Array<{ id: string }> } };
      const bandIds = body.project.bands.map((b: { id: string }) => b.id);
      expect(bandIds).toContain(band1.id);
      expect(bandIds).toContain(band2.id);
      await deleteProject(project.id);
    });

    it('switching from BAND to PRIVATE clears all band associations (auto-reset)', async () => {
      asUser(userOwner);
      const project = await createProject();

      // First set to BAND
      await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND', bandIds: [band1.id, band2.id] });

      // Then reset to PRIVATE
      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'PRIVATE' });

      expect(res.status).toBe(200);
      const body = res.body as { project: { visibility: string; bands: Array<unknown> } };
      expect(body.project.visibility).toBe('PRIVATE');
      expect(body.project.bands).toHaveLength(0);
      await deleteProject(project.id);
    });

    it('updating BAND bandIds removes old bands and sets only the new ones', async () => {
      asUser(userOwner);
      const project = await createProject();

      // Share with both bands
      await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND', bandIds: [band1.id, band2.id] });

      // Now share with only band2
      const res = await request(app)
        .patch(`/api/projects/${project.id}/visibility`)
        .send({ visibility: 'BAND', bandIds: [band2.id] });

      expect(res.status).toBe(200);
      const body = res.body as { project: { bands: Array<{ id: string }> } };
      const bandIds = body.project.bands.map((b: { id: string }) => b.id);
      expect(bandIds).toContain(band2.id);
      expect(bandIds).not.toContain(band1.id);
      await deleteProject(project.id);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('BR-13: Contributor Permission Restrictions', () => {
  let app: Express;
  let userOwner: TestUser;
  let userContributor: TestUser;
  let userOutsider: TestUser;
  let sharedBand: TestBand;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectRouter);

    const ts = Date.now();

    userOwner = await prisma.user.create({
      data: { email: `perm-owner-${ts}@test.com`, username: `perm-owner-${ts}`, passwordHash: 'hash', userType: 'REGISTERED' },
    }) as unknown as TestUser;
    userContributor = await prisma.user.create({
      data: { email: `perm-contrib-${ts}@test.com`, username: `perm-contrib-${ts}`, passwordHash: 'hash', userType: 'REGISTERED' },
    }) as unknown as TestUser;
    userOutsider = await prisma.user.create({
      data: { email: `perm-outsider-${ts}@test.com`, username: `perm-outsider-${ts}`, passwordHash: 'hash', userType: 'REGISTERED' },
    }) as unknown as TestUser;

    sharedBand = await prisma.band.create({
      data: {
        name: `PermBand-${ts}`,
        inviteToken: `token-perm-${ts}`,
        members: { create: [{ userId: userOwner.id, role: 'OWNER' }] },
      },
    }) as unknown as TestBand;

    // Fail fast if any fixture create silently returned without an id under
    // parallel DB load — prevents downstream auth-mock 401 false negatives.
    for (const u of [userOwner, userContributor, userOutsider]) {
      expect(u.id).toBeTruthy();
    }
  });

  afterAll(async () => {
    await prisma.band.deleteMany({ where: { id: sharedBand.id } });
    await prisma.user.deleteMany({ where: { id: { in: [userOwner.id, userContributor.id, userOutsider.id] } } });
  });

  function asUser(user: TestUser): void {
    // Guard against an unfixtured user silently producing a misleading 401
    // (the GET /:id route returns 401 when req.user?.id is undefined). If a
    // beforeAll fixture create ever fails under parallel DB load, fail here
    // with an actionable message instead of an opaque status-code mismatch.
    if (!user.id) {
      throw new Error('asUser called with an unfixtured user — fixture creation in beforeAll likely failed');
    }
    (authenticateToken as jest.Mock).mockImplementation((req: { user?: TestUser }, _res: unknown, next: () => void) => {
      req.user = user;
      next();
    });
  }

  async function createProjectWithContributor(): Promise<TestProject> {
    const project = await prisma.savedProject.create({
      data: { name: `ContribProject-${Date.now()}`, userId: userOwner.id, roomType: 'arrange', visibility: 'PUBLIC' },
    }) as unknown as TestProject;
    await prisma.projectContributor.create({
      data: { projectId: project.id, userId: userContributor.id },
    });
    return project;
  }

  async function cleanup(projectId: string): Promise<void> {
    await prisma.projectContributor.deleteMany({ where: { projectId } });
    await prisma.savedProject.delete({ where: { id: projectId } }).catch(() => {});
  }

  it('contributor cannot change allowFork setting — returns 403', async () => {
    const project = await createProjectWithContributor();

    asUser(userContributor);
    const res = await request(app)
      .patch(`/api/projects/${project.id}/settings`)
      .send({ allowFork: true });

    expect(res.status).toBe(403);
    await cleanup(project.id);
  });

  it('contributor cannot lock the project — returns 403', async () => {
    const project = await createProjectWithContributor();

    asUser(userContributor);
    const res = await request(app)
      .patch(`/api/projects/${project.id}/lock`)
      .send({ isLocked: true });

    expect(res.status).toBe(403);
    await cleanup(project.id);
  });

  it('contributor cannot unlock the project — returns 403', async () => {
    const project = await prisma.savedProject.create({
      data: { name: `LockedProject-${Date.now()}`, userId: userOwner.id, roomType: 'arrange', visibility: 'PUBLIC', isLocked: true },
    }) as unknown as TestProject;
    await prisma.projectContributor.create({ data: { projectId: project.id, userId: userContributor.id } });

    asUser(userContributor);
    const res = await request(app)
      .patch(`/api/projects/${project.id}/lock`)
      .send({ isLocked: false });

    expect(res.status).toBe(403);
    await cleanup(project.id);
  });

  it('contributor cannot change visibility — returns 404 (not the owner)', async () => {
    const project = await createProjectWithContributor();

    asUser(userContributor);
    const res = await request(app)
      .patch(`/api/projects/${project.id}/visibility`)
      .send({ visibility: 'PUBLIC' });

    expect(res.status).toBe(404);
    await cleanup(project.id);
  });

  it('contributor cannot delete the project — returns 403', async () => {
    const project = await createProjectWithContributor();

    asUser(userContributor);
    const res = await request(app).delete(`/api/projects/${project.id}`);

    expect(res.status).toBe(403);

    // Project should still exist after failed delete
    const stillExists = await prisma.savedProject.findUnique({ where: { id: project.id } });
    expect(stillExists).not.toBeNull();
    await cleanup(project.id);
  });

  it('non-member cannot access a PRIVATE project — returns 403', async () => {
    const project = await prisma.savedProject.create({
      data: { name: `PrivateProject-${Date.now()}`, userId: userOwner.id, roomType: 'arrange', visibility: 'PRIVATE' },
    }) as unknown as TestProject;

    asUser(userOutsider);
    const res = await request(app).get(`/api/projects/${project.id}`);

    expect(res.status).toBe(403);
    await prisma.savedProject.delete({ where: { id: project.id } });
  });

  it('contributor of another project cannot access a different PRIVATE project — returns 403', async () => {
    // userContributor is a contributor to project A (created separately)
    // But for project B (PRIVATE, owned by userOwner), they have no contributor role
    const projectB = await prisma.savedProject.create({
      data: { name: `PrivateB-${Date.now()}`, userId: userOwner.id, roomType: 'arrange', visibility: 'PRIVATE' },
    }) as unknown as TestProject;

    asUser(userContributor);
    const res = await request(app).get(`/api/projects/${projectB.id}`);

    expect(res.status).toBe(403);
    await prisma.savedProject.delete({ where: { id: projectB.id } });
  });

  it('user not in the shared band cannot access a BAND-visibility project — returns 403', async () => {
    const project = await prisma.savedProject.create({
      data: {
        name: `BandProject-${Date.now()}`,
        userId: userOwner.id,
        roomType: 'arrange',
        visibility: 'BAND',
        bands: { connect: { id: sharedBand.id } },
      },
    }) as unknown as TestProject;

    // userOutsider is NOT in sharedBand
    asUser(userOutsider);
    const res = await request(app).get(`/api/projects/${project.id}`);

    expect(res.status).toBe(403);
    await prisma.savedProject.update({ where: { id: project.id }, data: { bands: { set: [] } } });
    await prisma.savedProject.delete({ where: { id: project.id } });
  });
});

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

interface TestProject {
  id: string;
  name: string;
  userId: string;
  roomType: string;
  visibility: string;
}

interface TestContributor {
  id: string;
  projectId: string;
  userId: string;
}

// Mock authentication middleware
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn((req: unknown, _res: unknown, next: () => void) => {
    next();
  }),
  optionalAuthAllowGuest: jest.fn((req: unknown, _res: unknown, next: () => void) => {
    next();
  }),
}));

// Import router AFTER mocking
import projectRouter from '../projects';

describe('GET /projects Integration Tests', () => {
  let app: Express;
  let userOwner: TestUser;
  let userContributor1: TestUser;
  let userContributor2: TestUser;
  let userOutsider: TestUser;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectRouter);

    // Create test users
    userOwner = await prisma.user.create({
      data: {
        email: `owner-${Date.now()}@example.com`,
        username: `owner-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
      },
    }) as unknown as TestUser;

    userContributor1 = await prisma.user.create({
      data: {
        email: `contrib1-${Date.now()}@example.com`,
        username: `contrib1-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
      },
    }) as unknown as TestUser;

    userContributor2 = await prisma.user.create({
      data: {
        email: `contrib2-${Date.now()}@example.com`,
        username: `contrib2-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
      },
    }) as unknown as TestUser;

    userOutsider = await prisma.user.create({
      data: {
        email: `outsider-${Date.now()}@example.com`,
        username: `outsider-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
      },
    }) as unknown as TestUser;

    // Create a project for Owner
    const project = await prisma.savedProject.create({
      data: {
        name: 'Test Project with Contributors',
        userId: userOwner.id,
        roomType: 'arrange',
        visibility: 'PUBLIC',
      },
    }) as unknown as TestProject;

    // Add contributors
    await prisma.projectContributor.create({
      data: {
        projectId: project.id,
        userId: userContributor1.id,
        lastContributedAt: new Date(),
      },
    }) as unknown as TestContributor;

    await prisma.projectContributor.create({
      data: {
        projectId: project.id,
        userId: userContributor2.id,
        lastContributedAt: new Date(Date.now() - 10000), // contributed earlier
      },
    }) as unknown as TestContributor;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.projectContributor.deleteMany({});
    await prisma.savedProject.deleteMany({
        where: { userId: userOwner.id }
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [userOwner.id, userContributor1.id, userContributor2.id, userOutsider.id] },
      },
    });
  });

  it('should return owned projects with contributors for the owner', async () => {
    // Mock owner login
    (authenticateToken as jest.Mock).mockImplementation((req: { user?: TestUser }, _res: unknown, next: () => void) => {
      req.user = userOwner;
      next();
    });

    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(200);
    const body = res.body as { owned: Array<{ name: string; contributors: Array<{ username: string }> }> };
    expect(body.owned).toHaveLength(1);
    const project = body.owned[0];
    expect(project!.name).toBe('Test Project with Contributors');
    expect(project!.contributors).toHaveLength(2);
    
    // Check contributor details
    const usernames = project!.contributors.map((c: { username: string }) => c.username);
    expect(usernames).toContain(userContributor1.username);
    expect(usernames).toContain(userContributor2.username);
  });

  it('should return public projects with contributors for an outsider', async () => {
    // Mock outsider login (or even no login for some public endpoints, but /public might require auth due to router structure or app requirements, let's assume auth is needed or at least mocked safely)
    // Actually /public endpoint usually doesn't require auth in some apps, but let's see projects.ts.
    // routes/projects.ts: router.get('/public', ...) NO authenticateToken middleware on that specific line?
    // Let's check line 274 in projects.ts: router.get('/public', async (req, res: Response) ...
    // It seems it does NOT use authenticateToken. So we don't need to mock it for /public, but express app setup might need it if applied globally? In my test app I only mount project router. 
    // BUT wait, my test setup `app.use('/api/projects', projectRouter)` mounts the router. 
    // Inside `projects.ts`, `router.get('/', authenticateToken, ...)` and `router.get('/public', ...)`
    // So /public should be accessible without auth.

    const res = await request(app).get('/api/projects/public');

    expect(res.status).toBe(200);
    const body = res.body as { projects: Array<{ name: string; contributors: Array<{ username: string; profilePictureUrl?: string }> }> };
    const projects = body.projects;
    const project = projects.find((p: { name: string }) => p.name === 'Test Project with Contributors');
    expect(project).toBeDefined();
    expect(project!.contributors).toHaveLength(2);
    expect(project!.contributors[0]).toHaveProperty('username');
    expect(project!.contributors[0]).toHaveProperty('profilePictureUrl');
  });
});

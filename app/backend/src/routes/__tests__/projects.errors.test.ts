import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import multer from 'multer';
import type * as ProjectApplicationModule from '../../domains/arrange-room/application/ProjectApplicationService';

/**
 * Error-mapping + remaining boundary tests for routes/projects.ts (TR-31).
 * Harness mirrors routes/__tests__/projects.boundary.test.ts: REAL router with a
 * mocked projectApplicationService and mocked auth middleware (authenticateToken
 * injects a verified registered user so every route reaches its boundary logic).
 *
 * Unlike projects.boundary.test.ts (which stubs the schemas), this file keeps the
 * REAL exported schemas via jest.requireActual so zod validation branches on
 * updateVisibility / updateSettings / saveFromRoom / remix / saveFromRoomUpdate
 * are exercised, not stubbed.
 *
 * Coverage map vs sibling files: boundary/error mappings already pinned in
 * projects.boundary.test.ts (multer 415, createProject schema, active-rooms batch,
 * CONFLICT regex, save-from-room 403 prefixes, export Content-Disposition) and
 * projects.share-access.test.ts are NOT duplicated here.
 */

const mockListProjects = jest.fn() as jest.Mock<Promise<unknown>>;
const mockListPublicProjects = jest.fn() as jest.Mock<Promise<unknown>>;
const mockGetProjectsActiveRoomPresence = jest.fn() as jest.Mock<Promise<unknown>>;
const mockExportCollab = jest.fn() as jest.Mock<Promise<Buffer>>;
const mockExportStems = jest.fn() as jest.Mock<Promise<Buffer>>;
const mockGetProject = jest.fn() as jest.Mock<Promise<unknown>>;
const mockGetLockStatus = jest.fn() as jest.Mock<Promise<unknown>>;
const mockCreateProject = jest.fn() as jest.Mock<Promise<unknown>>;
const mockUpdateVisibility = jest.fn() as jest.Mock<Promise<unknown>>;
const mockUpdateSettings = jest.fn() as jest.Mock<Promise<unknown>>;
const mockSaveFromRoom = jest.fn() as jest.Mock<Promise<unknown>>;
const mockRemixProject = jest.fn() as jest.Mock<Promise<unknown>>;
const mockDeleteProject = jest.fn() as jest.Mock<Promise<unknown>>;
const mockGetActiveRoom = jest.fn() as jest.Mock<Promise<unknown>>;
const mockGetActiveRoomInfo = jest.fn() as jest.Mock<Promise<unknown>>;
const mockResolveShareAccess = jest.fn() as jest.Mock<Promise<unknown>>;
const mockSetActiveRoom = jest.fn() as jest.Mock<Promise<unknown>>;
const mockSaveFromRoomUpdate = jest.fn() as jest.Mock<Promise<unknown>>;
const mockToggleLock = jest.fn() as jest.Mock<Promise<unknown>>;

jest.mock('../../domains/arrange-room/application/ProjectApplicationService', () => {
  // Keep the REAL zod command schemas (they are exported from the same module)
  // so the route's validation branches are exercised against real schemas.
  const actual = jest.requireActual<typeof ProjectApplicationModule>('../../domains/arrange-room/application/ProjectApplicationService');
  return {
    ...actual,
    projectApplicationService: {
      listProjects: (...a: unknown[]) => mockListProjects(...a),
      listPublicProjects: (...a: unknown[]) => mockListPublicProjects(...a),
      getProjectsActiveRoomPresence: (...a: unknown[]) => mockGetProjectsActiveRoomPresence(...a),
      exportCollab: (...a: unknown[]) => mockExportCollab(...a),
      exportStems: (...a: unknown[]) => mockExportStems(...a),
      getProject: (...a: unknown[]) => mockGetProject(...a),
      getLockStatus: (...a: unknown[]) => mockGetLockStatus(...a),
      createProject: (...a: unknown[]) => mockCreateProject(...a),
      updateVisibility: (...a: unknown[]) => mockUpdateVisibility(...a),
      updateSettings: (...a: unknown[]) => mockUpdateSettings(...a),
      saveFromRoom: (...a: unknown[]) => mockSaveFromRoom(...a),
      remixProject: (...a: unknown[]) => mockRemixProject(...a),
      deleteProject: (...a: unknown[]) => mockDeleteProject(...a),
      getActiveRoom: (...a: unknown[]) => mockGetActiveRoom(...a),
      getActiveRoomInfo: (...a: unknown[]) => mockGetActiveRoomInfo(...a),
      resolveShareAccess: (...a: unknown[]) => mockResolveShareAccess(...a),
      setActiveRoom: (...a: unknown[]) => mockSetActiveRoom(...a),
      saveFromRoomUpdate: (...a: unknown[]) => mockSaveFromRoomUpdate(...a),
      toggleLock: (...a: unknown[]) => mockToggleLock(...a),
    },
  };
});

// authenticateToken: inject a verified registered actor so req.user.id is set (TR-33 — the acting
// identity flows from the token, never the body). The actor is read from a closure variable so
// the 401 suite below can simulate "no authenticated user" (jest.mock factories may only close
// over names prefixed with "mock").
let mockAuthUser: { id: string; userType: string; emailVerified: boolean } | undefined = {
  id: 'u1',
  userType: 'REGISTERED',
  emailVerified: true,
};
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: (
    req: { user: { id: string; userType: string; emailVerified: boolean } | undefined },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = mockAuthUser;
    next();
  },
  optionalAuthAllowGuest: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import router AFTER mocking
import projectRouter from '../projects';

const app: Express = express();
app.use(express.json());
app.use('/api/projects', projectRouter);

/** Type-safe dispatch for the parameterized 401 suite. */
function call(method: string, path: string) {
  switch (method) {
    case 'GET':
      return request(app).get(path);
    case 'POST':
      return request(app).post(path).send({});
    case 'PUT':
      return request(app).put(path).send({});
    case 'PATCH':
      return request(app).patch(path).send({});
    case 'DELETE':
      return request(app).delete(path).send({});
    default:
      throw new Error(`unhandled method: ${method}`);
  }
}
// Replica of the global error handler's upload branch (bootstrap/httpLayer.ts):
// multer fileFilter rejections surface here as 415 with the raw error message.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    return;
  }
  if (err.message.includes('Invalid file type')) {
    res.status(415).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err.message });
});

function setHappyPathDefaults(): void {
  mockListProjects.mockResolvedValue({ owned: [], shared: [] });
  mockListPublicProjects.mockResolvedValue({ projects: [] });
  mockGetProjectsActiveRoomPresence.mockResolvedValue([]);
  mockExportCollab.mockResolvedValue(Buffer.from('zip'));
  mockExportStems.mockResolvedValue(Buffer.from('zip'));
  mockGetProject.mockResolvedValue({ id: 'p1', name: 'Jam' });
  mockGetLockStatus.mockResolvedValue({ isLocked: false });
  mockCreateProject.mockResolvedValue({ id: 'p1', name: 'Jam' });
  mockUpdateVisibility.mockResolvedValue({ id: 'p1', visibility: 'PUBLIC' });
  mockUpdateSettings.mockResolvedValue({ id: 'p1', name: 'Renamed' });
  mockSaveFromRoom.mockResolvedValue({ projectId: 'p1' });
  mockRemixProject.mockResolvedValue({ id: 'p2', name: 'Remix' });
  mockDeleteProject.mockResolvedValue({ success: true });
  mockGetActiveRoom.mockResolvedValue({ roomId: 'r1' });
  mockGetActiveRoomInfo.mockResolvedValue({ roomId: 'r1', activeUserCount: 0 });
  mockResolveShareAccess.mockResolvedValue({ access: 'none' });
  mockSetActiveRoom.mockResolvedValue(undefined);
  mockSaveFromRoomUpdate.mockResolvedValue({ projectId: 'p1' });
  mockToggleLock.mockResolvedValue({ isLocked: true });
}

describe('401 guard — no authenticated user (TR-33)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = undefined;
  });

  afterEach(() => {
    mockAuthUser = { id: 'u1', userType: 'REGISTERED', emailVerified: true };
  });

  it.each([
    ['GET', '/api/projects'],
    ['GET', '/api/projects/rooms/r1/export/collab'],
    ['GET', '/api/projects/rooms/r1/export/stems'],
    ['GET', '/api/projects/p1'],
    ['POST', '/api/projects'],
    ['PATCH', '/api/projects/p1/visibility'],
    ['PATCH', '/api/projects/p1/settings'],
    ['POST', '/api/projects/save-from-room'],
    ['POST', '/api/projects/p1/remix'],
    ['DELETE', '/api/projects/p1'],
    ['PUT', '/api/projects/p1/active-room'],
    ['PUT', '/api/projects/p1/save-from-room'],
    ['PATCH', '/api/projects/p1/lock'],
  ])('%s %s rejects with 401 and never touches the service', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(mockListProjects).not.toHaveBeenCalled();
    expect(mockExportCollab).not.toHaveBeenCalled();
    expect(mockExportStems).not.toHaveBeenCalled();
    expect(mockGetProject).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockUpdateVisibility).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(mockSaveFromRoom).not.toHaveBeenCalled();
    expect(mockRemixProject).not.toHaveBeenCalled();
    expect(mockDeleteProject).not.toHaveBeenCalled();
    expect(mockSetActiveRoom).not.toHaveBeenCalled();
    expect(mockSaveFromRoomUpdate).not.toHaveBeenCalled();
    expect(mockToggleLock).not.toHaveBeenCalled();
  });
});

describe('GET /api/projects — list + public list error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns the caller project list', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ owned: [], shared: [] });
    expect(mockListProjects).toHaveBeenCalledWith('u1', expect.anything());
  });

  it('maps a list failure to 500', async () => {
    mockListProjects.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch projects' });
  });

  it('returns the public project list (no auth needed)', async () => {
    const res = await request(app).get('/api/projects/public');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: [] });
    expect(mockListPublicProjects).toHaveBeenCalledWith(expect.anything());
  });

  it('maps a public-list failure to 500', async () => {
    mockListPublicProjects.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/public');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch public projects' });
  });
});

describe('GET /api/projects/rooms/:roomId/export — FORBIDDEN mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('collab export maps FORBIDDEN to 403 with the stripped message', async () => {
    mockExportCollab.mockRejectedValue(new Error('FORBIDDEN: Not allowed to export this project'));
    const res = await request(app).get('/api/projects/rooms/r1/export/collab');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', message: 'Not allowed to export this project' });
  });

  it('collab export maps a generic failure to 500', async () => {
    mockExportCollab.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/rooms/r1/export/collab');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to export project' });
  });

  it('stems export maps FORBIDDEN to 403', async () => {
    mockExportStems.mockRejectedValue(new Error('FORBIDDEN: Not allowed to export stems'));
    const res = await request(app).get('/api/projects/rooms/r1/export/stems');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', message: 'Not allowed to export stems' });
  });

  it('stems export maps a generic failure to 500', async () => {
    mockExportStems.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/rooms/r1/export/stems');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to export stems' });
  });
});

describe('GET /api/projects/:id — error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns the project for the acting user', async () => {
    const res = await request(app).get('/api/projects/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'p1', name: 'Jam' });
    expect(mockGetProject).toHaveBeenCalledWith('u1', 'p1');
  });

  it('maps NOT_FOUND to 404 "Project not found"', async () => {
    mockGetProject.mockRejectedValue(new Error('NOT_FOUND: nope'));
    const res = await request(app).get('/api/projects/ghost');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Project not found' });
  });

  it('maps FORBIDDEN to 403 "Access denied"', async () => {
    mockGetProject.mockRejectedValue(new Error('FORBIDDEN: no access'));
    const res = await request(app).get('/api/projects/p1');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied' });
  });

  it('maps a generic failure to 500', async () => {
    mockGetProject.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/p1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch project' });
  });
});

describe('GET /api/projects/:id/lock-status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns the lock status', async () => {
    const res = await request(app).get('/api/projects/p1/lock-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isLocked: false });
    expect(mockGetLockStatus).toHaveBeenCalledWith('p1');
  });

  it('maps a failure to 500', async () => {
    mockGetLockStatus.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/p1/lock-status');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to check lock status' });
  });
});

describe('POST /api/projects — create error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('maps BAD_REQUEST to 400 with the stripped service message', async () => {
    mockCreateProject.mockRejectedValue(new Error('BAD_REQUEST: projectData is required and must not be empty'));
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'perform', projectData: '{}' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'projectData is required and must not be empty' });
  });

  it('maps LIMIT_REACHED to 403 with the account-type message', async () => {
    mockCreateProject.mockRejectedValue(new Error('LIMIT_REACHED'));
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'perform', projectData: '{}' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Project limit reached',
      message: 'You have reached the maximum number of projects. Please delete an existing project first.',
    });
  });

  it('maps a generic failure to 500', async () => {
    mockCreateProject.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'perform', projectData: '{}' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save project' });
  });
});

describe('PATCH /api/projects/:id/visibility — boundary + error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('rejects an invalid visibility value with 400 (real zod schema)', async () => {
    const res = await request(app).patch('/api/projects/p1/visibility').send({ visibility: 'INVALID' });
    expect(res.status).toBe(400);
    expect(mockUpdateVisibility).not.toHaveBeenCalled();
  });

  it('applies a valid visibility change', async () => {
    const res = await request(app).patch('/api/projects/p1/visibility').send({ visibility: 'PUBLIC' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'p1', visibility: 'PUBLIC' });
    expect(mockUpdateVisibility).toHaveBeenCalledWith('u1', 'p1', { visibility: 'PUBLIC' });
  });

  it('maps NOT_FOUND to 404 with the stripped service message', async () => {
    mockUpdateVisibility.mockRejectedValue(new Error('NOT_FOUND: Project not found or not owned by you'));
    const res = await request(app).patch('/api/projects/p1/visibility').send({ visibility: 'PUBLIC' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Project not found or not owned by you' });
  });

  it('maps FORBIDDEN to 403 with the stripped service message', async () => {
    mockUpdateVisibility.mockRejectedValue(new Error('FORBIDDEN: You are not a member of one or more specified bands'));
    const res = await request(app).patch('/api/projects/p1/visibility').send({ visibility: 'BAND', bandIds: ['b1'] });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You are not a member of one or more specified bands' });
  });

  it('maps a generic failure to 500', async () => {
    mockUpdateVisibility.mockRejectedValue(new Error('boom'));
    const res = await request(app).patch('/api/projects/p1/visibility').send({ visibility: 'PUBLIC' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update visibility' });
  });
});

describe('PATCH /api/projects/:id/settings — boundary + error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('rejects a non-string name with 400 (real zod schema)', async () => {
    const res = await request(app).patch('/api/projects/p1/settings').send({ name: 123 });
    expect(res.status).toBe(400);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('applies valid settings', async () => {
    const res = await request(app).patch('/api/projects/p1/settings').send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'p1', name: 'Renamed' });
    expect(mockUpdateSettings).toHaveBeenCalledWith('u1', 'p1', { name: 'Renamed' });
  });

  it('maps FORBIDDEN to 403', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('FORBIDDEN: Not authorized to update this project'));
    const res = await request(app).patch('/api/projects/p1/settings').send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not authorized to update this project' });
  });

  it('maps a generic failure to 500', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('boom'));
    const res = await request(app).patch('/api/projects/p1/settings').send({ name: 'X' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update project settings' });
  });
});

describe('POST /api/projects/save-from-room — remaining error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('saves the room state to a new project', async () => {
    const res = await request(app).post('/api/projects/save-from-room').send({ roomId: 'r1', name: 'Jam' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projectId: 'p1' });
    expect(mockSaveFromRoom).toHaveBeenCalledWith('u1', expect.objectContaining({ roomId: 'r1', name: 'Jam' }));
  });

  it('rejects a missing roomId with 400 (real zod schema)', async () => {
    const res = await request(app).post('/api/projects/save-from-room').send({});
    expect(res.status).toBe(400);
    expect(mockSaveFromRoom).not.toHaveBeenCalled();
  });

  it('maps BAD_REQUEST to 400', async () => {
    mockSaveFromRoom.mockRejectedValue(new Error('BAD_REQUEST: bad payload'));
    const res = await request(app).post('/api/projects/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad payload' });
  });

  it('maps FORBIDDEN to 403', async () => {
    mockSaveFromRoom.mockRejectedValue(new Error('FORBIDDEN: not allowed'));
    const res = await request(app).post('/api/projects/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not allowed' });
  });

  it('maps NOT_FOUND to 404', async () => {
    mockSaveFromRoom.mockRejectedValue(new Error('NOT_FOUND: room gone'));
    const res = await request(app).post('/api/projects/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'room gone' });
  });

  it('maps ROOM_OWNER_LIMIT_REACHED to 403 with its own code and message', async () => {
    mockSaveFromRoom.mockRejectedValue(new Error('ROOM_OWNER_LIMIT_REACHED'));
    const res = await request(app).post('/api/projects/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Room owner project limit reached',
      code: 'ROOM_OWNER_LIMIT_REACHED',
      message: 'The room owner has reached their project limit, so this room cannot be saved as a new project.',
    });
  });

  it('maps a generic failure to 500', async () => {
    mockSaveFromRoom.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/projects/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save project from room state' });
  });
});

describe('POST /api/projects/:id/remix — boundary + error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('rejects a missing name with 400 (real zod schema)', async () => {
    const res = await request(app).post('/api/projects/p1/remix').send({});
    expect(res.status).toBe(400);
    expect(mockRemixProject).not.toHaveBeenCalled();
  });

  it('remixes the project (201)', async () => {
    const res = await request(app).post('/api/projects/p1/remix').send({ name: 'Remix' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'p2', name: 'Remix' });
    expect(mockRemixProject).toHaveBeenCalledWith('u1', 'p1', { name: 'Remix' });
  });

  it('maps NOT_FOUND to 404', async () => {
    mockRemixProject.mockRejectedValue(new Error('NOT_FOUND: original project missing'));
    const res = await request(app).post('/api/projects/p1/remix').send({ name: 'Remix' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'original project missing' });
  });

  it('maps FORBIDDEN to 403 (remixing disabled)', async () => {
    mockRemixProject.mockRejectedValue(new Error('FORBIDDEN: This project does not allow remixing'));
    const res = await request(app).post('/api/projects/p1/remix').send({ name: 'Remix' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This project does not allow remixing' });
  });

  it('maps BAD_REQUEST to 400 (cannot remix your own project)', async () => {
    mockRemixProject.mockRejectedValue(new Error('BAD_REQUEST: Cannot remix your own project'));
    const res = await request(app).post('/api/projects/p1/remix').send({ name: 'Remix' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Cannot remix your own project' });
  });

  it('maps LIMIT_REACHED with parseable JSON to 403 carrying the replaceable projects', async () => {
    mockRemixProject.mockRejectedValue(new Error('LIMIT_REACHED: [{"id":"p9","name":"Old"}]'));
    const res = await request(app).post('/api/projects/p1/remix').send({ name: 'Remix' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Project limit reached',
      code: 'PROJECT_LIMIT_REACHED',
      message: 'You have reached the project limit. Please select a project to replace.',
      projects: [{ id: 'p9', name: 'Old' }],
    });
  });

  it('maps LIMIT_REACHED with unparseable payload to 403 without the projects list', async () => {
    mockRemixProject.mockRejectedValue(new Error('LIMIT_REACHED: {{{not json'));
    const res = await request(app).post('/api/projects/p1/remix').send({ name: 'Remix' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Project limit reached' });
  });

  it('maps a generic failure to 500', async () => {
    mockRemixProject.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/projects/p1/remix').send({ name: 'Remix' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to remix project' });
  });
});

describe('DELETE /api/projects/:id — error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('deletes the project', async () => {
    const res = await request(app).delete('/api/projects/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDeleteProject).toHaveBeenCalledWith('u1', 'p1');
  });

  it('maps NOT_FOUND to 404', async () => {
    mockDeleteProject.mockRejectedValue(new Error('NOT_FOUND: no such project'));
    const res = await request(app).delete('/api/projects/ghost');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no such project' });
  });

  it('maps BAD_REQUEST to 400', async () => {
    mockDeleteProject.mockRejectedValue(new Error('BAD_REQUEST: cannot delete'));
    const res = await request(app).delete('/api/projects/p1');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'cannot delete' });
  });

  it('maps a generic failure to 500', async () => {
    mockDeleteProject.mockRejectedValue(new Error('boom'));
    const res = await request(app).delete('/api/projects/p1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete project' });
  });
});

describe('GET /api/projects/:id/active-room + active-room-info', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('returns the active room for a project', async () => {
    const res = await request(app).get('/api/projects/p1/active-room');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roomId: 'r1' });
    expect(mockGetActiveRoom).toHaveBeenCalledWith('p1');
  });

  it('maps BAD_REQUEST to 400', async () => {
    mockGetActiveRoom.mockRejectedValue(new Error('BAD_REQUEST: bad'));
    const res = await request(app).get('/api/projects/p1/active-room');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad' });
  });

  it('maps NOT_FOUND to 404', async () => {
    mockGetActiveRoom.mockRejectedValue(new Error('NOT_FOUND: none'));
    const res = await request(app).get('/api/projects/p1/active-room');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'none' });
  });

  it('maps a generic failure to 500', async () => {
    mockGetActiveRoom.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/p1/active-room');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to get active room' });
  });

  it('returns the active-room info (guest-viewable)', async () => {
    const res = await request(app).get('/api/projects/p1/active-room-info');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roomId: 'r1', activeUserCount: 0 });
    expect(mockGetActiveRoomInfo).toHaveBeenCalledWith('p1');
  });

  it('maps BAD_REQUEST to 400', async () => {
    mockGetActiveRoomInfo.mockRejectedValue(new Error('BAD_REQUEST: bad'));
    const res = await request(app).get('/api/projects/p1/active-room-info');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad' });
  });

  it('maps NOT_FOUND to 404', async () => {
    mockGetActiveRoomInfo.mockRejectedValue(new Error('NOT_FOUND: none'));
    const res = await request(app).get('/api/projects/p1/active-room-info');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'none' });
  });

  it('maps a generic failure to 500', async () => {
    mockGetActiveRoomInfo.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/projects/p1/active-room-info');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to get active room info' });
  });
});

describe('PUT /api/projects/:id/active-room — boundary + remaining error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('rejects a missing roomId with 400 and never calls the service', async () => {
    const res = await request(app).put('/api/projects/p1/active-room').send({});
    expect(res.status).toBe(400);
    expect(mockSetActiveRoom).not.toHaveBeenCalled();
  });

  it('sets the active room', async () => {
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockSetActiveRoom).toHaveBeenCalledWith('u1', 'p1', 'r1');
  });

  it('maps BAD_REQUEST to 400', async () => {
    mockSetActiveRoom.mockRejectedValue(new Error('BAD_REQUEST: bad'));
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad' });
  });

  it('maps NOT_FOUND to 404', async () => {
    mockSetActiveRoom.mockRejectedValue(new Error('NOT_FOUND: no project'));
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no project' });
  });

  it('maps FORBIDDEN to 403', async () => {
    mockSetActiveRoom.mockRejectedValue(new Error('FORBIDDEN: no access'));
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'no access' });
  });

  it('maps SERVICE_UNAVAILABLE to 503 with the stripped message', async () => {
    mockSetActiveRoom.mockRejectedValue(new Error('SERVICE_UNAVAILABLE: Room is shutting down'));
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Room is shutting down' });
  });

  it('maps a generic failure to 500', async () => {
    mockSetActiveRoom.mockRejectedValue(new Error('boom'));
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to set active room' });
  });
});

describe('PUT /api/projects/:id/save-from-room — boundary + error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('rejects a missing roomId with 400 (real zod schema)', async () => {
    const res = await request(app).put('/api/projects/p1/save-from-room').send({});
    expect(res.status).toBe(400);
    expect(mockSaveFromRoomUpdate).not.toHaveBeenCalled();
  });

  it('saves the room state over the project', async () => {
    const res = await request(app).put('/api/projects/p1/save-from-room').send({ roomId: 'r1', name: 'Jam' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, projectId: 'p1' });
    expect(mockSaveFromRoomUpdate).toHaveBeenCalledWith('u1', 'p1', expect.objectContaining({ roomId: 'r1', name: 'Jam' }));
  });

  it('maps BAD_REQUEST to 400', async () => {
    mockSaveFromRoomUpdate.mockRejectedValue(new Error('BAD_REQUEST: bad'));
    const res = await request(app).put('/api/projects/p1/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad' });
  });

  it('maps FORBIDDEN to 403', async () => {
    mockSaveFromRoomUpdate.mockRejectedValue(new Error('FORBIDDEN: not allowed'));
    const res = await request(app).put('/api/projects/p1/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not allowed' });
  });

  it('maps NOT_FOUND to 404', async () => {
    mockSaveFromRoomUpdate.mockRejectedValue(new Error('NOT_FOUND: gone'));
    const res = await request(app).put('/api/projects/p1/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'gone' });
  });

  it('maps a generic failure to 500', async () => {
    mockSaveFromRoomUpdate.mockRejectedValue(new Error('boom'));
    const res = await request(app).put('/api/projects/p1/save-from-room').send({ roomId: 'r1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save project from room state' });
  });
});

describe('PATCH /api/projects/:id/lock — boundary + error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHappyPathDefaults();
  });

  it('rejects a missing isLocked with 400 and never calls the service', async () => {
    const res = await request(app).patch('/api/projects/p1/lock').send({});
    expect(res.status).toBe(400);
    expect(mockToggleLock).not.toHaveBeenCalled();
  });

  it('toggles the collaborative lock', async () => {
    const res = await request(app).patch('/api/projects/p1/lock').send({ isLocked: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isLocked: true });
    expect(mockToggleLock).toHaveBeenCalledWith('u1', 'p1', true);
  });

  it('maps NOT_FOUND to 404', async () => {
    mockToggleLock.mockRejectedValue(new Error('NOT_FOUND: no project'));
    const res = await request(app).patch('/api/projects/p1/lock').send({ isLocked: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no project' });
  });

  it('maps FORBIDDEN to 403', async () => {
    mockToggleLock.mockRejectedValue(new Error('FORBIDDEN: not allowed'));
    const res = await request(app).patch('/api/projects/p1/lock').send({ isLocked: true });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not allowed' });
  });

  it('maps a generic failure to 500', async () => {
    mockToggleLock.mockRejectedValue(new Error('boom'));
    const res = await request(app).patch('/api/projects/p1/lock').send({ isLocked: true });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update lock status' });
  });
});

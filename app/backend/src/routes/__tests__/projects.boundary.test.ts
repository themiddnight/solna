import express from 'express';
import request from 'supertest';
import multer from 'multer';

/**
 * Boundary validation + error-mapping tests for routes/projects.ts (TR-31).
 * Harness mirrors routes/__tests__/projects.share-access.test.ts: REAL router with
 * mocked projectApplicationService and mocked auth middleware (authenticateToken
 * injects a verified registered user so every route reaches its boundary logic).
 *
 * The multer fileFilter failure ("Invalid file type: ...") only becomes a 415 in
 * the GLOBAL error handler (bootstrap/httpLayer.ts), so the test app appends a
 * replica of that handler's upload branch below the router — same behavior,
 * exercised end-to-end through supertest.
 */

const mockCreateProject = jest.fn() as jest.Mock<Promise<unknown>>;
const mockPresence = jest.fn() as jest.Mock<Promise<unknown>>;
const mockSetActiveRoom = jest.fn() as jest.Mock<Promise<unknown>>;
const mockSaveFromRoom = jest.fn() as jest.Mock<Promise<unknown>>;
const mockExportCollab = jest.fn() as jest.Mock<Promise<Buffer>>;
const mockExportStems = jest.fn() as jest.Mock<Promise<Buffer>>;

jest.mock('../../domains/arrange-room/application/ProjectApplicationService', () => ({
  projectApplicationService: {
    createProject: (...a: unknown[]): Promise<unknown> => mockCreateProject(...a),
    getProjectsActiveRoomPresence: (...a: unknown[]): Promise<unknown> => mockPresence(...a),
    setActiveRoom: (...a: unknown[]): Promise<unknown> => mockSetActiveRoom(...a),
    saveFromRoom: (...a: unknown[]): Promise<unknown> => mockSaveFromRoom(...a),
    exportCollab: (...a: unknown[]): Promise<Buffer> => mockExportCollab(...a),
    exportStems: (...a: unknown[]): Promise<Buffer> => mockExportStems(...a),
  },
  // schemas imported by the router must still exist as objects
  updateVisibilityCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  updateSettingsCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  saveFromRoomCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  remixProjectCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
  saveFromRoomUpdateCmdSchema: { safeParse: () => ({ success: true, data: {} }) },
}));

// authenticateToken: inject a verified registered actor so req.user.id is set
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'u1', userType: 'REGISTERED', emailVerified: true };
    next();
  },
  optionalAuthAllowGuest: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import projectRouter from '../projects';

const app = express();
app.use(express.json());
app.use('/api/projects', projectRouter);
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

describe('POST /api/projects — multer MIME fileFilter (global 415 handler)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateProject.mockResolvedValue({ id: 'p1', name: 'Jam' });
  });

  it('rejects a non-allow-listed upload MIME with 415 before the handler runs', async () => {
    const res = await request(app)
      .post('/api/projects')
      .field('name', 'Jam')
      .field('roomType', 'perform')
      .field('projectData', '{}')
      .attach('audioFiles', Buffer.from('nope'), { filename: 'evil.txt', contentType: 'text/plain' });

    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Invalid file type: text/plain' });
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('lets an allow-listed audio MIME through to createProject', async () => {
    const res = await request(app)
      .post('/api/projects')
      .field('name', 'Jam')
      .field('roomType', 'perform')
      .field('projectData', '{}')
      .attach('audioFiles', Buffer.from('RIFF....WEBM'), { filename: 'take1.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(201);
    expect((res.body as { project?: { id: string; name: string } }).project).toEqual({ id: 'p1', name: 'Jam' });
    expect(mockCreateProject).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ name: 'Jam', roomType: 'perform' }),
      [{ fileName: 'take1.webm', buffer: Buffer.from('RIFF....WEBM') }],
    );
  });

  it('normalizes MediaRecorder codec suffixes (audio/webm;codecs=opus) before the MIME check', async () => {
    const res = await request(app)
      .post('/api/projects')
      .field('name', 'Jam')
      .field('roomType', 'perform')
      .field('projectData', '{}')
      .attach('audioFiles', Buffer.from('x'), { filename: 'a.webm', contentType: 'audio/webm;codecs=opus' });

    expect(res.status).toBe(201);
    expect(mockCreateProject).toHaveBeenCalled();
  });
});

describe('POST /api/projects — createProjectFormSchema boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateProject.mockResolvedValue({ id: 'p1', name: 'Jam' });
  });

  it('rejects a bad roomType with 400 and the schema message', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'studio', projectData: '{}' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'roomType must be "perform" or "arrange"' });
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('rejects unparseable projectData JSON with 400', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'perform', projectData: '{not json' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid projectData JSON' });
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("coerces allowRemix 'true'/'false' strings to booleans before createProject", async () => {
    const resTrue = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'perform', projectData: '{}', allowRemix: 'true' });
    expect(resTrue.status).toBe(201);
    expect(mockCreateProject).toHaveBeenLastCalledWith('u1', expect.objectContaining({ allowRemix: true }), []);

    const resFalse = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'perform', projectData: '{}', allowRemix: 'false' });
    expect(resFalse.status).toBe(201);
    expect(mockCreateProject).toHaveBeenLastCalledWith('u1', expect.objectContaining({ allowRemix: false }), []);
  });

  it('falls back to {} silently when metadata JSON is unparseable (no 400)', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'arrange', projectData: '{"tracks":[]}', metadata: '{oops' });

    expect(res.status).toBe(201);
    expect(mockCreateProject).toHaveBeenCalledWith('u1', expect.objectContaining({ metadata: {} }), []);
  });

  it('parses valid metadata JSON into the command', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Jam', roomType: 'arrange', projectData: '{}', metadata: '{"source":"import"}' });

    expect(res.status).toBe(201);
    expect(mockCreateProject).toHaveBeenCalledWith('u1', expect.objectContaining({ metadata: { source: 'import' } }), []);
  });
});

describe('GET /api/projects/active-rooms — batch boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns { presence: [] } for a missing ids query and never calls the service', async () => {
    const res = await request(app).get('/api/projects/active-rooms');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ presence: [] });
    expect(mockPresence).not.toHaveBeenCalled();
  });

  it('returns { presence: [] } when ids contains only commas/whitespace', async () => {
    const res = await request(app).get('/api/projects/active-rooms').query({ ids: ' , , ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ presence: [] });
    expect(mockPresence).not.toHaveBeenCalled();
  });

  it('rejects more than 100 ids with 400', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `p${i}`).join(',');
    const res = await request(app).get('/api/projects/active-rooms').query({ ids });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Too many project ids (max 100)' });
    expect(mockPresence).not.toHaveBeenCalled();
  });

  it('trims whitespace and drops empty segments before calling the service', async () => {
    mockPresence.mockResolvedValue([{ projectId: 'room-a', activeRoomId: 'ra', activeUserCount: 2 }]);
    const res = await request(app).get('/api/projects/active-rooms').query({ ids: ' room-a ,, room-b , ' });
    expect(res.status).toBe(200);
    expect(mockPresence).toHaveBeenCalledWith(['room-a', 'room-b']);
    expect(res.body).toEqual({ presence: [{ projectId: 'room-a', activeRoomId: 'ra', activeUserCount: 2 }] });
  });
});

describe('PUT /api/projects/:id/active-room — CONFLICT regex mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetActiveRoom.mockResolvedValue(undefined);
  });

  it('maps "CONFLICT: ... active room: <id> (<n> users)" to 409 with the parsed fields', async () => {
    mockSetActiveRoom.mockRejectedValue(
      new Error('CONFLICT: Project already has an active room: r123 (5 users)'),
    );
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Project already has an active room',
      activeRoomId: 'r123',
      activeUserCount: 5,
    });
  });

  it('omits the parsed fields when the message does not match the regex', async () => {
    mockSetActiveRoom.mockRejectedValue(new Error('CONFLICT: something else'));
    const res = await request(app).put('/api/projects/p1/active-room').send({ roomId: 'r1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Project already has an active room' });
  });
});

describe('POST /api/projects/save-from-room — distinct 403 error-prefix mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveFromRoom.mockResolvedValue({ projectId: 'p1' });
  });

  it('maps LIMIT_REACHED to 403 "Project limit reached" (no code field)', async () => {
    mockSaveFromRoom.mockRejectedValue(new Error('LIMIT_REACHED'));
    const res = await request(app).post('/api/projects/save-from-room').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Project limit reached',
      message: 'You have reached the maximum number of projects for your account type.',
    });
  });

  it('maps ROOM_OWNER_IS_GUEST to 403 with its own code and message', async () => {
    mockSaveFromRoom.mockRejectedValue(
      new Error('ROOM_OWNER_IS_GUEST: Room owner must be a registered account to save this project'),
    );
    const res = await request(app).post('/api/projects/save-from-room').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Room owner is a guest',
      code: 'ROOM_OWNER_IS_GUEST',
      message: 'The room owner is a guest account. Ask them to register, or transfer room ownership to a registered member, then save.',
    });
  });

  it('maps ROOM_OWNER_NOT_VERIFIED to 403 with its own code and message', async () => {
    mockSaveFromRoom.mockRejectedValue(
      new Error('ROOM_OWNER_NOT_VERIFIED: Room owner must verify their email'),
    );
    const res = await request(app).post('/api/projects/save-from-room').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Room owner not verified',
      code: 'ROOM_OWNER_NOT_VERIFIED',
      message: 'The room owner must verify their email, or transfer room ownership to a verified member, then save.',
    });
  });
});

describe('GET /api/projects/rooms/:roomId/export — sanitized Content-Disposition', () => {
  const ZIP = Buffer.from('PK\x03\x04fakezip');

  beforeEach(() => {
    jest.clearAllMocks();
    mockExportCollab.mockResolvedValue(ZIP);
    mockExportStems.mockResolvedValue(ZIP);
  });

  it('collab export: Content-Disposition carries the sanitized project name', async () => {
    const res = await request(app)
      .get('/api/projects/rooms/r1/export/collab')
      .query({ projectName: 'My Cool Project!' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toBe('attachment; filename="My_Cool_Project_.collab"');
    // supertest exposes binary bodies as text for application/zip
    expect(res.text).toBe(ZIP.toString());
    expect(mockExportCollab).toHaveBeenCalledWith('u1', 'r1', 'My Cool Project!');
  });

  it('collab export: defaults to "Untitled Project" when projectName is absent', async () => {
    const res = await request(app).get('/api/projects/rooms/r1/export/collab');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Untitled_Project.collab"');
    expect(mockExportCollab).toHaveBeenCalledWith('u1', 'r1', 'Untitled Project');
  });

  it('stems export: sanitized name with the -stems.zip suffix', async () => {
    const res = await request(app)
      .get('/api/projects/rooms/r1/export/stems')
      .query({ projectName: 'Jam/2026*Final' });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Jam_2026_Final-stems.zip"');
    expect(mockExportStems).toHaveBeenCalledWith('u1', 'r1', 'Jam/2026*Final');
  });
});

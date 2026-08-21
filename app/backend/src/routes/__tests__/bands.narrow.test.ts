import type { Express } from 'express';
import express from 'express';
import request from 'supertest';

/**
 * Narrow permission-gate tests for routes/bands.ts (error-prefix mappings + zod boundary).
 * Harness mirrors routes/__tests__/projects.boundary.test.ts: REAL router + mocked
 * bandApplicationService + mocked auth middleware injecting a registered user.
 *
 * Coverage map vs sibling tests in this directory:
 * - Real-DB happy paths (create/join/list) live in bands.routes.test.ts — including the
 *   POST /join/:token 404 for an unknown token — NOT duplicated here.
 * - This file: GET /join/:token NOT_FOUND mapping (preview path, uncovered elsewhere),
 *   owner-only FORBIDDEN mappings (remove-member / leave / delete / refresh-token), and the
 *   invite-by-email zod email validation boundary.
 */

const mockListUserBands = jest.fn() as jest.Mock<Promise<unknown>>;
const mockGetJoinPreview = jest.fn() as jest.Mock<Promise<unknown>>;
const mockJoinBand = jest.fn() as jest.Mock<Promise<unknown>>;
const mockListBandProjects = jest.fn() as jest.Mock<Promise<unknown>>;
const mockUpdateBand = jest.fn() as jest.Mock<Promise<unknown>>;
const mockGetBandDetails = jest.fn() as jest.Mock<Promise<unknown>>;
const mockCreateBand = jest.fn() as jest.Mock<Promise<unknown>>;
const mockRemoveMember = jest.fn() as jest.Mock<Promise<unknown>>;
const mockLeaveBand = jest.fn() as jest.Mock<Promise<unknown>>;
const mockDeleteBand = jest.fn() as jest.Mock<Promise<unknown>>;
const mockRefreshInviteToken = jest.fn() as jest.Mock<Promise<unknown>>;
const mockInviteByEmail = jest.fn() as jest.Mock<Promise<unknown>>;

jest.mock('../../domains/user-management/application/BandApplicationService', () => ({
  bandApplicationService: {
    listUserBands: (...a: unknown[]) => mockListUserBands(...a),
    getJoinPreview: (...a: unknown[]) => mockGetJoinPreview(...a),
    joinBand: (...a: unknown[]) => mockJoinBand(...a),
    listBandProjects: (...a: unknown[]) => mockListBandProjects(...a),
    updateBand: (...a: unknown[]) => mockUpdateBand(...a),
    getBandDetails: (...a: unknown[]) => mockGetBandDetails(...a),
    createBand: (...a: unknown[]) => mockCreateBand(...a),
    removeMember: (...a: unknown[]) => mockRemoveMember(...a),
    leaveBand: (...a: unknown[]) => mockLeaveBand(...a),
    deleteBand: (...a: unknown[]) => mockDeleteBand(...a),
    refreshInviteToken: (...a: unknown[]) => mockRefreshInviteToken(...a),
    inviteByEmail: (...a: unknown[]) => mockInviteByEmail(...a),
  },
}));

// authenticateToken: inject a verified registered actor so req.user.id is set (TR-33 — the acting
// identity flows from the token, never the body). The actor is read from a closure variable so
// the 401 suite below can simulate "no authenticated user" (jest.mock factories may only close
// over names prefixed with "mock").
let mockAuthUser: { id: string; userType: string; emailVerified: boolean; username: string | null } | undefined = {
  id: 'u1',
  userType: 'REGISTERED',
  emailVerified: true,
  username: 'tester',
};
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: (
    req: { user: { id: string; userType: string; emailVerified: boolean; username: string | null } | undefined },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = mockAuthUser;
    next();
  },
  optionalAuthAllowGuest: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import bandsRouter from '../bands';

const app: Express = express();
app.use(express.json());
app.use('/api/bands', bandsRouter);

/** Type-safe dispatch for the parameterized 401 suite. */
function call(method: string, path: string) {
  switch (method) {
    case 'GET':
      return request(app).get(path);
    case 'POST':
      return request(app).post(path).send({});
    case 'PATCH':
      return request(app).patch(path).send({});
    case 'DELETE':
      return request(app).delete(path).send({});
    default:
      throw new Error(`unhandled method: ${method}`);
  }
}

describe('GET /api/bands/join/:token — NOT_FOUND invite-link mapping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps NOT_FOUND to 404 "Invalid invite link" (join preview)', async () => {
    mockGetJoinPreview.mockRejectedValue(new Error('NOT_FOUND: Invalid invite link'));
    const res = await request(app).get('/api/bands/join/not-a-real-token');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Invalid invite link' });
    expect(mockGetJoinPreview).toHaveBeenCalledWith('not-a-real-token');
  });
});

describe('owner-only mutations — FORBIDDEN mapping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DELETE /:id/members/:memberId by a non-owner → 403 with the stripped service message', async () => {
    mockRemoveMember.mockRejectedValue(
      new Error('FORBIDDEN: Cannot remove member. You may not be the owner or trying to remove yourself.'),
    );
    const res = await request(app).delete('/api/bands/b1/members/m2');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Cannot remove member. You may not be the owner or trying to remove yourself.' });
    expect(mockRemoveMember).toHaveBeenCalledWith('b1', 'm2', 'u1');
  });

  it('POST /:id/leave by a non-owner → 403', async () => {
    mockLeaveBand.mockRejectedValue(new Error('FORBIDDEN: Cannot leave band. You may be the owner or not a member.'));
    const res = await request(app).post('/api/bands/b1/leave');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Cannot leave band. You may be the owner or not a member.' });
    expect(mockLeaveBand).toHaveBeenCalledWith('b1', 'u1');
  });

  it('DELETE /:id by a non-owner → 403', async () => {
    mockDeleteBand.mockRejectedValue(new Error('FORBIDDEN: Only band owner can delete the band'));
    const res = await request(app).delete('/api/bands/b1');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only band owner can delete the band' });
    expect(mockDeleteBand).toHaveBeenCalledWith('b1', 'u1');
  });

  it('POST /:id/refresh-token by a non-owner → 403 (owner gate)', async () => {
    mockRefreshInviteToken.mockRejectedValue(new Error('FORBIDDEN: Only band owner can refresh invite token'));
    const res = await request(app).post('/api/bands/b1/refresh-token');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only band owner can refresh invite token' });
    expect(mockRefreshInviteToken).toHaveBeenCalledWith('b1', 'u1');
  });

  it('POST /:id/refresh-token by the owner → 200 with the new token', async () => {
    mockRefreshInviteToken.mockResolvedValue({ inviteToken: 'fresh-token' });
    const res = await request(app).post('/api/bands/b1/refresh-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ inviteToken: 'fresh-token' });
  });
});

describe('POST /:id/invite-by-email — zod email validation boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a non-email string with 400 and the schema message, never calling the service', async () => {
    const res = await request(app).post('/api/bands/b1/invite-by-email').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'valid email is required' });
    expect(mockInviteByEmail).not.toHaveBeenCalled();
  });
});

describe('GET /api/bands — list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListUserBands.mockResolvedValue({ bands: [{ id: 'b1', name: 'Testers' }] });
  });

  it('returns the caller band list', async () => {
    const res = await request(app).get('/api/bands');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bands: [{ id: 'b1', name: 'Testers' }] });
    expect(mockListUserBands).toHaveBeenCalledWith('u1', expect.anything());
  });

  it('maps a service failure to 500', async () => {
    mockListUserBands.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/bands');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch bands' });
  });
});

describe('GET /api/bands/join/:token — invite preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetJoinPreview.mockResolvedValue({ band: { id: 'b1', name: 'Testers' } });
  });

  it('returns the preview for a valid token', async () => {
    const res = await request(app).get('/api/bands/join/valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ band: { id: 'b1', name: 'Testers' } });
    expect(mockGetJoinPreview).toHaveBeenCalledWith('valid-token');
  });

  it('maps a generic service failure to 500', async () => {
    mockGetJoinPreview.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/bands/join/valid-token');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch band' });
  });
});

describe('POST /api/bands/join/:token — join', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJoinBand.mockResolvedValue({ band: { id: 'b1', name: 'Testers' } });
  });

  it('joins the band for the acting user', async () => {
    const res = await request(app).post('/api/bands/join/valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ band: { id: 'b1', name: 'Testers' } });
    expect(mockJoinBand).toHaveBeenCalledWith('valid-token', 'u1');
  });

  it('maps a generic service failure to 500', async () => {
    mockJoinBand.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/bands/join/valid-token');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to join band' });
  });
});

describe('GET /api/bands/:id/projects — band project list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListBandProjects.mockResolvedValue({ projects: [] });
  });

  it('returns the projects for a band the caller belongs to', async () => {
    const res = await request(app).get('/api/bands/b1/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: [] });
    expect(mockListBandProjects).toHaveBeenCalledWith('b1', 'u1', expect.anything());
  });

  it('maps FORBIDDEN to 403 with the stripped service message', async () => {
    mockListBandProjects.mockRejectedValue(new Error('FORBIDDEN: You are not a member of this band'));
    const res = await request(app).get('/api/bands/b1/projects');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You are not a member of this band' });
  });

  it('maps a generic service failure to 500', async () => {
    mockListBandProjects.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/bands/b1/projects');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch band projects' });
  });
});

describe('PATCH /api/bands/:id — update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateBand.mockResolvedValue({ band: { id: 'b1', name: 'Renamed' } });
  });

  it('updates the band with only the provided fields', async () => {
    const res = await request(app).patch('/api/bands/b1').send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ band: { id: 'b1', name: 'Renamed' } });
    expect(mockUpdateBand).toHaveBeenCalledWith('b1', 'u1', { name: 'Renamed' });
  });

  it('rejects a non-string name with 400 (zod boundary)', async () => {
    const res = await request(app).patch('/api/bands/b1').send({ name: 123 });
    expect(res.status).toBe(400);
    expect(mockUpdateBand).not.toHaveBeenCalled();
  });

  it('maps BAD_REQUEST to 400 with the stripped service message', async () => {
    mockUpdateBand.mockRejectedValue(new Error('BAD_REQUEST: Band name cannot be empty'));
    const res = await request(app).patch('/api/bands/b1').send({ name: 'X' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Band name cannot be empty' });
  });

  it('maps FORBIDDEN to 403', async () => {
    mockUpdateBand.mockRejectedValue(new Error('FORBIDDEN: Only band owner can update the band'));
    const res = await request(app).patch('/api/bands/b1').send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only band owner can update the band' });
  });

  it('maps a generic service failure to 500', async () => {
    mockUpdateBand.mockRejectedValue(new Error('boom'));
    const res = await request(app).patch('/api/bands/b1').send({ name: 'X' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update band' });
  });
});

describe('GET /api/bands/:id — details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBandDetails.mockResolvedValue({ band: { id: 'b1', name: 'Testers' } });
  });

  it('returns the band details for the acting user', async () => {
    const res = await request(app).get('/api/bands/b1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ band: { id: 'b1', name: 'Testers' } });
    expect(mockGetBandDetails).toHaveBeenCalledWith('b1', 'u1');
  });

  it('maps FORBIDDEN to 403', async () => {
    mockGetBandDetails.mockRejectedValue(new Error('FORBIDDEN: You are not a member of this band'));
    const res = await request(app).get('/api/bands/b1');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You are not a member of this band' });
  });

  it('maps NOT_FOUND to 404 with the stripped service message', async () => {
    mockGetBandDetails.mockRejectedValue(new Error('NOT_FOUND: Band not found'));
    const res = await request(app).get('/api/bands/ghost');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Band not found' });
  });

  it('maps a generic service failure to 500', async () => {
    mockGetBandDetails.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/bands/b1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch band' });
  });
});

describe('POST /api/bands — create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateBand.mockResolvedValue({ band: { id: 'b1', name: 'Testers', inviteToken: 'tok' } });
  });

  it('creates a band owned by the acting user (201)', async () => {
    const res = await request(app).post('/api/bands').send({ name: 'Testers', description: 'd' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ band: { id: 'b1', name: 'Testers', inviteToken: 'tok' } });
    expect(mockCreateBand).toHaveBeenCalledWith('u1', { name: 'Testers', description: 'd' });
  });

  it('maps BAD_REQUEST to 400 with the stripped service message', async () => {
    mockCreateBand.mockRejectedValue(new Error('BAD_REQUEST: Band name is already taken'));
    const res = await request(app).post('/api/bands').send({ name: 'Testers' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Band name is already taken' });
  });

  it('maps a generic service failure to 500', async () => {
    mockCreateBand.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/bands').send({ name: 'Testers' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create band' });
  });
});

describe('POST /:id/invite-by-email — success + remaining error mappings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInviteByEmail.mockResolvedValue({ invited: true });
  });

  it('invites with the actor username as inviter name', async () => {
    const res = await request(app).post('/api/bands/b1/invite-by-email').send({ email: 'friend@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ invited: true });
    expect(mockInviteByEmail).toHaveBeenCalledWith('b1', 'friend@example.com', 'u1', 'tester');
  });

  it('falls back to "A band owner" as inviter name when the actor has no username', async () => {
    mockAuthUser = { id: 'u1', userType: 'REGISTERED', emailVerified: true, username: null };
    try {
      const res = await request(app).post('/api/bands/b1/invite-by-email').send({ email: 'friend@example.com' });
      expect(res.status).toBe(200);
      expect(mockInviteByEmail).toHaveBeenCalledWith('b1', 'friend@example.com', 'u1', 'A band owner');
    } finally {
      mockAuthUser = { id: 'u1', userType: 'REGISTERED', emailVerified: true, username: 'tester' };
    }
  });

  it('maps BAD_REQUEST to 400', async () => {
    mockInviteByEmail.mockRejectedValue(new Error('BAD_REQUEST: Cannot invite yourself'));
    const res = await request(app).post('/api/bands/b1/invite-by-email').send({ email: 'friend@example.com' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Cannot invite yourself' });
  });

  it('maps FORBIDDEN to 403', async () => {
    mockInviteByEmail.mockRejectedValue(new Error('FORBIDDEN: Only band owner can invite'));
    const res = await request(app).post('/api/bands/b1/invite-by-email').send({ email: 'friend@example.com' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only band owner can invite' });
  });

  it('maps NOT_FOUND to 404', async () => {
    mockInviteByEmail.mockRejectedValue(new Error('NOT_FOUND: Band not found'));
    const res = await request(app).post('/api/bands/b1/invite-by-email').send({ email: 'friend@example.com' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Band not found' });
  });

  it('maps a generic service failure to 500', async () => {
    mockInviteByEmail.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/bands/b1/invite-by-email').send({ email: 'friend@example.com' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to send invitation' });
  });
});

describe('401 guard — no authenticated user (TR-33)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = undefined;
  });

  afterEach(() => {
    mockAuthUser = { id: 'u1', userType: 'REGISTERED', emailVerified: true, username: 'tester' };
  });

  it.each([
    ['GET', '/api/bands'],
    ['GET', '/api/bands/b1'],
    ['GET', '/api/bands/b1/projects'],
    // GET /join/:token intentionally has no user guard (public invite preview) — excluded.
    ['POST', '/api/bands'],
    ['POST', '/api/bands/join/tok'],
    ['POST', '/api/bands/b1/leave'],
    ['POST', '/api/bands/b1/refresh-token'],
    ['POST', '/api/bands/b1/invite-by-email'],
    ['PATCH', '/api/bands/b1'],
    ['DELETE', '/api/bands/b1'],
    ['DELETE', '/api/bands/b1/members/m2'],
  ])('%s %s rejects with 401 and never touches the service', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(mockListUserBands).not.toHaveBeenCalled();
    expect(mockGetBandDetails).not.toHaveBeenCalled();
    expect(mockListBandProjects).not.toHaveBeenCalled();
    expect(mockGetJoinPreview).not.toHaveBeenCalled();
    expect(mockCreateBand).not.toHaveBeenCalled();
    expect(mockJoinBand).not.toHaveBeenCalled();
    expect(mockLeaveBand).not.toHaveBeenCalled();
    expect(mockRefreshInviteToken).not.toHaveBeenCalled();
    expect(mockInviteByEmail).not.toHaveBeenCalled();
    expect(mockUpdateBand).not.toHaveBeenCalled();
    expect(mockDeleteBand).not.toHaveBeenCalled();
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });
});

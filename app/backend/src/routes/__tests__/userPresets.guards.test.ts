import type { Express } from 'express';
import express from 'express';
import request from 'supertest';

/**
 * Guard-behavior tests for routes/userPresets.ts (TR-31/TR-33 boundary pins).
 * Harness mirrors routes/__tests__/userPresets.feedbackRemoved.test.ts + projects.boundary.test.ts:
 * REAL router + mocked auth middleware (injects a verified registered user) + mocked prisma /
 * aiSettingsService at the boundary — no DB, no tokens.
 *
 * Coverage map vs sibling tests in this directory:
 * - Tour-stamp idempotency (DEV-229): already covered end-to-end (real token + real DB) by
 *   onboardingTourPrompted.test.ts — NOT duplicated here.
 * - This file: PUT /presets/:id ownership gate, PUT /ai-settings "provider required when enabled"
 *   guard, GET /presets invalid-type filter behavior.
 */

const mockPresetFindMany = jest.fn() as jest.Mock<Promise<unknown>>;
const mockPresetFindFirst = jest.fn() as jest.Mock<Promise<unknown>>;
const mockPresetCreate = jest.fn() as jest.Mock<Promise<unknown>>;
const mockPresetUpdate = jest.fn() as jest.Mock<Promise<unknown>>;
const mockPresetDelete = jest.fn() as jest.Mock<Promise<unknown>>;
const mockUserFindUnique = jest.fn() as jest.Mock<Promise<unknown>>;
const mockUserUpdate = jest.fn() as jest.Mock<Promise<unknown>>;
const mockGetSettings = jest.fn() as jest.Mock<Promise<unknown>>;
const mockUpdateSettings = jest.fn() as jest.Mock<Promise<unknown>>;

jest.mock('../../config/prisma', () => ({
  prisma: {
    userPreset: {
      findMany: (...a: unknown[]) => mockPresetFindMany(...a),
      findFirst: (...a: unknown[]) => mockPresetFindFirst(...a),
      create: (...a: unknown[]) => mockPresetCreate(...a),
      update: (...a: unknown[]) => mockPresetUpdate(...a),
      delete: (...a: unknown[]) => mockPresetDelete(...a),
    },
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
  },
}));

jest.mock('../../domains/user-management/domain/services/AiSettingsService', () => ({
  aiSettingsService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a),
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a),
  },
}));

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

jest.mock('../../domains/auth/infrastructure/middleware/guestLimitations', () => ({
  requireRegistered: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import userPresetsRouter from '../userPresets';

const app: Express = express();
app.use(express.json());
app.use('/api/user', userPresetsRouter);

/** Type-safe dispatch for the parameterized 401 suite. */
function call(method: string, path: string) {
  switch (method) {
    case 'GET':
      return request(app).get(path);
    case 'POST':
      return request(app).post(path).send({});
    case 'PUT':
      return request(app).put(path).send({});
    case 'DELETE':
      return request(app).delete(path).send({});
    default:
      throw new Error(`unhandled method: ${method}`);
  }
}

describe('PUT /api/user/presets/:id — ownership gate (cross-user access)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPresetFindFirst.mockResolvedValue({ id: 'p1', userId: 'u1', presetType: 'SYNTH', name: 'Mine', data: {} });
    mockPresetUpdate.mockResolvedValue({ id: 'p1', userId: 'u1', presetType: 'SYNTH', name: 'Renamed', data: {} });
  });

  it("404s when the findFirst (scoped id + acting userId) misses — another user's preset is indistinguishable from a missing one", async () => {
    // Cross-user access gate: the ownership lookup is scoped to { id, userId: req.user.id }, so a
    // preset owned by someone else takes the exact same 404 path as a nonexistent preset — no
    // existence leak, and the acting identity comes from the verified token (TR-33).
    mockPresetFindFirst.mockResolvedValue(null);
    const res = await request(app).put('/api/user/presets/p1').send({ name: 'Renamed' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Preset not found' });
    expect(mockPresetFindFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: 'u1' } });
    expect(mockPresetUpdate).not.toHaveBeenCalled();
  });

  it('updates when the preset belongs to the acting user', async () => {
    const res = await request(app).put('/api/user/presets/p1').send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(mockPresetUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { name: 'Renamed' } });
  });
});

describe('PUT /api/user/ai-settings — "provider is required when enabled" guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateSettings.mockResolvedValue({ provider: 'openai', enabled: true, hasApiKey: false, settings: {} });
  });

  it('rejects enabled=true with no provider (400) and never calls the service', async () => {
    const res = await request(app).put('/api/user/ai-settings').send({ enabled: true });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Provider is required when enabled' });
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('rejects enabled=true with an empty-string provider (400)', async () => {
    const res = await request(app).put('/api/user/ai-settings').send({ enabled: true, provider: '' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Provider is required when enabled' });
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('passes enabled=true through to the service when a provider is present', async () => {
    const res = await request(app).put('/api/user/ai-settings').send({ enabled: true, provider: 'openai' });
    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalledWith('u1', expect.objectContaining({ provider: 'openai', enabled: true }));
  });
});

describe('GET /api/user/presets — preset-type filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPresetFindMany.mockResolvedValue([]);
  });

  it('silently ignores an invalid preset type (no presetType filter applied)', async () => {
    const res = await request(app).get('/api/user/presets').query({ type: 'BOGUS' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ presets: [] });
    // The filter is skipped, not rejected: the query stays scoped to the acting user only.
    expect(mockPresetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('still applies the filter for a valid preset type', async () => {
    const res = await request(app).get('/api/user/presets').query({ type: 'SYNTH' });
    expect(res.status).toBe(200);
    expect(mockPresetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', presetType: 'SYNTH' } }),
    );
  });
});

describe('POST /api/user/presets — create boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPresetCreate.mockResolvedValue({ id: 'p1', userId: 'u1', presetType: 'SYNTH', name: 'Mine', data: {} });
  });

  it('creates a preset scoped to the acting user (201)', async () => {
    const res = await request(app)
      .post('/api/user/presets')
      .send({ presetType: 'SYNTH', name: 'Lead', data: { wave: 'saw' } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ preset: { id: 'p1', userId: 'u1', presetType: 'SYNTH', name: 'Mine', data: {} } });
    expect(mockPresetCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', presetType: 'SYNTH', name: 'Lead', data: { wave: 'saw' } },
    });
  });

  it('rejects a missing name with 400 and the schema message', async () => {
    const res = await request(app).post('/api/user/presets').send({ presetType: 'SYNTH', name: '' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'name is required' });
    expect(mockPresetCreate).not.toHaveBeenCalled();
  });

  it('rejects an unknown presetType with 400', async () => {
    const res = await request(app).post('/api/user/presets').send({ presetType: 'PIANO', name: 'Lead' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid preset type' });
    expect(mockPresetCreate).not.toHaveBeenCalled();
  });

  it('maps a store failure to 500', async () => {
    mockPresetCreate.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/user/presets').send({ presetType: 'SYNTH', name: 'Lead', data: {} });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save preset' });
  });
});

describe('PUT /api/user/presets/:id — update boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPresetFindFirst.mockResolvedValue({ id: 'p1', userId: 'u1', presetType: 'SYNTH', name: 'Mine', data: {} });
    mockPresetUpdate.mockResolvedValue({ id: 'p1', userId: 'u1', presetType: 'SYNTH', name: 'Renamed', data: {} });
  });

  it('rejects a non-string name with 400 before any store call', async () => {
    const res = await request(app).put('/api/user/presets/p1').send({ name: 123 });
    expect(res.status).toBe(400);
    expect(mockPresetFindFirst).not.toHaveBeenCalled();
    expect(mockPresetUpdate).not.toHaveBeenCalled();
  });

  it('maps a store failure to 500', async () => {
    mockPresetUpdate.mockRejectedValue(new Error('db down'));
    const res = await request(app).put('/api/user/presets/p1').send({ name: 'Renamed' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update preset' });
  });
});

describe('DELETE /api/user/presets/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPresetFindFirst.mockResolvedValue({ id: 'p1', userId: 'u1', presetType: 'SYNTH', name: 'Mine', data: {} });
    mockPresetDelete.mockResolvedValue({ id: 'p1' });
  });

  it('deletes a preset owned by the acting user', async () => {
    const res = await request(app).delete('/api/user/presets/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Preset deleted' });
    expect(mockPresetFindFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: 'u1' } });
    expect(mockPresetDelete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it("404s when the ownership lookup misses (another user's preset is indistinguishable from a missing one)", async () => {
    mockPresetFindFirst.mockResolvedValue(null);
    const res = await request(app).delete('/api/user/presets/p1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Preset not found' });
    expect(mockPresetDelete).not.toHaveBeenCalled();
  });

  it('maps a store failure to 500', async () => {
    mockPresetDelete.mockRejectedValue(new Error('db down'));
    const res = await request(app).delete('/api/user/presets/p1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete preset' });
  });
});

describe('PUT /api/user/onboarding-tour-prompted — idempotent stamp (DEV-229)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ onboardingTourPromptedAt: null });
    mockUserUpdate.mockResolvedValue({ id: 'u1', onboardingTourPromptedAt: new Date('2026-08-16T00:00:00.000Z') });
  });

  it('stamps the timestamp on first call and returns the updated user', async () => {
    const res = await request(app).put('/api/user/onboarding-tour-prompted');
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { onboardingTourPromptedAt: expect.any(Date) as unknown },
      select: { id: true, onboardingTourPromptedAt: true },
    });
    expect(res.body).toEqual({ user: { id: 'u1', onboardingTourPromptedAt: '2026-08-16T00:00:00.000Z' } });
  });

  it('leaves the original timestamp untouched on later calls (idempotent — no update)', async () => {
    const already = new Date('2026-01-01T00:00:00.000Z');
    mockUserFindUnique.mockResolvedValue({ onboardingTourPromptedAt: already });
    const res = await request(app).put('/api/user/onboarding-tour-prompted');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: 'u1', onboardingTourPromptedAt: '2026-01-01T00:00:00.000Z' } });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('404s when the user row is missing', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await request(app).put('/api/user/onboarding-tour-prompted');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'User not found' });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('maps a store failure to 500', async () => {
    mockUserUpdate.mockRejectedValue(new Error('db down'));
    const res = await request(app).put('/api/user/onboarding-tour-prompted');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update onboarding tour state' });
  });
});

describe('GET /api/user/ai-settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({ provider: 'openai', enabled: true, hasApiKey: true, settings: {} });
  });

  it('returns the settings for the acting user', async () => {
    const res = await request(app).get('/api/user/ai-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settings: { provider: 'openai', enabled: true, hasApiKey: true, settings: {} },
    });
    expect(mockGetSettings).toHaveBeenCalledWith('u1');
  });

  it('maps a service failure to 500', async () => {
    mockGetSettings.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/user/ai-settings');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to get AI settings' });
  });
});

describe('PUT /api/user/ai-settings — update boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateSettings.mockResolvedValue({ provider: 'openai', enabled: true, hasApiKey: false, settings: {} });
  });

  it('rejects a non-object settings payload with 400', async () => {
    const res = await request(app).put('/api/user/ai-settings').send({ settings: 'nope' });
    expect(res.status).toBe(400);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean enabled with 400', async () => {
    const res = await request(app).put('/api/user/ai-settings').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('defaults enabled to false when not provided', async () => {
    const res = await request(app).put('/api/user/ai-settings').send({ provider: 'openai' });
    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalledWith('u1', { provider: 'openai', enabled: false });
  });

  it('forwards apiKey and settings when provided', async () => {
    const res = await request(app)
      .put('/api/user/ai-settings')
      .send({ provider: 'openai', enabled: true, apiKey: 'sk-123', settings: { model: 'gpt-4' } });
    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalledWith('u1', {
      provider: 'openai',
      enabled: true,
      apiKey: 'sk-123',
      settings: { model: 'gpt-4' },
    });
  });

  it('maps a service failure to 500 with the client-visible detail (non-prod)', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('provider rejected the key'));
    const res = await request(app).put('/api/user/ai-settings').send({ provider: 'openai' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'provider rejected the key' });
  });
});

describe('401 guard — no authenticated user (TR-33)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = undefined;
  });

  afterEach(() => {
    mockAuthUser = { id: 'u1', userType: 'REGISTERED', emailVerified: true };
  });

  it.each([
    ['GET', '/api/user/presets'],
    ['POST', '/api/user/presets'],
    ['PUT', '/api/user/presets/p1'],
    ['DELETE', '/api/user/presets/p1'],
    ['PUT', '/api/user/onboarding-tour-prompted'],
    ['GET', '/api/user/ai-settings'],
    ['PUT', '/api/user/ai-settings'],
  ])('%s %s rejects with 401 and never touches the store', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    expect(mockPresetFindMany).not.toHaveBeenCalled();
    expect(mockPresetCreate).not.toHaveBeenCalled();
    expect(mockPresetFindFirst).not.toHaveBeenCalled();
    expect(mockPresetUpdate).not.toHaveBeenCalled();
    expect(mockPresetDelete).not.toHaveBeenCalled();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});

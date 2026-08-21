import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { prisma } from '@/config/prisma';
import { tokenService } from '../../domain/services/TokenService';

// Real integration path: mint a genuine access token (verified by the real authenticateToken
// middleware) for real registered users, so acting identity flows from the token, never the
// request body (TR-33). Exercises the real AuthController + UserPreferencesService + DB
// (DEV-333 Task 4 — API surface over Tasks 1-3).
import authRouter from '../../../../routes/auth';

interface PreferencesBody {
  theme: string;
  settings: {
    version: number;
    chords?: unknown;
    drumpad?: unknown;
    scaleSlots?: unknown;
  };
}

interface UpdateResponseBody {
  message: string;
  preferences: PreferencesBody;
}

interface ErrorBody {
  error: string;
}

const validChordsPatch = {
  chords: {
    degreeOrder: [6, 5, 4, 3, 2, 1, 0],
    slotModifiers: {},
  },
};

const validDrumpadPatch = {
  drumpad: {
    padOrder: Array.from({ length: 16 }, (_, i) => `pad-${i}`),
    padVolumes: {},
  },
};

const invalidChordsPatch = {
  // Not a permutation of 0..6 -> rejected by the shared zod schema before any repo call.
  chords: {
    degreeOrder: [1, 2],
    slotModifiers: {},
  },
};

describe('GET/PATCH /api/auth/preferences (DEV-333 Task 4)', () => {
  let app: Express;
  let userId: string;
  let token: string;
  let otherUserId: string;
  let otherToken: string;
  let unverifiedUserId: string;
  let unverifiedToken: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);

    const user = await prisma.user.create({
      data: {
        email: `prefs-${Date.now()}@example.com`,
        username: `prefs-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
        emailVerified: true,
      },
    });
    userId = user.id;
    token = tokenService.generateAccessToken({ userId: user.id, email: user.email, userType: user.userType });

    const otherUser = await prisma.user.create({
      data: {
        email: `prefs-other-${Date.now()}@example.com`,
        username: `prefs-other-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
        emailVerified: true,
      },
    });
    otherUserId = otherUser.id;
    otherToken = tokenService.generateAccessToken({
      userId: otherUser.id,
      email: otherUser.email,
      userType: otherUser.userType,
    });

    const unverifiedUser = await prisma.user.create({
      data: {
        email: `prefs-unverified-${Date.now()}@example.com`,
        username: `prefs-unverified-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
        emailVerified: false,
      },
    });
    unverifiedUserId = unverifiedUser.id;
    unverifiedToken = tokenService.generateAccessToken({
      userId: unverifiedUser.id,
      email: unverifiedUser.email,
      userType: unverifiedUser.userType,
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.user.delete({ where: { id: otherUserId } });
    await prisma.user.delete({ where: { id: unverifiedUserId } });
  });

  it('rejects unauthenticated GET', async () => {
    const res = await request(app).get('/api/auth/preferences');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated PATCH', async () => {
    const res = await request(app).patch('/api/auth/preferences').send({ theme: 'murva-light' });
    expect(res.status).toBe(401);
  });

  it('GET returns default theme + empty settings before any row exists', async () => {
    const res = await request(app).get('/api/auth/preferences').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as PreferencesBody;
    expect(body.theme).toBe('murva-dark');
    expect(body.settings).toEqual({ version: 1 });
  });

  it('PATCH rejects an empty body (neither theme nor settings)', async () => {
    const res = await request(app).patch('/api/auth/preferences').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toBe('Nothing to update: provide theme, settings, or both');
  });

  it('PATCH rejects an empty-string theme and writes nothing', async () => {
    // Baseline: default theme, no row yet, established by the "GET returns default theme" test above.
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: '' });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toBe('Theme is required');

    const get = await request(app).get('/api/auth/preferences').set('Authorization', `Bearer ${token}`);
    expect((get.body as PreferencesBody).theme).toBe('murva-dark'); // unchanged (still default)
  });

  it('PATCH with only theme updates theme and leaves settings untouched', async () => {
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'murva-light' });
    expect(res.status).toBe(200);
    const body = res.body as UpdateResponseBody;
    expect(body.message).toBe('Preferences updated successfully');
    expect(body.preferences.theme).toBe('murva-light');
    expect(body.preferences.settings).toEqual({ version: 1 });
  });

  it('PATCH with only settings merges the namespace and leaves theme untouched', async () => {
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: validChordsPatch });
    expect(res.status).toBe(200);
    const body = res.body as UpdateResponseBody;
    expect(body.preferences.theme).toBe('murva-light'); // set by the previous PATCH, unaffected
    expect(body.preferences.settings.chords).toEqual(validChordsPatch.chords);
  });

  it('PATCH with both theme and settings updates both, merging (not overwriting) other namespaces', async () => {
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'murva-dark', settings: validDrumpadPatch });
    expect(res.status).toBe(200);
    const body = res.body as UpdateResponseBody;
    expect(body.preferences.theme).toBe('murva-dark');
    expect(body.preferences.settings.chords).toEqual(validChordsPatch.chords); // untouched namespace survives
    expect(body.preferences.settings.drumpad).toEqual(validDrumpadPatch.drumpad);
  });

  it('PATCH rejects an invalid settings patch with 400 and the service message', async () => {
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: invalidChordsPatch });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toBe('Invalid preferences payload');
  });

  it('PATCH rejects an invalid settings patch even when theme is valid, and leaves theme unchanged (atomicity)', async () => {
    // Establish a known baseline so this test does not depend on execution order elsewhere.
    const baseline = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'murva-dark' });
    expect(baseline.status).toBe(200);

    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'murva-light', settings: invalidChordsPatch });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toBe('Invalid preferences payload');

    // The 400 must mean nothing changed — theme must NOT have been committed on the way
    // to the settings validation failure (DEV-333 Task 4 review finding: combined update
    // must be atomic).
    const get = await request(app).get('/api/auth/preferences').set('Authorization', `Bearer ${token}`);
    expect((get.body as PreferencesBody).theme).toBe('murva-dark');
  });

  it('GET reflects the persisted values after the PATCHes above', async () => {
    const res = await request(app).get('/api/auth/preferences').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as PreferencesBody;
    expect(body.theme).toBe('murva-dark');
    expect(body.settings.chords).toEqual(validChordsPatch.chords);
  });

  it('acting identity comes from the verified token, not a userId in the body (TR-33)', async () => {
    // otherToken authenticates as otherUserId; a body-supplied userId must never redirect the write.
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ theme: 'murva-light', userId });
    expect(res.status).toBe(200);

    const otherGet = await request(app).get('/api/auth/preferences').set('Authorization', `Bearer ${otherToken}`);
    expect((otherGet.body as PreferencesBody).theme).toBe('murva-light');

    // The token owner's (userId) row must be unaffected by the spoofed userId in the body.
    const originalGet = await request(app).get('/api/auth/preferences').set('Authorization', `Bearer ${token}`);
    expect((originalGet.body as PreferencesBody).theme).toBe('murva-dark');
  });

  it('rejects an unverified registered user (the OTP hard gate blocks them at authentication)', async () => {
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${unverifiedToken}`)
      .send({ theme: 'murva-light' });
    expect(res.status).toBe(401);
  });
});

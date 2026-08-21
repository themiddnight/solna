import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { prisma } from '@/config/prisma';
import { tokenService } from '../../domains/auth/domain/services/TokenService';

// Real integration path: mint a genuine access token (verified by the real authenticateToken
// middleware) for a real registered+verified user, so acting identity flows from the token, never
// the body (TR-33). Exercises the real requireRegistered + handler against the DB.
import userPresetsRouter from '../userPresets';

interface MarkPromptedBody {
  user: { id: string; onboardingTourPromptedAt: string | null };
}

describe('PUT /api/user/onboarding-tour-prompted (DEV-220)', () => {
  let app: Express;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/user', userPresetsRouter);

    const user = await prisma.user.create({
      data: {
        email: `tour-${Date.now()}@example.com`,
        username: `tour-${Date.now()}`,
        passwordHash: 'hash',
        userType: 'REGISTERED',
        emailVerified: true,
      },
    });
    userId = user.id;
    token = tokenService.generateAccessToken({ userId: user.id, email: user.email, userType: user.userType });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it('stamps onboardingTourPromptedAt on the first call and is idempotent on the second', async () => {
    const first = await request(app)
      .put('/api/user/onboarding-tour-prompted')
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    const firstBody = first.body as MarkPromptedBody;
    expect(firstBody.user.onboardingTourPromptedAt).not.toBeNull();

    const firstValue = firstBody.user.onboardingTourPromptedAt;
    const second = await request(app)
      .put('/api/user/onboarding-tour-prompted')
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    const secondBody = second.body as MarkPromptedBody;
    expect(secondBody.user.onboardingTourPromptedAt).toBe(firstValue); // unchanged (idempotent)
  }, 15000);

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).put('/api/user/onboarding-tour-prompted');
    expect(res.status).toBe(401);
  }, 15000);
});

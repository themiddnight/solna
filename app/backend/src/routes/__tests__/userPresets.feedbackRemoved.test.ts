import type { Express } from 'express';
import express from 'express';
import request from 'supertest';

// The removed feedback-state routes were auth-gated; mock the middleware so importing the
// router needs no real token/DB. The routes are gone, so these requests fall through to
// Express's default 404 regardless.
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn((req: unknown, _res: unknown, next: () => void) => next()),
  optionalAuthAllowGuest: jest.fn((req: unknown, _res: unknown, next: () => void) => next()),
}));
jest.mock('../../domains/auth/infrastructure/middleware/guestLimitations', () => ({
  requireRegistered: jest.fn((req: unknown, _res: unknown, next: () => void) => next()),
}));

// Import router AFTER mocking
import userPresetsRouter from '../userPresets';

describe('feedback-state routes removed (DEV-220)', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/user', userPresetsRouter);
  });

  it('GET /api/user/feedback-state is 404', async () => {
    const res = await request(app).get('/api/user/feedback-state');
    expect(res.status).toBe(404);
  });

  it('PUT /api/user/feedback-state is 404', async () => {
    const res = await request(app).put('/api/user/feedback-state').send({ action: 'dismissed' });
    expect(res.status).toBe(404);
  });
});

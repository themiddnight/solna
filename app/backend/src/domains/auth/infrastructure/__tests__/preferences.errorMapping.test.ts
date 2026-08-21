import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { prisma } from '@/config/prisma';
import { tokenService } from '../../domain/services/TokenService';

// Auth still runs for real (real token, real authenticateToken, real DB user lookup) so this
// exercises the controller's actual status-code mapping, not a stubbed-out request pipeline.
// Only UserPreferencesService is replaced, so we can force each of its two distinguishable
// error shapes (Task 3) without needing to break the database to get a 500.
jest.mock('../../../user-management/domain/services/UserPreferencesService', () => ({
  userPreferencesService: {
    getPreferences: jest.fn(),
    updateTheme: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

import { userPreferencesService } from '../../../user-management/domain/services/UserPreferencesService';
import { UserPreferencesValidationError } from '../../../user-management/domain/errors/UserPreferencesValidationError';
import authRouter from '../../../../routes/auth';

interface ErrorBody {
  error: string;
}

describe('PATCH /api/auth/preferences — service error -> HTTP status mapping (DEV-333 Task 4)', () => {
  let app: Express;
  let userId: string;
  let token: string;

  const mockGetPreferences = userPreferencesService.getPreferences as jest.Mock;
  const mockUpdateTheme = userPreferencesService.updateTheme as jest.Mock;
  const mockUpdateSettings = userPreferencesService.updateSettings as jest.Mock;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);

    const user = await prisma.user.create({
      data: {
        email: `prefs-err-${Date.now()}@example.com`,
        username: `prefs-err-${Date.now()}`,
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

  beforeEach(() => {
    mockGetPreferences.mockReset().mockResolvedValue({ theme: 'murva-dark', settings: { version: 1 } });
    mockUpdateTheme.mockReset();
    mockUpdateSettings.mockReset();
  });

  it('maps a UserPreferencesValidationError (Zod patch rejection) to 400', async () => {
    mockUpdateSettings.mockRejectedValue(new UserPreferencesValidationError('Invalid preferences payload'));

    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { chords: { degreeOrder: [1, 2], slotModifiers: {} } } });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toBe('Invalid preferences payload');
  });

  it('maps a UserPreferencesValidationError (empty theme) to 400', async () => {
    mockUpdateTheme.mockRejectedValue(new UserPreferencesValidationError('Theme is required'));

    // The controller's own empty-string guard rejects '' before the service is ever
    // called, so this exercises the service's own validation error type via a non-empty
    // value the mock is configured to still reject — proving the mapping is instanceof-
    // based, not tied to the controller's early-return guard.
    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'murva-light' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error).toBe('Theme is required');
  });

  it('does NOT map a plain Error whose message happens to match the validation string to 400', async () => {
    // Regression for the review finding: the split must be instanceof-based, not
    // string-matched. A generic repository Error that merely reuses the same words must
    // still be treated as a server error.
    mockUpdateSettings.mockRejectedValue(new Error('Invalid preferences payload'));

    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { chords: { degreeOrder: [0, 1, 2, 3, 4, 5, 6], slotModifiers: {} } } });

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error).toBe('Invalid preferences payload');
  });

  it('maps a settings repository failure to 500', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('Failed to update preferences. Please try again later.'));

    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { chords: { degreeOrder: [0, 1, 2, 3, 4, 5, 6], slotModifiers: {} } } });

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error).toBe('Failed to update preferences. Please try again later.');
  });

  it('maps a theme repository failure to 500', async () => {
    mockUpdateTheme.mockRejectedValue(new Error('Failed to update theme preference. Please try again later.'));

    const res = await request(app)
      .patch('/api/auth/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'murva-light' });

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).error).toBe('Failed to update theme preference. Please try again later.');
  });
});

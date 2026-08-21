/**
 * AuthController unit tests.
 *
 * The controller is the HTTP boundary of the auth domain: it validates request shapes,
 * delegates to AuthService / UserRepository / userPreferencesService, and serializes
 * responses. These tests run the REAL controller against mocked service seams
 * (AuthService / UserRepository / tokenService / profilePictureService /
 * userPreferencesService), the house pattern for controller tests
 * (cf. preferences.errorMapping.test.ts, projects.saveFromRoom.ownership.test.ts).
 * The real refreshTokenCookie helpers run unchanged, so cookie behavior is asserted
 * end-to-end through res.cookie / res.clearCookie.
 *
 * TR-33: every authenticated endpoint derives the acting identity from `req.user`
 * (populated by the verified-token middleware) — tests assert the controller passes
 * `req.user.id` to the service and never a client-supplied userId.
 *
 * The mock singletons below are module-level so the hoisted jest.mock factories can
 * close over them (Jest hoist rule: only `mock*`-prefixed identifiers are visible
 * inside factories). They are declared BEFORE the imports on purpose: the factories
 * execute at the first import that pulls a mocked module in, so the state objects
 * must already be initialized (a factory referencing a not-yet-initialized const
 * throws "Cannot access ... before initialization").
 *
 * `resetMocks: true` in jest.config.js wipes factory-installed implementations before
 * every test, so beforeEach re-establishes the constructor implementations and per-test
 * mock defaults (verified empirically).
 */

// ---------------------------------------------------------------------------
// Mock seams (module-level so the hoisted jest.mock factories can capture them)
// ---------------------------------------------------------------------------

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  refreshAccessToken: jest.fn(),
  verifyEmailByCode: jest.fn(),
  resendVerificationCode: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  resetPasswordByCode: jest.fn(),
  updateUsername: jest.fn(),
  updateProfilePicture: jest.fn(),
  changePassword: jest.fn(),
};

const mockUserRepository = {
  findById: jest.fn(),
  revokeAllUserRefreshTokens: jest.fn(),
  revokeRefreshToken: jest.fn(),
};

const mockTokenService = {
  generateGuestToken: jest.fn(),
};

const mockProfilePictureService = {
  saveProfilePicture: jest.fn(),
  deleteProfilePictureByUrl: jest.fn(),
};

const mockUserPreferencesService = {
  getPreferences: jest.fn(),
  updateSettings: jest.fn(),
  updateTheme: jest.fn(),
};

jest.mock('../../../domain/services/AuthService', () => {
  const actual = jest.requireActual<typeof AuthServiceModule>('../../../domain/services/AuthService');
  return {
    ...actual,
    AuthService: jest.fn().mockImplementation(() => mockAuthService),
  };
});

jest.mock('../../repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => mockUserRepository),
}));

jest.mock('../../../domain/services/TokenService', () => ({
  tokenService: mockTokenService,
}));

jest.mock('../../../../user-management/infrastructure/services/ProfilePictureService', () => ({
  profilePictureService: mockProfilePictureService,
}));

jest.mock('../../../../user-management/domain/services/UserPreferencesService', () => ({
  userPreferencesService: mockUserPreferencesService,
}));

import type { Request, Response } from 'express';
import { AuthUserModel, UserType } from '../../../domain/models/User';
import { OtpCooldownError } from '../../../domain/services/AuthService';
import { createPartialMock } from '@/testing/mocks';
import { REFRESH_TOKEN_COOKIE } from '../../refreshTokenCookie';
import type { AuthenticatedUser } from '../../middleware/authMiddleware';
import { UserPreferencesValidationError } from '../../../../user-management/domain/errors/UserPreferencesValidationError';
import { AuthController } from '../AuthController';
import { AuthService } from '../../../domain/services/AuthService';
import type * as AuthServiceModule from '../../../domain/services/AuthService';
import { UserRepository } from '../../repositories/UserRepository';

// TR-27 boundary casts: AuthService/UserRepository are module-mocked classes (factories
// above); the casts are confined to this test seam so beforeEach can re-establish the
// constructor implementations that `resetMocks: true` wipes before each test.
const MockAuthServiceCtor = AuthService as unknown as jest.Mock;
const MockUserRepositoryCtor = UserRepository as unknown as jest.Mock;

// TR-27 confined casts: jest's asymmetric matchers are typed `any`, and assigning one as an
// object-literal property trips no-unsafe-assignment at the strict lint gate. These wrappers
// type the matcher results once, at the boundary, so the nested matcher objects in the
// assertions below stay lint-clean.
const matchObject = (obj: Record<string, unknown>): Record<string, unknown> =>
  expect.objectContaining(obj) as Record<string, unknown>;
const matchString = (substring: string): string => expect.stringContaining(substring) as string;
const matchPattern = (pattern: RegExp): string => expect.stringMatching(pattern) as string;
const matchAnyString = (): string => expect.any(String) as string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-1';

function makeUser(overrides: Partial<AuthUserModel> = {}): AuthUserModel {
  const base = {
    id: TEST_USER_ID,
    email: 'test@example.com',
    username: 'testuser',
    passwordHash: 'hash',
    emailVerified: true,
    userType: UserType.REGISTERED,
    profilePictureUrl: null,
    onboardingTourPromptedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const merged = { ...base, ...overrides };
  return new AuthUserModel(
    merged.id,
    merged.email,
    merged.username,
    merged.passwordHash,
    merged.emailVerified,
    merged.userType,
    merged.profilePictureUrl,
    merged.onboardingTourPromptedAt,
    merged.createdAt,
    merged.updatedAt,
  );
}

const makeReq = (
  overrides: { body?: unknown; user?: AuthenticatedUser; cookieHeader?: string; file?: Express.Multer.File } = {},
): jest.Mocked<Request> =>
  createPartialMock<Request>({
    body: overrides.body ?? {},
    user: overrides.user,
    headers: overrides.cookieHeader !== undefined ? { cookie: overrides.cookieHeader } : {},
    file: overrides.file,
  });

const makeRes = (): jest.Mocked<Response> => {
  const res = createPartialMock<Response>({});
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn();
  res.cookie = jest.fn();
  res.clearCookie = jest.fn();
  return res;
};

const makeAuthUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: TEST_USER_ID,
  email: 'test@example.com',
  username: 'testuser',
  userType: 'REGISTERED',
  emailVerified: true,
  ...overrides,
});

const makeUploadFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  createPartialMock<Express.Multer.File>({
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('fake-image'),
    ...overrides,
  });

const OTP_TIMES = {
  otpExpiresAt: new Date('2030-01-01T00:00:00Z'),
  resendAvailableAt: new Date('2030-01-01T00:01:00Z'),
};

beforeEach(() => {
  MockAuthServiceCtor.mockImplementation(() => mockAuthService);
  MockUserRepositoryCtor.mockImplementation(() => mockUserRepository);
});

describe('AuthController.register', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.register.mockReset().mockResolvedValue({
      user: makeUser(),
      verificationSessionToken: 'session-token',
      ...OTP_TIMES,
    });
  });

  it('400 when email, password, or username is missing', async () => {
    const res = makeRes();
    await controller.register(makeReq({ body: { email: 'a@b.co', password: 'password123' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email, password, and username are required' });
    expect(mockAuthService.register).not.toHaveBeenCalled();
  });

  it('400 when a field is an empty string', async () => {
    const res = makeRes();
    await controller.register(makeReq({ body: { email: '', password: 'password123', username: 'u' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400 on an invalid email format', async () => {
    const res = makeRes();
    await controller.register(makeReq({ body: { email: 'not-an-email', password: 'password123', username: 'u' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid email format' });
    expect(mockAuthService.register).not.toHaveBeenCalled();
  });

  it('400 when the password is shorter than 8 characters', async () => {
    const res = makeRes();
    await controller.register(makeReq({ body: { email: 'a@b.co', password: 'short', username: 'u' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password must be at least 8 characters' });
  });

  it('201 on success — serializes the user, the OTP challenge, and hasPassword', async () => {
    const res = makeRes();
    await controller.register(makeReq({ body: { email: 'a@b.co', password: 'password123', username: 'u' } }), res);

    expect(mockAuthService.register).toHaveBeenCalledWith({ email: 'a@b.co', password: 'password123', username: 'u' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: matchString('Registration successful'),
        user: matchObject({
          id: TEST_USER_ID,
          email: 'test@example.com',
          username: 'testuser',
          userType: UserType.REGISTERED,
          emailVerified: true,
          hasPassword: true,
        }),
        verificationSessionToken: 'session-token',
        otpExpiresAt: '2030-01-01T00:00:00.000Z',
        resendAvailableAt: '2030-01-01T00:01:00.000Z',
      }),
    );
  });

  it('201 serializes onboardingTourPromptedAt as ISO and hasPassword false when passwordless', async () => {
    mockAuthService.register.mockResolvedValue({
      user: makeUser({
        passwordHash: null,
        onboardingTourPromptedAt: new Date('2025-06-01T12:00:00Z'),
      }),
      verificationSessionToken: 'session-token',
      ...OTP_TIMES,
    });
    const res = makeRes();
    await controller.register(makeReq({ body: { email: 'a@b.co', password: 'password123', username: 'u' } }), res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: matchObject({
          hasPassword: false,
          onboardingTourPromptedAt: '2025-06-01T12:00:00.000Z',
        }),
      }),
    );
  });

  it('400 when the service rejects with an Error', async () => {
    mockAuthService.register.mockRejectedValue(new Error('Email already registered'));
    const res = makeRes();
    await controller.register(makeReq({ body: { email: 'a@b.co', password: 'password123', username: 'u' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email already registered' });
  });

  it('400 with a generic message when the service rejects with a non-Error', async () => {
    mockAuthService.register.mockRejectedValue('string failure');
    const res = makeRes();
    await controller.register(makeReq({ body: { email: 'a@b.co', password: 'password123', username: 'u' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Registration failed' });
  });
});

describe('AuthController.login', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.login.mockReset().mockResolvedValue({
      user: makeUser(),
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('400 when email or password is missing', async () => {
    const res = makeRes();
    await controller.login(makeReq({ body: { email: 'a@b.co' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email and password are required' });
  });

  it('200 on success — sets the refresh cookie (DEV-197) and returns the access token', async () => {
    const res = makeRes();
    await controller.login(makeReq({ body: { email: 'a@b.co', password: 'password123' } }), res);

    expect(mockAuthService.login).toHaveBeenCalledWith({ email: 'a@b.co', password: 'password123' });
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/api/auth' }),
    );
    expect(res.json).toHaveBeenCalledWith({
      user: matchObject({ id: TEST_USER_ID, hasPassword: true }),
      accessToken: 'access-token',
    });
  });

  it('200 with verificationRequired for an unverified user — no tokens, no cookie', async () => {
    mockAuthService.login.mockResolvedValue({
      user: makeUser({ emailVerified: false }),
      verificationRequired: true,
      verificationSessionToken: 'session-token',
      ...OTP_TIMES,
    });
    const res = makeRes();
    await controller.login(makeReq({ body: { email: 'a@b.co', password: 'password123' } }), res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      user: matchObject({ id: TEST_USER_ID }),
      verificationRequired: true,
      verificationSessionToken: 'session-token',
      otpExpiresAt: '2030-01-01T00:00:00.000Z',
      resendAvailableAt: '2030-01-01T00:01:00.000Z',
    });
  });

  it('401 when the service rejects with an Error', async () => {
    mockAuthService.login.mockRejectedValue(new Error('Invalid email or password'));
    const res = makeRes();
    await controller.login(makeReq({ body: { email: 'a@b.co', password: 'wrong' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid email or password' });
  });

  it('401 with a generic message when the service rejects with a non-Error', async () => {
    mockAuthService.login.mockRejectedValue('string failure');
    const res = makeRes();
    await controller.login(makeReq({ body: { email: 'a@b.co', password: 'wrong' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Login failed' });
  });
});

describe('AuthController.refreshToken', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.refreshAccessToken.mockReset().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
  });

  it('400 when no refresh token is present (neither cookie nor body)', async () => {
    const res = makeRes();
    await controller.refreshToken(makeReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Refresh token is required' });
    expect(mockAuthService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('200 — rotates the cookie with the new refresh token and returns only the access token', async () => {
    const res = makeRes();
    await controller.refreshToken(makeReq({ cookieHeader: `${REFRESH_TOKEN_COOKIE}=old-refresh-token` }), res);

    expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('old-refresh-token');
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, 'new-refresh-token', expect.anything());
    expect(res.json).toHaveBeenCalledWith({ accessToken: 'new-access-token' });
  });

  it('200 — falls back to a body-supplied refresh token for older clients', async () => {
    const res = makeRes();
    await controller.refreshToken(makeReq({ body: { refreshToken: 'body-refresh-token' } }), res);

    expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('body-refresh-token');
    expect(res.json).toHaveBeenCalledWith({ accessToken: 'new-access-token' });
  });

  it('401 on failure — clears the dead refresh cookie so the browser stops replaying it', async () => {
    mockAuthService.refreshAccessToken.mockRejectedValue(new Error('Refresh token has been revoked'));
    const res = makeRes();
    await controller.refreshToken(makeReq({ cookieHeader: `${REFRESH_TOKEN_COOKIE}=old-refresh-token` }), res);

    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Refresh token has been revoked' });
  });
});

describe('AuthController.verifyEmailByCode', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.verifyEmailByCode.mockReset().mockResolvedValue({
      user: makeUser(),
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('400 when the verification session token or code is missing', async () => {
    const res = makeRes();
    await controller.verifyEmailByCode(makeReq({ body: { verificationSessionToken: 'tok' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Verification session token and code are required',
    });
  });

  it('200 — auto-login: sets the refresh cookie and returns the access token + verified user', async () => {
    const res = makeRes();
    await controller.verifyEmailByCode(makeReq({ body: { verificationSessionToken: 'tok', code: '123456' } }), res);

    expect(mockAuthService.verifyEmailByCode).toHaveBeenCalledWith('tok', '123456');
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, 'refresh-token', expect.anything());
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Email verified successfully',
        user: matchObject({ id: TEST_USER_ID, emailVerified: true }),
        accessToken: 'access-token',
      }),
    );
  });

  it('400 when the service rejects', async () => {
    mockAuthService.verifyEmailByCode.mockRejectedValue(new Error('Incorrect verification code'));
    const res = makeRes();
    await controller.verifyEmailByCode(makeReq({ body: { verificationSessionToken: 'tok', code: '000000' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Incorrect verification code' });
  });
});

describe('AuthController.resendVerificationCode', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.resendVerificationCode.mockReset().mockResolvedValue({
      verificationSessionToken: 'session-token',
      ...OTP_TIMES,
    });
  });

  it('400 when the verification session token is missing', async () => {
    const res = makeRes();
    await controller.resendVerificationCode(makeReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Verification session token is required' });
  });

  it('200 on success — message plus a fresh OTP challenge', async () => {
    const res = makeRes();
    await controller.resendVerificationCode(makeReq({ body: { verificationSessionToken: 'tok' } }), res);

    expect(mockAuthService.resendVerificationCode).toHaveBeenCalledWith('tok');
    expect(res.json).toHaveBeenCalledWith({
      message: 'Verification code sent',
      verificationSessionToken: 'session-token',
      otpExpiresAt: '2030-01-01T00:00:00.000Z',
      resendAvailableAt: '2030-01-01T00:01:00.000Z',
    });
  });

  it('429 with resendAvailableAt when the resend cooldown is active (OtpCooldownError)', async () => {
    mockAuthService.resendVerificationCode.mockRejectedValue(
      new OtpCooldownError(new Date('2030-01-01T00:01:00Z')),
    );
    const res = makeRes();
    await controller.resendVerificationCode(makeReq({ body: { verificationSessionToken: 'tok' } }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Please wait before requesting another code',
      resendAvailableAt: '2030-01-01T00:01:00.000Z',
    });
  });

  it('400 for any other service error', async () => {
    mockAuthService.resendVerificationCode.mockRejectedValue(new Error('Email already verified'));
    const res = makeRes();
    await controller.resendVerificationCode(makeReq({ body: { verificationSessionToken: 'tok' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email already verified' });
  });
});

describe('AuthController.forgotPassword', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.requestPasswordReset.mockReset().mockResolvedValue(undefined);
  });

  it('400 when the email is missing', async () => {
    const res = makeRes();
    await controller.forgotPassword(makeReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email is required' });
  });

  it('200 on success — returns the enumeration-safe message', async () => {
    const res = makeRes();
    await controller.forgotPassword(makeReq({ body: { email: 'a@b.co' } }), res);
    expect(mockAuthService.requestPasswordReset).toHaveBeenCalledWith('a@b.co');
    expect(res.json).toHaveBeenCalledWith({
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  });

  it('200 even when the service throws — still returns the same message (no email enumeration)', async () => {
    mockAuthService.requestPasswordReset.mockRejectedValue(new Error('boom'));
    const res = makeRes();
    await controller.forgotPassword(makeReq({ body: { email: 'a@b.co' } }), res);
    expect(res.json).toHaveBeenCalledWith({
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  });
});

describe('AuthController.resetPassword (token path)', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.resetPassword.mockReset().mockResolvedValue(undefined);
  });

  it('400 when the token or new password is missing', async () => {
    const res = makeRes();
    await controller.resetPassword(makeReq({ body: { token: 'tok' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token and new password are required' });
  });

  it('400 when the new password is shorter than 8 characters', async () => {
    const res = makeRes();
    await controller.resetPassword(makeReq({ body: { token: 'tok', newPassword: 'short' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password must be at least 8 characters' });
  });

  it('200 on success', async () => {
    const res = makeRes();
    await controller.resetPassword(makeReq({ body: { token: 'tok', newPassword: 'new-password-123' } }), res);
    expect(mockAuthService.resetPassword).toHaveBeenCalledWith('tok', 'new-password-123');
    expect(res.json).toHaveBeenCalledWith({ message: 'Password reset successful' });
  });

  it('400 when the service rejects', async () => {
    mockAuthService.resetPassword.mockRejectedValue(new Error('Invalid reset token'));
    const res = makeRes();
    await controller.resetPassword(makeReq({ body: { token: 'bad', newPassword: 'new-password-123' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid reset token' });
  });
});

describe('AuthController.resetPasswordByCode', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.resetPasswordByCode.mockReset().mockResolvedValue(undefined);
  });

  it('400 when email, code, or new password is missing', async () => {
    const res = makeRes();
    await controller.resetPasswordByCode(makeReq({ body: { email: 'a@b.co', code: '123456' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email, code, and new password are required' });
  });

  it('400 when the new password is shorter than 8 characters', async () => {
    const res = makeRes();
    await controller.resetPasswordByCode(makeReq({ body: { email: 'a@b.co', code: '123456', newPassword: 'short' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password must be at least 8 characters' });
  });

  it('200 on success', async () => {
    const res = makeRes();
    await controller.resetPasswordByCode(makeReq({ body: { email: 'a@b.co', code: '123456', newPassword: 'new-password-123' } }), res);
    expect(mockAuthService.resetPasswordByCode).toHaveBeenCalledWith('a@b.co', '123456', 'new-password-123');
    expect(res.json).toHaveBeenCalledWith({ message: 'Password reset successful' });
  });

  it('400 when the service rejects', async () => {
    mockAuthService.resetPasswordByCode.mockRejectedValue(new Error('Invalid code or email'));
    const res = makeRes();
    await controller.resetPasswordByCode(makeReq({ body: { email: 'a@b.co', code: '000000', newPassword: 'new-password-123' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid code or email' });
  });
});

describe('AuthController.getCurrentUser', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockUserRepository.findById.mockReset().mockResolvedValue(makeUser());
  });

  it('401 when no authenticated user is present', async () => {
    const res = makeRes();
    await controller.getCurrentUser(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(mockUserRepository.findById).not.toHaveBeenCalled();
  });

  it('404 when the user row is gone', async () => {
    mockUserRepository.findById.mockResolvedValue(null);
    const res = makeRes();
    await controller.getCurrentUser(makeReq({ user: makeAuthUser() }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });

  it('200 — looks up the user by req.user.id (TR-33) and serializes the profile', async () => {
    mockUserRepository.findById.mockResolvedValue(
      makeUser({ onboardingTourPromptedAt: new Date('2025-06-01T12:00:00Z') }),
    );
    const res = makeRes();
    await controller.getCurrentUser(makeReq({ user: makeAuthUser() }), res);

    expect(mockUserRepository.findById).toHaveBeenCalledWith(TEST_USER_ID);
    expect(res.json).toHaveBeenCalledWith({
      user: matchObject({
        id: TEST_USER_ID,
        email: 'test@example.com',
        username: 'testuser',
        hasPassword: true,
        onboardingTourPromptedAt: '2025-06-01T12:00:00.000Z',
      }),
    });
  });

  it('500 when the repository lookup fails', async () => {
    mockUserRepository.findById.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await controller.getCurrentUser(makeReq({ user: makeAuthUser() }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get user' });
  });
});

describe('AuthController.issueGuestToken', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockTokenService.generateGuestToken.mockReset().mockReturnValue('guest-jwt');
  });

  it('200 — trims and caps a client-supplied username, mints a guest-prefixed identity (DEV-179)', async () => {
    const longUsername = 'x'.repeat(80);
    const res = makeRes();
    await controller.issueGuestToken(makeReq({ body: { username: `  ${longUsername}  ` } }), res);

    expect(mockTokenService.generateGuestToken).toHaveBeenCalledWith({
      userId: matchPattern(/^guest:/),
      username: 'x'.repeat(50),
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ guestToken: 'guest-jwt', username: 'x'.repeat(50) }),
    );
  });

  it('200 — falls back to a generated random name when no username is supplied', async () => {
    const res = makeRes();
    await controller.issueGuestToken(makeReq({ body: {} }), res);

    expect(mockTokenService.generateGuestToken).toHaveBeenCalledWith({
      userId: matchPattern(/^guest:/),
      username: matchAnyString(),
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: matchPattern(/^guest:/),
        username: matchAnyString(),
      }),
    );
  });

  it('500 and logs when minting fails', async () => {
    mockTokenService.generateGuestToken.mockImplementation(() => {
      throw new Error('mint failed');
    });
    const res = makeRes();
    await controller.issueGuestToken(makeReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to issue guest token' });
  });
});

describe('AuthController.logout', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockUserRepository.revokeAllUserRefreshTokens.mockReset().mockResolvedValue(undefined);
    mockUserRepository.revokeRefreshToken.mockReset().mockResolvedValue(undefined);
  });

  it('authenticated — revokes by req.user.id (TR-33, never a payload userId) and clears the cookie', async () => {
    const res = makeRes();
    // TR-33: a spoofed userId in the body must be ignored; identity comes from req.user.
    await controller.logout(makeReq({ body: { userId: 'attacker-supplied-id' }, user: makeAuthUser() }), res);

    expect(mockUserRepository.revokeAllUserRefreshTokens).toHaveBeenCalledWith(TEST_USER_ID);
    expect(mockUserRepository.revokeAllUserRefreshTokens).not.toHaveBeenCalledWith('attacker-supplied-id');
    expect(mockUserRepository.revokeRefreshToken).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
  });

  it('unauthenticated — revokes the refresh token from the HttpOnly cookie (DEV-193/DEV-197)', async () => {
    const res = makeRes();
    await controller.logout(makeReq({ cookieHeader: `${REFRESH_TOKEN_COOKIE}=cookie-token` }), res);

    expect(mockUserRepository.revokeRefreshToken).toHaveBeenCalledWith('cookie-token');
    expect(mockUserRepository.revokeAllUserRefreshTokens).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
  });

  it('unauthenticated — falls back to a body-supplied refresh token for older clients', async () => {
    const res = makeRes();
    await controller.logout(makeReq({ body: { refreshToken: 'body-token' } }), res);

    expect(mockUserRepository.revokeRefreshToken).toHaveBeenCalledWith('body-token');
  });

  it('unauthenticated with no token anywhere — no revocation, cookie still cleared, 200', async () => {
    const res = makeRes();
    await controller.logout(makeReq({}), res);

    expect(mockUserRepository.revokeRefreshToken).not.toHaveBeenCalled();
    expect(mockUserRepository.revokeAllUserRefreshTokens).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
  });

  it('still returns 200 and clears the cookie when revocation throws', async () => {
    mockUserRepository.revokeAllUserRefreshTokens.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await controller.logout(makeReq({ user: makeAuthUser() }), res);

    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
  });
});

describe('AuthController.updateUsername', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.updateUsername.mockReset().mockResolvedValue(makeUser({ username: 'newname' }));
  });

  it('401 when no authenticated user is present', async () => {
    const res = makeRes();
    await controller.updateUsername(makeReq({ body: { username: 'newname' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('400 when the username is missing or empty', async () => {
    const res = makeRes();
    await controller.updateUsername(makeReq({ user: makeAuthUser(), body: { username: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Username is required' });
  });

  it('200 — updates by req.user.id (TR-33)', async () => {
    const res = makeRes();
    await controller.updateUsername(makeReq({ user: makeAuthUser(), body: { username: 'newname' } }), res);

    expect(mockAuthService.updateUsername).toHaveBeenCalledWith(TEST_USER_ID, 'newname');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Username updated successfully' }),
    );
  });

  it('400 when the service rejects', async () => {
    mockAuthService.updateUsername.mockRejectedValue(new Error('Username already taken'));
    const res = makeRes();
    await controller.updateUsername(makeReq({ user: makeAuthUser(), body: { username: 'taken' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Username already taken' });
  });
});

describe('AuthController.uploadProfilePicture', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockUserRepository.findById.mockReset().mockResolvedValue(makeUser());
    mockProfilePictureService.saveProfilePicture.mockReset().mockResolvedValue(
      `https://storage.example.com/profile-pictures/${TEST_USER_ID}/new.jpg`,
    );
    mockProfilePictureService.deleteProfilePictureByUrl.mockReset().mockResolvedValue(undefined);
    mockAuthService.updateProfilePicture.mockReset().mockResolvedValue(
      makeUser({ profilePictureUrl: `https://storage.example.com/profile-pictures/${TEST_USER_ID}/new.jpg` }),
    );
  });

  it('401 when no authenticated user is present', async () => {
    const res = makeRes();
    await controller.uploadProfilePicture(makeReq({ file: makeUploadFile() }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('400 when no file was uploaded', async () => {
    const res = makeRes();
    await controller.uploadProfilePicture(makeReq({ user: makeAuthUser() }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'No file uploaded' });
  });

  it('400 on a disallowed MIME type', async () => {
    const res = makeRes();
    await controller.uploadProfilePicture(
      makeReq({ user: makeAuthUser(), file: makeUploadFile({ mimetype: 'application/pdf' }) }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed',
    });
    expect(mockProfilePictureService.saveProfilePicture).not.toHaveBeenCalled();
  });

  it('400 when the file exceeds 5MB', async () => {
    const res = makeRes();
    await controller.uploadProfilePicture(
      makeReq({ user: makeAuthUser(), file: makeUploadFile({ size: 5 * 1024 * 1024 + 1 }) }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'File too large. Maximum size is 5MB' });
  });

  it('200 — uploads, deletes the previous storage-backed picture, and returns the updated user', async () => {
    mockUserRepository.findById.mockResolvedValue(
      makeUser({ profilePictureUrl: 'https://storage.example.com/profile-pictures/user-1/old.jpg' }),
    );
    const res = makeRes();
    await controller.uploadProfilePicture(
      makeReq({ user: makeAuthUser(), file: makeUploadFile({ mimetype: 'image/png' }) }),
      res,
    );

    expect(mockProfilePictureService.deleteProfilePictureByUrl).toHaveBeenCalledWith(
      'https://storage.example.com/profile-pictures/user-1/old.jpg',
    );
    expect(mockProfilePictureService.saveProfilePicture).toHaveBeenCalledWith(
      TEST_USER_ID,
      expect.any(Buffer),
      'image/png',
    );
    expect(mockAuthService.updateProfilePicture).toHaveBeenCalledWith(
      TEST_USER_ID,
      `https://storage.example.com/profile-pictures/${TEST_USER_ID}/new.jpg`,
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Profile picture updated successfully' }),
    );
  });

  it('does NOT delete an OAuth-provider picture when replacing it', async () => {
    mockUserRepository.findById.mockResolvedValue(
      makeUser({ profilePictureUrl: 'https://lh3.googleusercontent.com/a/photo' }),
    );
    const res = makeRes();
    await controller.uploadProfilePicture(
      makeReq({ user: makeAuthUser(), file: makeUploadFile() }),
      res,
    );

    expect(mockProfilePictureService.deleteProfilePictureByUrl).not.toHaveBeenCalled();
    expect(mockProfilePictureService.saveProfilePicture).toHaveBeenCalled();
  });

  it('400 when the service rejects', async () => {
    mockAuthService.updateProfilePicture.mockRejectedValue(new Error('storage failed'));
    const res = makeRes();
    await controller.uploadProfilePicture(
      makeReq({ user: makeAuthUser(), file: makeUploadFile() }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'storage failed' });
  });
});

describe('AuthController.changePassword', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockAuthService.changePassword.mockReset().mockResolvedValue(undefined);
  });

  it('401 when no authenticated user is present', async () => {
    const res = makeRes();
    await controller.changePassword(makeReq({ body: { currentPassword: 'x', newPassword: 'new-password-123' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('400 when the new password is missing', async () => {
    const res = makeRes();
    await controller.changePassword(makeReq({ user: makeAuthUser(), body: { currentPassword: 'x' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'New password is required' });
  });

  it('400 when the new password is shorter than 8 characters', async () => {
    const res = makeRes();
    await controller.changePassword(
      makeReq({ user: makeAuthUser(), body: { currentPassword: 'x', newPassword: 'short' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password must be at least 8 characters' });
  });

  it('200 — changes by req.user.id (TR-33)', async () => {
    const res = makeRes();
    await controller.changePassword(
      makeReq({ user: makeAuthUser(), body: { currentPassword: 'old-password', newPassword: 'new-password-123' } }),
      res,
    );

    expect(mockAuthService.changePassword).toHaveBeenCalledWith(TEST_USER_ID, 'old-password', 'new-password-123');
    expect(res.json).toHaveBeenCalledWith({ message: 'Password changed successfully' });
  });

  it('400 when the service rejects', async () => {
    mockAuthService.changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    const res = makeRes();
    await controller.changePassword(
      makeReq({ user: makeAuthUser(), body: { currentPassword: 'wrong', newPassword: 'new-password-123' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Current password is incorrect' });
  });
});

describe('AuthController.deleteProfilePicture', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockUserRepository.findById.mockReset().mockResolvedValue(makeUser());
    mockProfilePictureService.deleteProfilePictureByUrl.mockReset().mockResolvedValue(undefined);
    mockAuthService.updateProfilePicture.mockReset().mockResolvedValue(makeUser({ profilePictureUrl: null }));
  });

  it('401 when no authenticated user is present', async () => {
    const res = makeRes();
    await controller.deleteProfilePicture(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('200 — deletes a storage-backed picture and clears the URL', async () => {
    mockUserRepository.findById.mockResolvedValue(
      makeUser({ profilePictureUrl: 'https://storage.example.com/profile-pictures/user-1/pic.jpg' }),
    );
    const res = makeRes();
    await controller.deleteProfilePicture(makeReq({ user: makeAuthUser() }), res);

    expect(mockProfilePictureService.deleteProfilePictureByUrl).toHaveBeenCalledWith(
      'https://storage.example.com/profile-pictures/user-1/pic.jpg',
    );
    expect(mockAuthService.updateProfilePicture).toHaveBeenCalledWith(TEST_USER_ID, null);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Profile picture deleted successfully' }),
    );
  });

  it('does NOT delete an OAuth-provider picture', async () => {
    mockUserRepository.findById.mockResolvedValue(
      makeUser({ profilePictureUrl: 'https://lh3.googleusercontent.com/a/photo' }),
    );
    const res = makeRes();
    await controller.deleteProfilePicture(makeReq({ user: makeAuthUser() }), res);

    expect(mockProfilePictureService.deleteProfilePictureByUrl).not.toHaveBeenCalled();
    expect(mockAuthService.updateProfilePicture).toHaveBeenCalledWith(TEST_USER_ID, null);
  });

  it('400 when the service rejects', async () => {
    mockAuthService.updateProfilePicture.mockRejectedValue(new Error('storage failed'));
    const res = makeRes();
    await controller.deleteProfilePicture(makeReq({ user: makeAuthUser() }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'storage failed' });
  });
});

describe('AuthController.getPreferences', () => {
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController();
    mockUserPreferencesService.getPreferences.mockReset().mockResolvedValue({
      theme: 'murva-dark',
      settings: { version: 1 },
    });
  });

  it('401 when no authenticated user is present', async () => {
    const res = makeRes();
    await controller.getPreferences(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('200 — returns preferences for req.user.id (TR-33)', async () => {
    const res = makeRes();
    await controller.getPreferences(makeReq({ user: makeAuthUser() }), res);

    expect(mockUserPreferencesService.getPreferences).toHaveBeenCalledWith(TEST_USER_ID);
    expect(res.json).toHaveBeenCalledWith({ theme: 'murva-dark', settings: { version: 1 } });
  });

  it('500 when the preferences lookup fails', async () => {
    mockUserPreferencesService.getPreferences.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await controller.getPreferences(makeReq({ user: makeAuthUser() }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to get preferences' });
  });
});

describe('AuthController.updatePreferences', () => {
  let controller: AuthController;

  const basePreferences = { theme: 'murva-dark', settings: { version: 1 } };

  beforeEach(() => {
    controller = new AuthController();
    mockUserPreferencesService.getPreferences.mockReset().mockResolvedValue(basePreferences);
    mockUserPreferencesService.updateSettings.mockReset().mockResolvedValue({
      theme: 'murva-dark',
      settings: { version: 2, chords: { degreeOrder: [1, 2] } },
    });
    mockUserPreferencesService.updateTheme.mockReset().mockResolvedValue({
      theme: 'murva-light',
      settings: { version: 1 },
    });
  });

  it('401 when no authenticated user is present', async () => {
    const res = makeRes();
    await controller.updatePreferences(makeReq({ body: { theme: 'murva-light' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('400 when neither theme nor settings is provided', async () => {
    const res = makeRes();
    await controller.updatePreferences(makeReq({ user: makeAuthUser(), body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update: provide theme, settings, or both' });
  });

  it('400 when theme is not a string (TR-31 boundary validation)', async () => {
    const res = makeRes();
    await controller.updatePreferences(makeReq({ user: makeAuthUser(), body: { theme: 123 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Theme must be a string' });
    expect(mockUserPreferencesService.updateTheme).not.toHaveBeenCalled();
  });

  it('400 when settings is an array (not an object)', async () => {
    const res = makeRes();
    await controller.updatePreferences(makeReq({ user: makeAuthUser(), body: { settings: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Settings must be an object' });
  });

  it('400 when theme is an empty string', async () => {
    const res = makeRes();
    await controller.updatePreferences(makeReq({ user: makeAuthUser(), body: { theme: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Theme is required' });
  });

  it('200 — theme only', async () => {
    const res = makeRes();
    await controller.updatePreferences(makeReq({ user: makeAuthUser(), body: { theme: 'murva-light' } }), res);

    expect(mockUserPreferencesService.updateTheme).toHaveBeenCalledWith(TEST_USER_ID, 'murva-light');
    expect(mockUserPreferencesService.updateSettings).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      message: 'Preferences updated successfully',
      preferences: { theme: 'murva-light', settings: { version: 1 } },
    });
  });

  it('200 — settings only', async () => {
    const res = makeRes();
    await controller.updatePreferences(
      makeReq({ user: makeAuthUser(), body: { settings: { chords: { degreeOrder: [1, 2] } } } }),
      res,
    );

    expect(mockUserPreferencesService.updateSettings).toHaveBeenCalledWith(TEST_USER_ID, {
      chords: { degreeOrder: [1, 2] },
    });
    expect(mockUserPreferencesService.updateTheme).not.toHaveBeenCalled();
  });

  it('200 — settings is applied before theme so validation precedes any write (DEV-333 ordering)', async () => {
    const res = makeRes();
    await controller.updatePreferences(
      makeReq({ user: makeAuthUser(), body: { theme: 'murva-light', settings: { version: 2 } } }),
      res,
    );

    expect(mockUserPreferencesService.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mockUserPreferencesService.updateTheme.mock.invocationCallOrder[0]!,
    );
  });

  it('400 on a UserPreferencesValidationError (client error, discriminated by type)', async () => {
    mockUserPreferencesService.updateSettings.mockRejectedValue(
      new UserPreferencesValidationError('Invalid preferences payload'),
    );
    const res = makeRes();
    await controller.updatePreferences(
      makeReq({ user: makeAuthUser(), body: { settings: { chords: { degreeOrder: [0, 1] } } } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid preferences payload' });
  });

  it('500 on any other service failure (repository error)', async () => {
    mockUserPreferencesService.updateTheme.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await controller.updatePreferences(makeReq({ user: makeAuthUser(), body: { theme: 'murva-light' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'db down' });
  });
});

import bcrypt from 'bcrypt';
import type { UserRepository } from '../../../infrastructure/repositories/UserRepository';

jest.mock('@/config/environment', () => ({
  config: {
    nodeEnv: 'test',
    logging: { level: 'error' },
    jwt: {
      emailVerificationExpiresHours: 24,
      passwordResetExpiresHours: 1,
      refreshTokenExpiresIn: '30d',
    },
  },
}));

jest.mock('../TokenService', () => ({
  tokenService: {
    generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
    generateRefreshToken: jest.fn().mockReturnValue('mock-refresh-token'),
    generateEmailVerificationToken: jest.fn().mockReturnValue('mock-verification-token'),
    generatePasswordResetToken: jest.fn().mockReturnValue('mock-reset-token'),
    generateOtpCode: jest.fn().mockReturnValue('123456'),
    generateVerificationSessionToken: jest.fn().mockReturnValue('mock-session-token'),
    verifyVerificationSessionToken: jest.fn(),
    hashToken: jest.fn((raw: string) => `hashed-${raw}`),
    verifyRefreshToken: jest.fn(),
  },
}));

jest.mock('../../../infrastructure/services/EmailService', () => ({
  emailService: {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('bcrypt');

import { AuthUserModel, UserType } from '../../models/User';
import { EmailVerificationModel } from '../../models/EmailVerification';
import { PasswordResetModel } from '../../models/PasswordReset';
import { AuthService, OtpCooldownError } from '../AuthService';
import { tokenService } from '../TokenService';
import { emailService } from '../../../infrastructure/services/EmailService';

const mockTokenService = jest.mocked(tokenService);
const mockEmailService = jest.mocked(emailService);
// bcrypt.hash and bcrypt.compare have multiple overloads (async + callback form).
// jest.mocked() intersects their return types, producing `never` for mockResolvedValue.
// We extract the raw jest.Mock via jest.mocked and expose typed mockImplementation
// helpers to avoid any casts. The module is auto-mocked by jest.mock('bcrypt') above.
const mockBcryptHash = jest.mocked(bcrypt.hash);
const mockBcryptCompare = jest.mocked(bcrypt.compare);

// -------------------------------------------------------------------------
// Test factories — use spread so that explicit null overrides are preserved
// -------------------------------------------------------------------------

function makeUser(overrides: Partial<{
  id: string;
  email: string | null;
  username: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  userType: UserType;
  profilePictureUrl: string | null;
}> = {}): AuthUserModel {
  const base = {
    id: 'user-123',
    email: 'test@example.com' as string | null,
    username: 'testuser' as string | null,
    passwordHash: '$2b$10$hashedpassword' as string | null,
    emailVerified: false,
    userType: UserType.REGISTERED,
    profilePictureUrl: null as string | null,
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
    null,
    new Date('2024-01-01'),
    new Date('2024-01-01'),
  );
}

function makeVerification(overrides?: { isExpired?: boolean; otpCodeHash?: string; otpExpiresAt?: Date; attempts?: number }): EmailVerificationModel {
  const expiresAt = overrides?.isExpired
    ? new Date(Date.now() - 1000)
    : new Date(Date.now() + 3_600_000);
  return new EmailVerificationModel(
    'verif-id',
    'user-123',
    'token-abc',
    overrides?.otpCodeHash ?? null,
    overrides?.otpExpiresAt ?? new Date(Date.now() + 600_000),
    overrides?.attempts ?? 0,
    expiresAt,
    new Date(),
  );
}

function makeReset(overrides?: { isValid?: boolean; otpCodeHash?: string; otpExpiresAt?: Date; attempts?: number }): PasswordResetModel {
  const expiresAt = overrides?.isValid === false
    ? new Date(Date.now() - 1000)
    : new Date(Date.now() + 3_600_000);
  return new PasswordResetModel(
    'reset-id',
    'user-123',
    'reset-abc',
    overrides?.otpCodeHash ?? null,
    overrides?.otpExpiresAt ?? new Date(Date.now() + 600_000),
    overrides?.attempts ?? 0,
    expiresAt,
    new Date(),
    null,
  );
}

// -------------------------------------------------------------------------
// Mock repository
// Typed as jest.Mock (not jest.MockedFunction<specific>) to keep setup
// concise. Methods are called through service internals so TypeScript
// structural compatibility is enforced by the constructor injection below.
// -------------------------------------------------------------------------

type MockRepo = Record<
  | 'findByEmail' | 'findByUsername' | 'findById' | 'create'
  | 'createEmailVerification' | 'findEmailVerificationByToken'
  | 'findEmailVerificationByUserId' | 'incrementEmailVerificationAttempts'
  | 'updateEmailVerified' | 'deleteEmailVerification'
  | 'deleteEmailVerificationsByUserId' | 'createPasswordReset'
  | 'findPasswordResetByToken' | 'findPasswordResetByUserId'
  | 'incrementPasswordResetAttempts'
  | 'updatePassword' | 'markPasswordResetAsUsed'
  | 'deletePasswordResetsByUserId' | 'createOAuthAccount' | 'findOAuthAccount'
  | 'createRefreshToken' | 'findRefreshTokenByToken' | 'revokeRefreshToken'
  | 'updateUsername' | 'updateProfilePictureUrl' | 'revokeAllUserRefreshTokens'
  | 'deleteExpiredRefreshTokens',
  jest.Mock
>;

function makeMockRepo(): MockRepo {
  return {
    findByEmail: jest.fn(),
    findByUsername: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    createEmailVerification: jest.fn().mockResolvedValue({}),
    findEmailVerificationByToken: jest.fn(),
    findEmailVerificationByUserId: jest.fn(),
    incrementEmailVerificationAttempts: jest.fn(),
    updateEmailVerified: jest.fn().mockResolvedValue(undefined),
    deleteEmailVerification: jest.fn().mockResolvedValue(undefined),
    deleteEmailVerificationsByUserId: jest.fn().mockResolvedValue(undefined),
    createPasswordReset: jest.fn().mockResolvedValue({}),
    findPasswordResetByToken: jest.fn(),
    findPasswordResetByUserId: jest.fn(),
    incrementPasswordResetAttempts: jest.fn(),
    updatePassword: jest.fn().mockResolvedValue(undefined),
    markPasswordResetAsUsed: jest.fn().mockResolvedValue(undefined),
    deletePasswordResetsByUserId: jest.fn().mockResolvedValue(undefined),
    createOAuthAccount: jest.fn().mockResolvedValue(undefined),
    findOAuthAccount: jest.fn(),
    createRefreshToken: jest.fn().mockResolvedValue(undefined),
    findRefreshTokenByToken: jest.fn(),
    revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    updateUsername: jest.fn().mockResolvedValue(undefined),
    updateProfilePictureUrl: jest.fn(),
    revokeAllUserRefreshTokens: jest.fn().mockResolvedValue(undefined),
    deleteExpiredRefreshTokens: jest.fn().mockResolvedValue(undefined),
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('AuthService', () => {
  let mockRepo: jest.Mocked<UserRepository>;
  let service: AuthService;

  beforeEach(() => {
    mockRepo = makeMockRepo() as jest.Mocked<UserRepository>;
    service = new AuthService(mockRepo);
    mockBcryptHash.mockImplementation(() => Promise.resolve('hashed-password'));
    mockBcryptCompare.mockImplementation(() => Promise.resolve(true));
    mockTokenService.generateAccessToken.mockReturnValue('mock-access-token');
    mockTokenService.generateRefreshToken.mockReturnValue('mock-refresh-token');
    mockTokenService.generateEmailVerificationToken.mockReturnValue('mock-verification-token');
    mockTokenService.generatePasswordResetToken.mockReturnValue('mock-reset-token');
    mockTokenService.generateOtpCode.mockReturnValue('123456');
    mockTokenService.generateVerificationSessionToken.mockReturnValue('mock-session-token');
    mockTokenService.hashToken.mockImplementation((raw: string) => `hashed-${raw}`);
    mockEmailService.sendVerificationEmail.mockResolvedValue(undefined);
    mockEmailService.sendPasswordResetEmail.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // register
  // -----------------------------------------------------------------------
  describe('register', () => {
    const DATA = { email: 'new@example.com', password: 'pass123', username: 'newuser' };

    it('returns user and verificationSessionToken on success', async () => {
      const user = makeUser({ email: DATA.email, username: DATA.username });
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(user);

      const result = await service.register(DATA);

      expect(result.user).toBe(user);
      expect(result.verificationSessionToken).toBe('mock-session-token');
    });

    it('hashes the password before storing', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser());

      await service.register(DATA);

      expect(mockBcryptHash).toHaveBeenCalledWith(DATA.password, 12);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'hashed-password' }),
      );
    });

    it('sends a verification email', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser());

      await service.register(DATA);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith(
        DATA.email,
        '123456',
      );
    });

    it('returns a verificationSessionToken', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser({ email: DATA.email }));

      const result = await service.register(DATA);

      expect(result.verificationSessionToken).toBe('mock-session-token');
      expect(mockTokenService.generateVerificationSessionToken).toHaveBeenCalledWith({
        userId: 'user-123',
        email: DATA.email,
      });
    });

    it('sends the verification email with the OTP code', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser({ email: DATA.email }));

      await service.register(DATA);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith(
        DATA.email,
        '123456',
      );
    });

    it('stores the OTP code', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser({ email: DATA.email }));

      await service.register(DATA);

      expect(mockRepo.createEmailVerification).toHaveBeenCalledWith(
        expect.objectContaining({ otpCode: '123456' }),
      );
    });

    it('throws when the username is already taken', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(makeUser());

      await expect(service.register(DATA)).rejects.toThrow('Username already taken');
    });

    it('skips the username uniqueness check when username is empty', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser());

      await service.register({ ...DATA, username: '' });

      expect(mockRepo.findByUsername).not.toHaveBeenCalled();
    });

    it('creates the user with emailVerified: false and REGISTERED type', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser());

      await service.register(DATA);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerified: false,
          userType: UserType.REGISTERED,
        }),
      );
    });

    it('does not issue tokens for a brand-new registration', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(makeUser({ emailVerified: false }));

      const result = await service.register({ email: 'a@b.co', password: 'password123', username: 'newuser' });

      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect(mockRepo.createRefreshToken).not.toHaveBeenCalled();
      expect(result.verificationSessionToken).toBe('mock-session-token');
      expect(result.otpExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('continues the signup when the email belongs to an unverified account', async () => {
      const pending = makeUser({ id: 'user-pending', emailVerified: false });
      mockRepo.findByEmail.mockResolvedValue(pending);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.findById.mockResolvedValue(pending);
      mockBcryptHash.mockResolvedValue('new-hash' as never);

      const result = await service.register({ email: 'a@b.co', password: 'brandnew123', username: 'renamed' });

      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.updatePassword).toHaveBeenCalledWith('user-pending', 'new-hash');
      expect(mockRepo.updateUsername).toHaveBeenCalledWith('user-pending', 'renamed');
      expect(mockRepo.deleteEmailVerificationsByUserId).toHaveBeenCalledWith('user-pending');
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith('a@b.co', '123456');
      expect(result.verificationSessionToken).toBe('mock-session-token');
    });

    it('reuses the live pending code instead of emailing a new one when signup is repeated inside the cooldown', async () => {
      // registerLimiter is per-IP (5/hour), so without this the only cost of email-bombing an
      // arbitrary address is rotating IPs — and each hit also overwrites the victim's in-flight
      // signup credentials.
      const pending = makeUser({ id: 'user-pending', emailVerified: false });
      mockRepo.findByEmail.mockResolvedValue(pending);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.findById.mockResolvedValue(pending);
      // First attempt finds nothing pending and mints; the second finds the row it just wrote,
      // created "now" and therefore still inside the 60s resend cooldown.
      mockRepo.findEmailVerificationByUserId
        .mockResolvedValueOnce(null)
        .mockResolvedValue(makeVerification());

      const data = { email: 'a@b.co', password: 'brandnew123', username: 'renamed' };
      const first = await service.register(data);
      const second = await service.register(data);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      // Anti-enumeration: the reused-code response must stay indistinguishable from a fresh one.
      expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
      expect(second.verificationSessionToken).toBe('mock-session-token');
      expect(second.otpExpiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(second.resendAvailableAt.getTime()).toBeGreaterThan(Date.now());
      // Continue-signup still overwrites the unproven credentials on the repeat attempt.
      expect(mockRepo.updatePassword).toHaveBeenCalledTimes(2);
      expect(mockRepo.updateUsername).toHaveBeenCalledTimes(2);
    });

    it('mints a new code on a repeat signup once the cooldown has elapsed', async () => {
      const pending = makeUser({ id: 'user-pending', emailVerified: false });
      mockRepo.findByEmail.mockResolvedValue(pending);
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.findById.mockResolvedValue(pending);
      const stale = new EmailVerificationModel(
        'verif-id', 'user-pending', 'token-abc', 'hashed-000000',
        new Date(Date.now() + 600_000), 0, new Date(Date.now() + 600_000),
        new Date(Date.now() - 120_000), // createdAt: 2 minutes ago — cooldown long gone
      );
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(stale);

      await service.register({ email: 'a@b.co', password: 'brandnew123', username: 'renamed' });

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith('a@b.co', '123456');
    });

    it('still rejects an email that belongs to a verified account', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser({ emailVerified: true }));

      await expect(
        service.register({ email: 'a@b.co', password: 'password123', username: 'someone' }),
      ).rejects.toThrow('Email already registered');
    });
  });

  // -----------------------------------------------------------------------
  // login
  // -----------------------------------------------------------------------
  describe('login', () => {
    const DATA = { email: 'test@example.com', password: 'correct-pass' };

    it('returns user, accessToken, and refreshToken on valid credentials (verified user)', async () => {
      const user = makeUser({ emailVerified: true });
      mockRepo.findByEmail.mockResolvedValue(user);

      const result = await service.login(DATA);

      expect(result.user).toBe(user);
      if ('accessToken' in result) {
        expect(result.accessToken).toBe('mock-access-token');
        expect(result.refreshToken).toBe('mock-refresh-token');
      }
    });

    it('saves the refresh token', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser({ emailVerified: true }));

      await service.login(DATA);

      expect(mockRepo.createRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'mock-refresh-token' }),
      );
    });

    it('stores the refresh token with a DB expiry derived from config, not a hardcoded 7 days', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser({ emailVerified: true }));

      const before = Date.now();
      await service.login(DATA);

      const [call] = mockRepo.createRefreshToken.mock.calls[0] as [{ expiresAt: Date }];
      const ttlMs = call.expiresAt.getTime() - before;
      const DAY = 24 * 60 * 60 * 1000;
      // config mock is '30d': well beyond the old 7-day hardcode, close to 30 days.
      expect(ttlMs).toBeGreaterThan(29 * DAY);
      expect(ttlMs).toBeLessThanOrEqual(30 * DAY + 1000);
    });

    it('throws on an unknown email', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);

      await expect(service.login(DATA)).rejects.toThrow('Invalid email or password');
    });

    it('throws when the user has no passwordHash (OAuth-only account)', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser({ passwordHash: null }));

      await expect(service.login(DATA)).rejects.toThrow('Invalid email or password');
    });

    it('throws on wrong password', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser());
      mockBcryptCompare.mockImplementation(() => Promise.resolve(false));

      await expect(service.login(DATA)).rejects.toThrow('Invalid email or password');
    });

    it('reuses the pending code instead of emailing a new one when login is retried inside the cooldown', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser({ emailVerified: false }));
      mockBcryptCompare.mockResolvedValue(true as never);
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(makeVerification()); // createdAt = now

      const result = await service.login(DATA);

      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
      expect('verificationRequired' in result).toBe(true);
    });

    it('emails a new code on login when the pending one is older than the cooldown', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser({ emailVerified: false }));
      mockBcryptCompare.mockResolvedValue(true as never);
      const stale = new EmailVerificationModel(
        'verif-id', 'user-123', 'token-abc', 'hashed-000000',
        new Date(Date.now() + 600_000), 0, new Date(Date.now() + 600_000),
        new Date(Date.now() - 120_000), // createdAt: 2 minutes ago
      );
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(stale);

      await service.login(DATA);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith('test@example.com', '123456');
    });

    it('emails a new code on login when the pending OTP itself has expired, even though its resend cooldown has not elapsed', async () => {
      mockRepo.findByEmail.mockResolvedValue(makeUser({ emailVerified: false }));
      mockBcryptCompare.mockResolvedValue(true as never);
      // createdAt: now, so the 60s resend cooldown is still active — if isOtpExpired()
      // weren't checked first, the cooldown math alone would say "reuse this code".
      const otpExpired = new EmailVerificationModel(
        'verif-id', 'user-123', 'token-abc', 'hashed-000000',
        new Date(Date.now() - 1000), // otpExpiresAt: already in the past
        0, new Date(Date.now() + 600_000),
        new Date(), // createdAt: now
      );
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(otpExpired);

      await service.login(DATA);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith('test@example.com', '123456');
    });
  });

  // -----------------------------------------------------------------------
  // verifyEmailByCode
  // -----------------------------------------------------------------------
  describe('verifyEmailByCode', () => {
    beforeEach(() => {
      mockTokenService.verifyVerificationSessionToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
        userType: 'REGISTERED',
      });
    });

    it('verifies on a matching code and deletes the verification record', async () => {
      const verification = makeVerification({ otpCodeHash: 'hashed-123456' });
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(verification);
      mockRepo.findById.mockResolvedValue(makeUser());

      const result = await service.verifyEmailByCode('session-token', '123456');

      expect(mockRepo.updateEmailVerified).toHaveBeenCalledWith('user-123', true);
      expect(mockRepo.deleteEmailVerification).toHaveBeenCalledWith(verification.id);
      expect(result.user.id).toBe('user-123');
    });

    it('returns a user object reflecting emailVerified: true, not the stale pre-update value', async () => {
      const verification = makeVerification({ otpCodeHash: 'hashed-123456' });
      const staleUser = makeUser({ emailVerified: false });
      const freshUser = makeUser({ emailVerified: true });
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(verification);
      mockRepo.findById.mockResolvedValueOnce(staleUser).mockResolvedValueOnce(freshUser);

      const result = await service.verifyEmailByCode('session-token', '123456');

      expect(result.user.emailVerified).toBe(true);
      expect(mockRepo.findById).toHaveBeenCalledTimes(2);
    });

    it('throws on an unknown/tampered verification session token', async () => {
      mockTokenService.verifyVerificationSessionToken.mockImplementation(() => {
        throw new Error('Invalid or expired verification session token');
      });

      await expect(service.verifyEmailByCode('bad-token', '123456')).rejects.toThrow(
        'Invalid or expired verification session token',
      );
    });

    it('throws when no pending verification exists', async () => {
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(null);

      await expect(service.verifyEmailByCode('session-token', '123456')).rejects.toThrow(
        'No pending verification found',
      );
    });

    it('throws when the OTP has expired', async () => {
      const verification = makeVerification({ otpExpiresAt: new Date(Date.now() - 1000) });
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(verification);

      await expect(service.verifyEmailByCode('session-token', '123456')).rejects.toThrow(
        'Verification code has expired',
      );
    });

    it('increments attempts on a wrong code and does not verify', async () => {
      const verification = makeVerification({ otpCodeHash: 'hashed-999999', attempts: 0 });
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(verification);
      mockRepo.incrementEmailVerificationAttempts.mockResolvedValue(
        makeVerification({ otpCodeHash: 'hashed-999999', attempts: 1 }),
      );

      await expect(service.verifyEmailByCode('session-token', '123456')).rejects.toThrow(
        'Incorrect verification code',
      );
      expect(mockRepo.incrementEmailVerificationAttempts).toHaveBeenCalledWith(verification.id);
      expect(mockRepo.updateEmailVerified).not.toHaveBeenCalled();
    });

    it('deletes the row and reports lockout on the 5th wrong attempt', async () => {
      const verification = makeVerification({ otpCodeHash: 'hashed-999999', attempts: 4 });
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(verification);
      mockRepo.incrementEmailVerificationAttempts.mockResolvedValue(
        makeVerification({ otpCodeHash: 'hashed-999999', attempts: 5 }),
      );

      await expect(service.verifyEmailByCode('session-token', '123456')).rejects.toThrow(
        'Too many incorrect attempts. Please request a new code.',
      );
      expect(mockRepo.deleteEmailVerification).toHaveBeenCalledWith(verification.id);
    });

    it('revokes any pre-existing refresh tokens before issuing the new session', async () => {
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(makeVerification({ otpCodeHash: 'hashed-123456' }));
      mockRepo.findById.mockResolvedValue(makeUser({ emailVerified: true }));

      await service.verifyEmailByCode('session-token', '123456');

      expect(mockRepo.revokeAllUserRefreshTokens).toHaveBeenCalledWith('user-123');
      const revokeOrder = mockRepo.revokeAllUserRefreshTokens.mock.invocationCallOrder[0]!;
      const createOrder = mockRepo.createRefreshToken.mock.invocationCallOrder[0]!;
      expect(revokeOrder).toBeLessThan(createOrder);
    });
  });

  // -----------------------------------------------------------------------
  // resendVerificationCode
  // -----------------------------------------------------------------------
  describe('resendVerificationCode', () => {
    beforeEach(() => {
      mockTokenService.verifyVerificationSessionToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
        userType: 'REGISTERED',
      });
    });

    it('deletes old verification rows and sends a new code', async () => {
      mockRepo.findById.mockResolvedValue(makeUser({ emailVerified: false }));

      const result = await service.resendVerificationCode('session-token');

      expect(mockRepo.deleteEmailVerificationsByUserId).toHaveBeenCalledWith('user-123');
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalled();
      expect(result.verificationSessionToken).toBe('mock-session-token');
    });

    it('throws when the email is already verified', async () => {
      mockRepo.findById.mockResolvedValue(makeUser({ emailVerified: true }));

      await expect(service.resendVerificationCode('session-token')).rejects.toThrow(
        'Email already verified',
      );
    });

    it('rejects a resend inside the cooldown window', async () => {
      mockRepo.findById.mockResolvedValue(makeUser({ emailVerified: false }));
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(makeVerification()); // createdAt = now

      await expect(service.resendVerificationCode('session-token')).rejects.toThrow(OtpCooldownError);
      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // requestPasswordReset
  // -----------------------------------------------------------------------
  describe('requestPasswordReset', () => {
    it('generates a reset token and sends a reset email', async () => {
      const user = makeUser();
      mockRepo.findByEmail.mockResolvedValue(user);

      await service.requestPasswordReset(user.email!);

      expect(mockRepo.deletePasswordResetsByUserId).toHaveBeenCalledWith(user.id);
      expect(mockRepo.createPasswordReset).toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        user.email,
        'mock-reset-token',
        '123456',
      );
    });

    it('returns silently for an unknown email (does not leak existence)', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);

      await expect(service.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('sends the reset email with the OTP code', async () => {
      const user = makeUser();
      mockRepo.findByEmail.mockResolvedValue(user);

      await service.requestPasswordReset(user.email!);

      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        user.email,
        'mock-reset-token',
        '123456',
      );
    });
  });

  // -----------------------------------------------------------------------
  // resetPassword
  // -----------------------------------------------------------------------
  describe('resetPassword', () => {
    it('hashes the new password and marks the token as used', async () => {
      const reset = makeReset({ isValid: true });
      mockRepo.findPasswordResetByToken.mockResolvedValue(reset);
      mockRepo.findById.mockResolvedValue(makeUser());

      await service.resetPassword('reset-abc', 'newpassword');

      expect(mockBcryptHash).toHaveBeenCalledWith('newpassword', 12);
      expect(mockRepo.updatePassword).toHaveBeenCalledWith('user-123', 'hashed-password');
      expect(mockRepo.markPasswordResetAsUsed).toHaveBeenCalledWith(reset.id);
      expect(mockRepo.deletePasswordResetsByUserId).toHaveBeenCalledWith('user-123');
    });

    it('throws on an invalid token', async () => {
      mockRepo.findPasswordResetByToken.mockResolvedValue(null);

      await expect(service.resetPassword('bad', 'new')).rejects.toThrow('Invalid reset token');
    });

    it('throws on an expired or already-used token', async () => {
      mockRepo.findPasswordResetByToken.mockResolvedValue(makeReset({ isValid: false }));

      await expect(service.resetPassword('reset-abc', 'new')).rejects.toThrow(
        'Reset token has expired or already used',
      );
    });
  });

  // -----------------------------------------------------------------------
  // resetPasswordByCode
  // -----------------------------------------------------------------------
  describe('resetPasswordByCode', () => {
    it('resets the password on a matching code', async () => {
      const user = makeUser();
      const reset = makeReset({ otpCodeHash: 'hashed-123456' });
      mockRepo.findByEmail.mockResolvedValue(user);
      mockRepo.findPasswordResetByUserId.mockResolvedValue(reset);

      await service.resetPasswordByCode(user.email!, '123456', 'newpassword');

      expect(mockRepo.updatePassword).toHaveBeenCalledWith(user.id, 'hashed-password');
      expect(mockRepo.deletePasswordResetsByUserId).toHaveBeenCalledWith(user.id);
    });

    it('throws a generic error for an unknown email (no enumeration)', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);

      await expect(service.resetPasswordByCode('nobody@example.com', '123456', 'newpassword')).rejects.toThrow(
        'Invalid code or email',
      );
    });

    it('throws when the OTP has expired', async () => {
      const user = makeUser();
      mockRepo.findByEmail.mockResolvedValue(user);
      mockRepo.findPasswordResetByUserId.mockResolvedValue(
        makeReset({ otpExpiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.resetPasswordByCode(user.email!, '123456', 'newpassword')).rejects.toThrow(
        'Reset code has expired',
      );
    });

    it('increments attempts on a wrong code', async () => {
      const user = makeUser();
      const reset = makeReset({ otpCodeHash: 'hashed-999999', attempts: 0 });
      mockRepo.findByEmail.mockResolvedValue(user);
      mockRepo.findPasswordResetByUserId.mockResolvedValue(reset);
      mockRepo.incrementPasswordResetAttempts.mockResolvedValue(
        makeReset({ otpCodeHash: 'hashed-999999', attempts: 1 }),
      );

      await expect(service.resetPasswordByCode(user.email!, '123456', 'newpassword')).rejects.toThrow(
        'Incorrect reset code',
      );
      expect(mockRepo.updatePassword).not.toHaveBeenCalled();
    });

    it('deletes the row and reports lockout on the 5th wrong attempt', async () => {
      const user = makeUser();
      const reset = makeReset({ otpCodeHash: 'hashed-999999', attempts: 4 });
      mockRepo.findByEmail.mockResolvedValue(user);
      mockRepo.findPasswordResetByUserId.mockResolvedValue(reset);
      mockRepo.incrementPasswordResetAttempts.mockResolvedValue(
        makeReset({ otpCodeHash: 'hashed-999999', attempts: 5 }),
      );

      await expect(service.resetPasswordByCode(user.email!, '123456', 'newpassword')).rejects.toThrow(
        'Too many incorrect attempts. Please request a new code.',
      );
      expect(mockRepo.deletePasswordResetsByUserId).toHaveBeenCalledWith(user.id);
    });
  });

  // -----------------------------------------------------------------------
  // changePassword
  // -----------------------------------------------------------------------
  describe('changePassword', () => {
    it('verifies current password for regular users before updating', async () => {
      mockRepo.findById.mockResolvedValue(makeUser());

      await service.changePassword('user-123', 'current-pass', 'new-pass');

      expect(mockBcryptCompare).toHaveBeenCalledWith('current-pass', '$2b$10$hashedpassword');
      expect(mockRepo.updatePassword).toHaveBeenCalledWith('user-123', 'hashed-password');
    });

    it('throws when current password is not provided for a regular user', async () => {
      mockRepo.findById.mockResolvedValue(makeUser());

      await expect(service.changePassword('user-123', null, 'new-pass')).rejects.toThrow(
        'Current password is required',
      );
    });

    it('throws when current password is incorrect', async () => {
      mockRepo.findById.mockResolvedValue(makeUser());
      mockBcryptCompare.mockImplementation(() => Promise.resolve(false));

      await expect(service.changePassword('user-123', 'wrong', 'new-pass')).rejects.toThrow(
        'Current password is incorrect',
      );
    });

    it('allows OAuth-only users to set a password without verification', async () => {
      mockRepo.findById.mockResolvedValue(makeUser({ passwordHash: null }));

      await service.changePassword('user-123', null, 'new-pass');

      expect(mockBcryptCompare).not.toHaveBeenCalled();
      expect(mockRepo.updatePassword).toHaveBeenCalledWith('user-123', 'hashed-password');
    });

    it('throws when user is not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.changePassword('ghost', 'x', 'y')).rejects.toThrow('User not found');
    });
  });

  // -----------------------------------------------------------------------
  // findOrCreateOAuthUser
  // -----------------------------------------------------------------------
  describe('findOrCreateOAuthUser', () => {
    const PROVIDER = 'google';
    const PROVIDER_ID = 'google-uid-999';
    const EMAIL = 'oauth@example.com';
    const NAME = 'OAuth User';

    it('returns tokens for an existing, already-verified OAuth account without touching it', async () => {
      const user = makeUser({ email: EMAIL, emailVerified: true });
      mockRepo.findOAuthAccount.mockResolvedValue({ userId: user.id });
      mockRepo.findById.mockResolvedValue(user);

      const result = await service.findOrCreateOAuthUser(PROVIDER, PROVIDER_ID, EMAIL, NAME);

      expect(result.user).toBe(user);
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      // A repeat sign-in on a healthy linked account is a pure pass-through: re-blessing it would
      // revoke its refresh tokens (signing the user out of every other device) on every sign-in.
      expect(mockRepo.updateEmailVerified).not.toHaveBeenCalled();
      expect(mockRepo.updatePassword).not.toHaveBeenCalled();
      expect(mockRepo.revokeAllUserRefreshTokens).not.toHaveBeenCalled();
    });

    it('verifies and de-passwords an already-linked but still-unverified account before issuing tokens', async () => {
      // Without this, the linked-but-unverified account gets a token pair the OTP hard gate then
      // rejects on every subsequent request — a permanent, self-inflicted login loop.
      const unverified = makeUser({ id: 'user-12', email: EMAIL, emailVerified: false, passwordHash: '$2b$10$attackerhash' });
      const blessed = makeUser({ id: 'user-12', email: EMAIL, emailVerified: true, passwordHash: null });
      mockRepo.findOAuthAccount.mockResolvedValue({ userId: unverified.id });
      mockRepo.findById.mockResolvedValueOnce(unverified).mockResolvedValue(blessed);

      const result = await service.findOrCreateOAuthUser(PROVIDER, PROVIDER_ID, EMAIL, NAME);

      expect(mockRepo.updateEmailVerified).toHaveBeenCalledWith('user-12', true);
      // Same pre-hijack reasoning as the link-on-the-fly branch: a password set without ever
      // proving mailbox control must not survive the provider's blessing.
      expect(mockRepo.updatePassword).toHaveBeenCalledWith('user-12', null);
      expect(mockRepo.revokeAllUserRefreshTokens).toHaveBeenCalledWith('user-12');
      // ...and all of that lands before the new session is minted.
      const revokeOrder = mockRepo.revokeAllUserRefreshTokens.mock.invocationCallOrder[0]!;
      const createOrder = mockRepo.createRefreshToken.mock.invocationCallOrder[0]!;
      expect(revokeOrder).toBeLessThan(createOrder);
      expect(result.user.emailVerified).toBe(true);
      expect(result.accessToken).toBe('mock-access-token');
    });

    it('does not re-link (createOAuthAccount) when blessing an already-linked unverified account', async () => {
      const unverified = makeUser({ id: 'user-13', email: EMAIL, emailVerified: false });
      mockRepo.findOAuthAccount.mockResolvedValue({ userId: unverified.id });
      mockRepo.findById
        .mockResolvedValueOnce(unverified)
        .mockResolvedValue(makeUser({ id: 'user-13', email: EMAIL, emailVerified: true, passwordHash: null }));

      await service.findOrCreateOAuthUser(PROVIDER, PROVIDER_ID, EMAIL, NAME);

      expect(mockRepo.createOAuthAccount).not.toHaveBeenCalled();
      expect(mockRepo.findByEmail).not.toHaveBeenCalled();
    });

    it('links OAuth to an existing email user', async () => {
      const user = makeUser({ email: EMAIL });
      const linked = makeUser({ email: EMAIL, emailVerified: true, passwordHash: null });
      mockRepo.findOAuthAccount.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(user);
      mockRepo.findById.mockResolvedValue(linked);

      const result = await service.findOrCreateOAuthUser(PROVIDER, PROVIDER_ID, EMAIL, NAME);

      expect(mockRepo.createOAuthAccount).toHaveBeenCalledWith(
        expect.objectContaining({ provider: PROVIDER, providerId: PROVIDER_ID }),
      );
      expect(result.user).toBe(linked);
    });

    it('verifies and de-passwords an existing email account when linking Google to it', async () => {
      const unverified = makeUser({ id: 'user-9', emailVerified: false, passwordHash: '$2b$10$attackerhash' });
      mockRepo.findOAuthAccount.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(unverified);
      mockRepo.findById.mockResolvedValue(makeUser({ id: 'user-9', emailVerified: true, passwordHash: null }));

      const result = await service.findOrCreateOAuthUser('google', 'g-1', 'test@example.com', 'Test');

      expect(mockRepo.createOAuthAccount).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-9', provider: 'google', providerId: 'g-1' }),
      );
      expect(mockRepo.updateEmailVerified).toHaveBeenCalledWith('user-9', true);
      // A password set by someone who never proved they own the address must not survive the link.
      expect(mockRepo.updatePassword).toHaveBeenCalledWith('user-9', null);
      expect(result.user.emailVerified).toBe(true);
    });

    it('does not null the password of an already-verified account that links Google', async () => {
      // Unlike the unverified case above: a password on an already-verified account was set by
      // someone who already proved mailbox control (OTP, reset link, or authenticated change) —
      // there is no pre-hijack scenario here, so an incidental Google sign-in must not destroy it.
      const alreadyVerified = makeUser({ id: 'user-10', emailVerified: true, passwordHash: '$2b$10$realuserhash' });
      mockRepo.findOAuthAccount.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(alreadyVerified);
      mockRepo.findById.mockResolvedValue(makeUser({ id: 'user-10', emailVerified: true, passwordHash: '$2b$10$realuserhash' }));

      await service.findOrCreateOAuthUser('google', 'g-2', 'verified@example.com', 'Verified User');

      expect(mockRepo.updateEmailVerified).toHaveBeenCalledWith('user-10', true);
      expect(mockRepo.updatePassword).not.toHaveBeenCalled();
    });

    it('revokes any pre-existing refresh tokens before issuing a new session on link', async () => {
      // A stale refresh-token row from the OLD pre-hard-gate flow must not spring back to life the
      // instant the account becomes verified here — mirrors verifyEmailByCode's same protection.
      const unverified = makeUser({ id: 'user-11', emailVerified: false, passwordHash: '$2b$10$attackerhash' });
      mockRepo.findOAuthAccount.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(unverified);
      mockRepo.findById.mockResolvedValue(makeUser({ id: 'user-11', emailVerified: true, passwordHash: null }));

      await service.findOrCreateOAuthUser('google', 'g-3', 'stale-token@example.com', 'Stale Token User');

      expect(mockRepo.revokeAllUserRefreshTokens).toHaveBeenCalledWith('user-11');
      const revokeOrder = mockRepo.revokeAllUserRefreshTokens.mock.invocationCallOrder[0]!;
      const createOrder = mockRepo.createRefreshToken.mock.invocationCallOrder[0]!;
      expect(revokeOrder).toBeLessThan(createOrder);
    });

    it('creates a new user with emailVerified: true for a new OAuth email', async () => {
      const newUser = makeUser({ email: EMAIL, emailVerified: true, passwordHash: null });
      mockRepo.findOAuthAccount.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(newUser);

      await service.findOrCreateOAuthUser(PROVIDER, PROVIDER_ID, EMAIL, NAME);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true, passwordHash: null }),
      );
    });

    it('stores the profilePictureUrl from the OAuth provider', async () => {
      const newUser = makeUser({ email: EMAIL });
      mockRepo.findOAuthAccount.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(newUser);

      await service.findOrCreateOAuthUser(PROVIDER, PROVIDER_ID, EMAIL, NAME, 'https://pic.url/photo.jpg');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ profilePictureUrl: 'https://pic.url/photo.jpg' }),
      );
    });

    it('saves a refresh token in all paths', async () => {
      const user = makeUser({ email: EMAIL });
      mockRepo.findOAuthAccount.mockResolvedValue(null);
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(user);

      await service.findOrCreateOAuthUser(PROVIDER, PROVIDER_ID, EMAIL, NAME);

      expect(mockRepo.createRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'mock-refresh-token' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // refreshAccessToken
  // -----------------------------------------------------------------------
  describe('refreshAccessToken', () => {
    it('returns new access and refresh tokens for a valid token', async () => {
      const user = makeUser({ emailVerified: true });
      mockTokenService.verifyRefreshToken.mockReturnValue({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });
      mockRepo.findRefreshTokenByToken.mockResolvedValue({
        userId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      });
      mockRepo.findById.mockResolvedValue(user);

      const result = await service.refreshAccessToken('old-refresh-token');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(mockRepo.revokeRefreshToken).toHaveBeenCalledWith('old-refresh-token');
    });

    it('allows token reuse within the 30-second grace period', async () => {
      const user = makeUser({ emailVerified: true });
      mockTokenService.verifyRefreshToken.mockReturnValue({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });
      mockRepo.findRefreshTokenByToken.mockResolvedValue({
        userId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(Date.now() - 10_000), // revoked 10s ago — within grace period
      });
      mockRepo.findById.mockResolvedValue(user);

      const result = await service.refreshAccessToken('old-refresh-token');

      expect(result.accessToken).toBe('mock-access-token');
      expect(mockRepo.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it('throws when the token is revoked beyond the grace period', async () => {
      mockTokenService.verifyRefreshToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
        userType: UserType.REGISTERED,
      });
      mockRepo.findRefreshTokenByToken.mockResolvedValue({
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(Date.now() - 60_000), // revoked 60s ago — outside grace period
      });

      await expect(service.refreshAccessToken('revoked-token')).rejects.toThrow(
        'Refresh token has been revoked',
      );
    });

    it('throws on an invalid or expired JWT', async () => {
      mockTokenService.verifyRefreshToken.mockImplementation(() => {
        throw new Error('Invalid or expired refresh token');
      });

      await expect(service.refreshAccessToken('garbage')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });

    it('throws when the token record is not found in the database', async () => {
      mockTokenService.verifyRefreshToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
        userType: UserType.REGISTERED,
      });
      mockRepo.findRefreshTokenByToken.mockResolvedValue(null);

      await expect(service.refreshAccessToken('missing-token')).rejects.toThrow(
        'Refresh token not found',
      );
    });

    it('refuses to refresh a session belonging to an unverified account', async () => {
      mockTokenService.verifyRefreshToken.mockReturnValue({ userId: 'user-123', email: 'a@b.co', userType: UserType.REGISTERED });
      mockRepo.findRefreshTokenByToken.mockResolvedValue({
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      });
      mockRepo.findById.mockResolvedValue(makeUser({ emailVerified: false }));

      await expect(service.refreshAccessToken('some-refresh-token')).rejects.toThrow('Email verification required');
      expect(mockRepo.createRefreshToken).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // DEV-338: security-triggered revocation (revokeAllUserRefreshTokens) must close the
  // replay window immediately, while ordinary single-token rotation (revokeRefreshToken)
  // must keep granting its legitimate 30s grace period. These compose a real
  // security-triggered call path (verifyEmailByCode) with refreshAccessToken to prove the
  // two revocation paths are correctly differentiated end-to-end — not just that
  // UserRepository issues `deleteMany` instead of `updateMany` (that Prisma-level check
  // lives in UserRepository.revokeAllUserRefreshTokens.test.ts).
  // -----------------------------------------------------------------------
  describe('revocation path differentiation (grace period vs immediate rejection)', () => {
    it('rejects a refresh token immediately with no grace period after a security-triggered revocation', async () => {
      // Step 1: drive the security-triggered revocation path through a real service method
      // (verifyEmailByCode), exactly as the OTP hard gate does in production.
      mockTokenService.verifyVerificationSessionToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
        userType: 'REGISTERED',
      });
      mockRepo.findEmailVerificationByUserId.mockResolvedValue(makeVerification({ otpCodeHash: 'hashed-123456' }));
      mockRepo.findById.mockResolvedValue(makeUser({ emailVerified: true }));

      await service.verifyEmailByCode('session-token', '123456');

      expect(mockRepo.revokeAllUserRefreshTokens).toHaveBeenCalledWith('user-123');
      const createRefreshTokenCallsBeforeRefresh = mockRepo.createRefreshToken.mock.calls.length;

      // Step 2: a token that predates verification is presented to refreshAccessToken.
      // revokeAllUserRefreshTokens hard-deletes (see the repository test), so the row is
      // gone entirely — findRefreshTokenByToken returns null, not a soft-revoked record.
      mockTokenService.verifyRefreshToken.mockReturnValue({
        userId: 'user-123',
        email: 'test@example.com',
        userType: UserType.REGISTERED,
      });
      mockRepo.findRefreshTokenByToken.mockResolvedValue(null);

      await expect(service.refreshAccessToken('pre-verification-refresh-token')).rejects.toThrow(
        'Refresh token not found',
      );
      // The grace-period branch (which lives past the null check) was never reachable —
      // no new pair was minted.
      expect(mockRepo.createRefreshToken.mock.calls.length).toBe(createRefreshTokenCallsBeforeRefresh);
    });

    it('still grants the 30s grace period after ordinary single-token rotation', async () => {
      const user = makeUser({ emailVerified: true });
      mockTokenService.verifyRefreshToken.mockReturnValue({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });
      mockRepo.findById.mockResolvedValue(user);

      // The single-token rotation path (refreshAccessToken's own call to revokeRefreshToken)
      // soft-revokes: the row survives with revokedAt set, which is what makes the grace
      // period possible in the first place — contrast with the hard-delete/null case above.
      mockRepo.findRefreshTokenByToken.mockResolvedValue({
        userId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(Date.now() - 10_000), // revoked 10s ago by a prior rotation
      });

      const result = await service.refreshAccessToken('rotated-refresh-token');

      expect(result.accessToken).toBe('mock-access-token');
      // Reused within the grace window — must not attempt to revoke it again.
      expect(mockRepo.revokeRefreshToken).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // updateUsername
  // -----------------------------------------------------------------------
  describe('updateUsername', () => {
    it('trims, validates, and updates the username', async () => {
      const user = makeUser({ username: 'newname' });
      mockRepo.findByUsername.mockResolvedValue(null);
      mockRepo.findById.mockResolvedValue(user);

      const result = await service.updateUsername('user-123', '  newname  ');

      expect(mockRepo.updateUsername).toHaveBeenCalledWith('user-123', 'newname');
      expect(result).toBe(user);
    });

    it('throws when the username is empty after trimming', async () => {
      await expect(service.updateUsername('user-123', '   ')).rejects.toThrow(
        'Username cannot be empty',
      );
    });

    it('throws when the username is shorter than 3 characters', async () => {
      await expect(service.updateUsername('user-123', 'ab')).rejects.toThrow(
        'Username must be between 3 and 30 characters',
      );
    });

    it('throws when the username is longer than 30 characters', async () => {
      await expect(service.updateUsername('user-123', 'a'.repeat(31))).rejects.toThrow(
        'Username must be between 3 and 30 characters',
      );
    });

    it('throws when the username contains invalid characters', async () => {
      await expect(service.updateUsername('user-123', 'bad name!')).rejects.toThrow(
        'Username can only contain',
      );
    });

    it('throws when the username is already taken by another user', async () => {
      mockRepo.findByUsername.mockResolvedValue(makeUser({ id: 'other-user' }));

      await expect(service.updateUsername('user-123', 'takenname')).rejects.toThrow(
        'Username already taken',
      );
    });

    it('allows a user to keep their own existing username', async () => {
      const user = makeUser({ id: 'user-123', username: 'sameuser' });
      mockRepo.findByUsername.mockResolvedValue(user);
      mockRepo.findById.mockResolvedValue(user);

      await expect(service.updateUsername('user-123', 'sameuser')).resolves.toBeDefined();
    });
  });
});

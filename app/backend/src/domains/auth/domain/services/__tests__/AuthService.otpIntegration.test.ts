/**
 * AuthService OTP integration test (DEV-207)
 *
 * Every test in `AuthService.test.ts` mocks `TokenService` entirely, so none of those tests
 * prove the actual hash-generate -> hash-compare round trip works with real crypto. This file
 * closes that gap: it uses the REAL (unmocked) `TokenService` alongside a small hand-written
 * in-memory fake repository (not full Prisma/DB — keeps this a fast test, no database required).
 *
 * Only `@/config/environment` (to supply a deterministic JWT secret/expiry config) and
 * `EmailService` (to capture the emailed code without sending real email) are mocked.
 */

jest.mock('@/config/environment', () => ({
  config: {
    nodeEnv: 'test',
    logging: { level: 'error' },
    jwt: {
      secret: 'test-secret-for-otp-integration-32chars',
      accessTokenExpiresIn: '1h',
      refreshTokenExpiresIn: '30d',
      emailVerificationExpiresHours: 24,
      passwordResetExpiresHours: 1,
    },
  },
}));

const sentEmails: { to: string; token: string; code: string }[] = [];

jest.mock('../../../infrastructure/services/EmailService', () => ({
  emailService: {
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
  },
}));

import { AuthService } from '../AuthService';
import { tokenService } from '../TokenService';
import { emailService } from '../../../infrastructure/services/EmailService';
import { AuthUserModel } from '../../models/User';
import { EmailVerificationModel } from '../../models/EmailVerification';
import { PasswordResetModel } from '../../models/PasswordReset';
import type {
  UserRepository,
  CreateUserData,
  CreateEmailVerificationData,
  CreatePasswordResetData,
  CreateOAuthAccountData,
  CreateRefreshTokenData,
} from '../../../infrastructure/repositories/UserRepository';

const mockEmailService = jest.mocked(emailService);

// -------------------------------------------------------------------------
// Minimal in-memory fake repository — implements the full `UserRepository`
// public surface (structurally, since UserRepository has no private members)
// so `AuthService`'s constructor accepts it with zero casts. Only the methods
// exercised by register/verifyEmailByCode/requestPasswordReset/resetPasswordByCode
// are functionally implemented; the rest throw, since this is a test-only fake,
// not a full repository re-implementation.
// -------------------------------------------------------------------------
class FakeUserRepository implements UserRepository {
  private readonly users = new Map<string, AuthUserModel>();
  private readonly verifications = new Map<string, EmailVerificationModel>();
  private readonly resets = new Map<string, PasswordResetModel>();
  private idCounter = 0;

  async findByEmail(email: string): Promise<AuthUserModel | null> {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async findByUsername(username: string): Promise<AuthUserModel | null> {
    return [...this.users.values()].find((u) => u.username === username) ?? null;
  }

  async findById(id: string): Promise<AuthUserModel | null> {
    return this.users.get(id) ?? null;
  }

  async create(data: CreateUserData): Promise<AuthUserModel> {
    const id = `user-${++this.idCounter}`;
    const user = new AuthUserModel(
      id,
      data.email,
      data.username,
      data.passwordHash,
      data.emailVerified,
      data.userType,
      data.profilePictureUrl ?? null,
      null,
      new Date(),
      new Date(),
    );
    this.users.set(id, user);
    return user;
  }

  async updateEmailVerified(userId: string, emailVerified: boolean): Promise<void> {
    const u = this.users.get(userId);
    if (u) {
      u.emailVerified = emailVerified;
    }
  }

  async updatePassword(): Promise<void> {
    // No-op: nothing in these tests reads passwordHash back after reset.
  }

  async updateUsername(userId: string, newUsername: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) {
      u.username = newUsername;
    }
  }

  async updateProfilePictureUrl(): Promise<AuthUserModel> {
    throw new Error('not implemented in fake test repository');
  }

  async createEmailVerification(data: CreateEmailVerificationData): Promise<EmailVerificationModel> {
    // TokenService is never jest.mock()'d in this file (that's the whole point of this test),
    // so the top-level `tokenService` import is the same real singleton AuthService itself uses -
    // hashing here round-trips against the exact same hash function AuthService compares with.
    const v = new EmailVerificationModel(
      `verif-${++this.idCounter}`,
      data.userId,
      tokenService.hashToken(data.token),
      tokenService.hashToken(data.otpCode),
      data.otpExpiresAt,
      0,
      data.expiresAt,
      new Date(),
    );
    this.verifications.set(data.userId, v);
    return v;
  }

  async findEmailVerificationByToken(): Promise<EmailVerificationModel | null> {
    throw new Error('not implemented in fake test repository');
  }

  async findEmailVerificationByUserId(userId: string): Promise<EmailVerificationModel | null> {
    return this.verifications.get(userId) ?? null;
  }

  async incrementEmailVerificationAttempts(id: string): Promise<EmailVerificationModel> {
    const existing = [...this.verifications.values()].find((v) => v.id === id);
    if (!existing) {
      throw new Error(`fake repository: no email verification with id ${id}`);
    }
    const updated = new EmailVerificationModel(
      existing.id,
      existing.userId,
      existing.token,
      existing.otpCodeHash,
      existing.otpExpiresAt,
      existing.attempts + 1,
      existing.expiresAt,
      existing.createdAt,
    );
    this.verifications.set(existing.userId, updated);
    return updated;
  }

  async deleteEmailVerification(id: string): Promise<void> {
    for (const [key, v] of this.verifications) {
      if (v.id === id) {
        this.verifications.delete(key);
      }
    }
  }

  async deleteEmailVerificationsByUserId(userId: string): Promise<void> {
    this.verifications.delete(userId);
  }

  async createPasswordReset(data: CreatePasswordResetData): Promise<PasswordResetModel> {
    const r = new PasswordResetModel(
      `reset-${++this.idCounter}`,
      data.userId,
      tokenService.hashToken(data.token),
      tokenService.hashToken(data.otpCode),
      data.otpExpiresAt,
      0,
      data.expiresAt,
      new Date(),
      null,
    );
    this.resets.set(data.userId, r);
    return r;
  }

  async findPasswordResetByToken(): Promise<PasswordResetModel | null> {
    throw new Error('not implemented in fake test repository');
  }

  async findPasswordResetByUserId(userId: string): Promise<PasswordResetModel | null> {
    return this.resets.get(userId) ?? null;
  }

  async incrementPasswordResetAttempts(id: string): Promise<PasswordResetModel> {
    const existing = [...this.resets.values()].find((r) => r.id === id);
    if (!existing) {
      throw new Error(`fake repository: no password reset with id ${id}`);
    }
    const updated = new PasswordResetModel(
      existing.id,
      existing.userId,
      existing.token,
      existing.otpCodeHash,
      existing.otpExpiresAt,
      existing.attempts + 1,
      existing.expiresAt,
      existing.createdAt,
      existing.usedAt,
    );
    this.resets.set(existing.userId, updated);
    return updated;
  }

  async markPasswordResetAsUsed(): Promise<void> {
    throw new Error('not implemented in fake test repository');
  }

  async deletePasswordResetsByUserId(userId: string): Promise<void> {
    this.resets.delete(userId);
  }

  async createOAuthAccount(_data: CreateOAuthAccountData): Promise<void> {
    throw new Error('not implemented in fake test repository');
  }

  async findOAuthAccount(): Promise<{ userId: string } | null> {
    throw new Error('not implemented in fake test repository');
  }

  async createRefreshToken(_data: CreateRefreshTokenData): Promise<void> {
    // No-op: register() no longer calls this (the OTP hard gate removed its auto-issued tokens),
    // but the verify path still does; nothing in these tests reads the stored refresh token back,
    // matching the existing updatePassword()/similar no-op style.
  }

  async findRefreshTokenByToken(): Promise<{ userId: string; expiresAt: Date; revokedAt: Date | null } | null> {
    throw new Error('not implemented in fake test repository');
  }

  async revokeRefreshToken(): Promise<void> {
    throw new Error('not implemented in fake test repository');
  }

  async revokeAllUserRefreshTokens(): Promise<void> {
    // No-op: verifyEmailByCode retires prior sessions, and this fake never stores refresh tokens.
  }

  async deleteExpiredRefreshTokens(): Promise<void> {
    throw new Error('not implemented in fake test repository');
  }
}

describe('AuthService OTP integration (real TokenService, fake repository)', () => {
  beforeEach(() => {
    // `resetMocks: true` in jest.config wipes any implementation set on module-mock factories
    // before every test, so the email-capturing behavior must be re-armed here rather than
    // relying on the jest.mock() factory's one-time setup above.
    mockEmailService.sendVerificationEmail.mockImplementation((to: string, code: string) => {
      sentEmails.push({ to, token: '', code });
      return Promise.resolve();
    });
    mockEmailService.sendPasswordResetEmail.mockImplementation((to: string, token: string, code: string) => {
      sentEmails.push({ to, token, code });
      return Promise.resolve();
    });
  });

  it('register -> verifyEmailByCode happy path round-trips through real hashing', async () => {
    const repo = new FakeUserRepository();
    const service = new AuthService(repo);

    const { user, verificationSessionToken } = await service.register({
      email: 'integration@example.com',
      password: 'password123',
      username: 'integrationuser',
    });

    const sentEmail = sentEmails.find((e) => e.to === 'integration@example.com');
    expect(sentEmail).toBeDefined();
    expect(sentEmail?.code).toMatch(/^\d{6}$/);

    const verifiedResult = await service.verifyEmailByCode(verificationSessionToken, sentEmail?.code ?? '');
    expect(verifiedResult.user.id).toBe(user.id);
    expect(verifiedResult.user.emailVerified).toBe(true);
  });

  it('register -> verifyEmailByCode fails with a wrong code', async () => {
    const repo = new FakeUserRepository();
    const service = new AuthService(repo);

    const { verificationSessionToken } = await service.register({
      email: 'wrongcode@example.com',
      password: 'password123',
      username: 'wrongcodeuser',
    });

    await expect(service.verifyEmailByCode(verificationSessionToken, '000000')).rejects.toThrow(
      /Incorrect verification code|Too many incorrect attempts/,
    );
  });

  it('requestPasswordReset -> resetPasswordByCode happy path round-trips through real hashing', async () => {
    const repo = new FakeUserRepository();
    const service = new AuthService(repo);

    await service.register({
      email: 'reset-integration@example.com',
      password: 'password123',
      username: 'resetintegrationuser',
    });
    sentEmails.length = 0;

    await service.requestPasswordReset('reset-integration@example.com');
    const sentEmail = sentEmails.find((e) => e.to === 'reset-integration@example.com');
    expect(sentEmail).toBeDefined();

    await expect(
      service.resetPasswordByCode('reset-integration@example.com', sentEmail?.code ?? '', 'newpassword456'),
    ).resolves.toBeUndefined();
    // FakeUserRepository.updatePassword is a no-op so there's nothing further to assert on the
    // stored hash; the resolved (non-throwing) call proves the OTP hash-compare succeeded.
  });
});

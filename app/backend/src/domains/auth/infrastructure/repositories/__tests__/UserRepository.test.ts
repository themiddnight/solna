/**
 * UserRepository hash-at-rest and hard-delete behavior (DEV-338 guard).
 *
 * These tests run the REAL UserRepository (and the REAL TokenService.hashToken)
 * against an in-memory stand-in for `@/config/prisma` that emulates the Prisma
 * semantics the repository relies on (create / findUnique / upsert / update /
 * deleteMany). No Postgres is required, mirroring the house repo-test pattern:
 * UserRepository.revokeAllUserRefreshTokens.test.ts mocks `@/config/prisma`.
 *
 * Load-bearing cases:
 *  - Bearer tokens and OTP codes are stored hashed (SHA-256 via
 *    TokenService.hashToken, DEV-188): the raw value never reaches the persistence
 *    layer; lookups hash again, so finding by the raw value round-trips while the
 *    stored value differs, and a wrong raw value cannot resolve.
 *  - revokeAllUserRefreshTokens HARD-deletes rows (DEV-338): after revocation,
 *    findRefreshTokenByToken returns null. A soft-revoke would leave a row for
 *    refreshAccessToken's 30s grace-period branch to find, letting a polling
 *    attacker ride out the window and mint a fresh session.
 *  - createRefreshToken upserts by token hash (React StrictMode duplicate-issue
 *    safety): re-issuing the same token for the same user keeps exactly one row
 *    and refreshes expiresAt / clears revokedAt.
 */

interface RefreshTokenRow {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

interface EmailVerificationRow {
  id: string;
  userId: string;
  token: string;
  otpCodeHash: string | null;
  otpExpiresAt: Date | null;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

interface PasswordResetRow {
  id: string;
  userId: string;
  token: string;
  otpCodeHash: string | null;
  otpExpiresAt: Date | null;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  userType: string;
  profilePictureUrl: string | null;
  onboardingTourPromptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface OAuthAccountRow {
  userId: string;
  provider: string;
  providerId: string;
}

const mockStore = {
  refreshTokens: [] as RefreshTokenRow[],
  emailVerifications: [] as EmailVerificationRow[],
  passwordResets: [] as PasswordResetRow[],
  users: [] as UserRow[],
  oAuthAccounts: [] as OAuthAccountRow[],
};

jest.mock('@/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id !== undefined) {
          return mockStore.users.find((row) => row.id === args.where.id) ?? null;
        }
        return mockStore.users.find((row) => row.email === args.where.email) ?? null;
      },
      findFirst: async (args: { where: { username: string } }) => {
        return mockStore.users.find((row) => row.username === args.where.username) ?? null;
      },
      create: async (args: {
        data: {
          email: string | null;
          username: string | null;
          passwordHash: string | null;
          emailVerified: boolean;
          userType: string;
          profilePictureUrl: string | null;
        };
      }) => {
        const row: UserRow = {
          id: `user-${mockStore.users.length + 1}`,
          email: args.data.email,
          username: args.data.username,
          passwordHash: args.data.passwordHash,
          emailVerified: args.data.emailVerified,
          userType: args.data.userType,
          profilePictureUrl: args.data.profilePictureUrl,
          onboardingTourPromptedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockStore.users.push(row);
        return row;
      },
      update: async (args: {
        where: { id: string };
        data:
          | { emailVerified: boolean }
          | { passwordHash: string | null }
          | { username: string }
          | { profilePictureUrl: string | null };
      }) => {
        const row = mockStore.users.find((r) => r.id === args.where.id);
        if (row) {
          Object.assign(row, args.data);
          row.updatedAt = new Date();
          return row;
        }
        return null;
      },
    },
    refreshToken: {
      upsert: async (args: {
        where: { token: string };
        create: { userId: string; token: string; expiresAt: Date };
        update: { expiresAt: Date; revokedAt: null };
      }) => {
        const existing = mockStore.refreshTokens.find((row) => row.token === args.where.token);
        if (existing) {
          existing.expiresAt = args.update.expiresAt;
          existing.revokedAt = args.update.revokedAt;
        } else {
          mockStore.refreshTokens.push({
            id: `refresh-token-${mockStore.refreshTokens.length + 1}`,
            userId: args.create.userId,
            token: args.create.token,
            expiresAt: args.create.expiresAt,
            createdAt: new Date(),
            revokedAt: null,
          });
        }
      },
      findUnique: async (args: {
        where: { token: string };
        select: { userId: true; expiresAt: true; revokedAt: true };
      }) => {
        const row = mockStore.refreshTokens.find((r) => r.token === args.where.token);
        if (!row) return null;
        return { userId: row.userId, expiresAt: row.expiresAt, revokedAt: row.revokedAt };
      },
      update: async (args: { where: { token: string }; data: { revokedAt: Date } }) => {
        const row = mockStore.refreshTokens.find((r) => r.token === args.where.token);
        if (row) {
          row.revokedAt = args.data.revokedAt;
          return row;
        }
        return null;
      },
      deleteMany: async (args: { where: { userId?: string; expiresAt?: { lt: Date } } }) => {
        const before = mockStore.refreshTokens.length;
        if (args.where.userId !== undefined) {
          mockStore.refreshTokens = mockStore.refreshTokens.filter((row) => row.userId !== args.where.userId);
        } else if (args.where.expiresAt !== undefined) {
          const expiresBefore = args.where.expiresAt.lt;
          mockStore.refreshTokens = mockStore.refreshTokens.filter((row) => row.expiresAt >= expiresBefore);
        }
        return { count: before - mockStore.refreshTokens.length };
      },
    },
    emailVerification: {
      create: async (args: {
        data: { userId: string; expiresAt: Date; otpExpiresAt: Date; token: string; otpCodeHash: string | null };
      }) => {
        const row: EmailVerificationRow = {
          id: `email-verification-${mockStore.emailVerifications.length + 1}`,
          userId: args.data.userId,
          token: args.data.token,
          otpCodeHash: args.data.otpCodeHash,
          otpExpiresAt: args.data.otpExpiresAt,
          attempts: 0,
          expiresAt: args.data.expiresAt,
          createdAt: new Date(),
        };
        mockStore.emailVerifications.push(row);
        return row;
      },
      findUnique: async (args: { where: { token: string } }) => {
        return mockStore.emailVerifications.find((row) => row.token === args.where.token) ?? null;
      },
      findFirst: async (args: { where: { userId: string }; orderBy: { createdAt: 'desc' } }) => {
        const rows = mockStore.emailVerifications.filter((row) => row.userId === args.where.userId);
        if (rows.length === 0) return null;
        return rows.reduce((latest, row) => (row.createdAt >= latest.createdAt ? row : latest));
      },
      update: async (args: { where: { id: string }; data: { attempts: { increment: number } } }) => {
        const row = mockStore.emailVerifications.find((r) => r.id === args.where.id);
        if (row) {
          row.attempts += args.data.attempts.increment;
          return row;
        }
        return null;
      },
      delete: async (args: { where: { id: string } }) => {
        const row = mockStore.emailVerifications.find((r) => r.id === args.where.id);
        mockStore.emailVerifications = mockStore.emailVerifications.filter((r) => r.id !== args.where.id);
        return row;
      },
      deleteMany: async (args: { where: { userId: string } }) => {
        const before = mockStore.emailVerifications.length;
        mockStore.emailVerifications = mockStore.emailVerifications.filter(
          (row) => row.userId !== args.where.userId,
        );
        return { count: before - mockStore.emailVerifications.length };
      },
    },
    passwordReset: {
      create: async (args: {
        data: { userId: string; expiresAt: Date; otpExpiresAt: Date; token: string; otpCodeHash: string | null };
      }) => {
        const row: PasswordResetRow = {
          id: `password-reset-${mockStore.passwordResets.length + 1}`,
          userId: args.data.userId,
          token: args.data.token,
          otpCodeHash: args.data.otpCodeHash,
          otpExpiresAt: args.data.otpExpiresAt,
          attempts: 0,
          expiresAt: args.data.expiresAt,
          createdAt: new Date(),
          usedAt: null,
        };
        mockStore.passwordResets.push(row);
        return row;
      },
      findUnique: async (args: { where: { token: string } }) => {
        return mockStore.passwordResets.find((row) => row.token === args.where.token) ?? null;
      },
      findFirst: async (args: { where: { userId: string }; orderBy: { createdAt: 'desc' } }) => {
        const rows = mockStore.passwordResets.filter((row) => row.userId === args.where.userId);
        if (rows.length === 0) return null;
        return rows.reduce((latest, row) => (row.createdAt >= latest.createdAt ? row : latest));
      },
      update: async (args: {
        where: { id: string };
        data: { attempts: { increment: number } } | { usedAt: Date };
      }) => {
        const row = mockStore.passwordResets.find((r) => r.id === args.where.id);
        if (row) {
          if ('attempts' in args.data) {
            row.attempts += args.data.attempts.increment;
          } else {
            row.usedAt = args.data.usedAt;
          }
          return row;
        }
        return null;
      },
      deleteMany: async (args: { where: { userId: string } }) => {
        const before = mockStore.passwordResets.length;
        mockStore.passwordResets = mockStore.passwordResets.filter((row) => row.userId !== args.where.userId);
        return { count: before - mockStore.passwordResets.length };
      },
    },
    oAuthAccount: {
      create: async (args: { data: OAuthAccountRow }) => {
        mockStore.oAuthAccounts.push(args.data);
      },
      findUnique: async (args: { where: Prisma.OAuthAccountWhereUniqueInput }) => {
        const compound = args.where.provider_providerId;
        if (compound === undefined) return null;
        const row = mockStore.oAuthAccounts.find(
          (r) => r.provider === compound.provider && r.providerId === compound.providerId,
        );
        return row ? { userId: row.userId } : null;
      },
    },
  },
}));

import { UserRepository } from '../UserRepository';
import { tokenService } from '../../../domain/services/TokenService';
import type { Prisma } from '@prisma/client';
import { UserType } from '@jam-band/shared';

const EXPIRES_AT = new Date('2030-01-01T00:00:00Z');

describe('UserRepository hash-at-rest (DEV-188)', () => {
  beforeEach(() => {
    mockStore.refreshTokens.length = 0;
    mockStore.emailVerifications.length = 0;
    mockStore.passwordResets.length = 0;
  });

  it('stores the refresh-token hash, never the raw token; lookup by the raw value round-trips', async () => {
    const repo = new UserRepository();
    const rawToken = 'raw-refresh-token-a';

    await repo.createRefreshToken({ userId: 'user-1', token: rawToken, expiresAt: EXPIRES_AT });

    expect(mockStore.refreshTokens).toHaveLength(1);
    const stored = mockStore.refreshTokens[0]!;
    expect(stored.token).not.toBe(rawToken);
    expect(stored.token).toBe(tokenService.hashToken(rawToken));
    expect(mockStore.refreshTokens.some((row) => row.token === rawToken)).toBe(false);

    // Round-trip: the repo hashes the raw token again before lookup, so it resolves.
    expect(await repo.findRefreshTokenByToken(rawToken)).toEqual({
      userId: 'user-1',
      expiresAt: EXPIRES_AT,
      revokedAt: null,
    });

    // A different raw value cannot resolve to the stored row.
    expect(await repo.findRefreshTokenByToken('raw-refresh-token-b')).toBeNull();
  });

  it('stores the email-verification token and OTP code as hashes; lookup by the raw token round-trips', async () => {
    const repo = new UserRepository();
    const rawToken = 'raw-verification-token';
    const rawOtp = '123456';

    await repo.createEmailVerification({
      userId: 'user-1',
      token: rawToken,
      otpCode: rawOtp,
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });

    expect(mockStore.emailVerifications).toHaveLength(1);
    const stored = mockStore.emailVerifications[0]!;
    expect(stored.token).not.toBe(rawToken);
    expect(stored.token).toBe(tokenService.hashToken(rawToken));
    expect(stored.otpCodeHash).not.toBe(rawOtp);
    expect(stored.otpCodeHash).toBe(tokenService.hashToken(rawOtp));

    const found = await repo.findEmailVerificationByToken(rawToken);
    expect(found).not.toBeNull();
    expect(found?.userId).toBe('user-1');
    // The model only ever carries the stored hash, never the raw token.
    expect(found?.token).toBe(tokenService.hashToken(rawToken));
    expect(await repo.findEmailVerificationByToken('wrong-verification-token')).toBeNull();
  });

  it('stores the password-reset token and OTP code as hashes; lookup by the raw token round-trips', async () => {
    const repo = new UserRepository();
    const rawToken = 'raw-reset-token';
    const rawOtp = '654321';

    await repo.createPasswordReset({
      userId: 'user-1',
      token: rawToken,
      otpCode: rawOtp,
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });

    expect(mockStore.passwordResets).toHaveLength(1);
    const stored = mockStore.passwordResets[0]!;
    expect(stored.token).not.toBe(rawToken);
    expect(stored.token).toBe(tokenService.hashToken(rawToken));
    expect(stored.otpCodeHash).not.toBe(rawOtp);
    expect(stored.otpCodeHash).toBe(tokenService.hashToken(rawOtp));

    const found = await repo.findPasswordResetByToken(rawToken);
    expect(found).not.toBeNull();
    expect(found?.userId).toBe('user-1');
    expect(await repo.findPasswordResetByToken('wrong-reset-token')).toBeNull();
  });
});

describe('UserRepository.revokeAllUserRefreshTokens hard delete (DEV-338)', () => {
  beforeEach(() => {
    mockStore.refreshTokens.length = 0;
  });

  it('hard-deletes the rows so revoked tokens cannot be looked up afterwards', async () => {
    // DEV-338: revocation must be a hard delete, not a soft-revoke (updateMany setting
    // revokedAt). AuthService.refreshAccessToken grants a 30s grace period to any token
    // record with a recent revokedAt (legitimate multi-tab rotation race); a soft-revoked
    // row would survive for that branch to find, so a polling attacker holding a stale
    // token could ride out the window after ANY security-triggered revocation (OTP
    // verify, OAuth link, logout) and mint a fresh session. Hard-deleting the rows means
    // findRefreshTokenByToken returns null and refreshAccessToken rejects immediately.
    const repo = new UserRepository();

    await repo.createRefreshToken({ userId: 'user-1', token: 'token-a', expiresAt: EXPIRES_AT });
    await repo.createRefreshToken({ userId: 'user-1', token: 'token-b', expiresAt: EXPIRES_AT });
    await repo.createRefreshToken({ userId: 'user-2', token: 'token-c', expiresAt: EXPIRES_AT });

    await repo.revokeAllUserRefreshTokens('user-1');

    // Rows for the revoked user are gone entirely; other users are untouched.
    expect(mockStore.refreshTokens).toHaveLength(1);
    expect(mockStore.refreshTokens[0]?.userId).toBe('user-2');
    expect(await repo.findRefreshTokenByToken('token-a')).toBeNull();
    expect(await repo.findRefreshTokenByToken('token-b')).toBeNull();
    expect(await repo.findRefreshTokenByToken('token-c')).not.toBeNull();
  });
});

describe('UserRepository.createRefreshToken upsert (one active row)', () => {
  beforeEach(() => {
    mockStore.refreshTokens.length = 0;
  });

  it('re-issuing the same token for the same user replaces the previous row', async () => {
    const repo = new UserRepository();
    const secondExpiry = new Date('2030-02-01T00:00:00Z');

    await repo.createRefreshToken({ userId: 'user-1', token: 'same-token', expiresAt: EXPIRES_AT });
    await repo.createRefreshToken({ userId: 'user-1', token: 'same-token', expiresAt: secondExpiry });

    // Upsert (React StrictMode duplicate-issue safety): exactly one row remains,
    // and the re-issue refreshed expiresAt instead of duplicating.
    expect(mockStore.refreshTokens).toHaveLength(1);
    expect(mockStore.refreshTokens[0]?.expiresAt).toEqual(secondExpiry);
    expect((await repo.findRefreshTokenByToken('same-token'))?.expiresAt).toEqual(secondExpiry);
  });

  it('re-issuing the same token after a soft revoke clears revokedAt (upsert update branch)', async () => {
    const repo = new UserRepository();

    await repo.createRefreshToken({ userId: 'user-1', token: 'same-token', expiresAt: EXPIRES_AT });
    await repo.revokeRefreshToken('same-token');
    expect((await repo.findRefreshTokenByToken('same-token'))?.revokedAt).not.toBeNull();

    await repo.createRefreshToken({ userId: 'user-1', token: 'same-token', expiresAt: EXPIRES_AT });

    expect(mockStore.refreshTokens).toHaveLength(1);
    expect((await repo.findRefreshTokenByToken('same-token'))?.revokedAt).toBeNull();
  });
});

describe('UserRepository user query paths', () => {
  const repo = new UserRepository();

  beforeEach(() => {
    mockStore.users.length = 0;
    mockStore.oAuthAccounts.length = 0;
  });

  const seedUser = (overrides: Partial<UserRow> = {}): UserRow => {
    const row: UserRow = {
      id: 'user-1',
      email: 'test@example.com',
      username: 'testuser',
      passwordHash: 'hash',
      emailVerified: true,
      userType: 'REGISTERED',
      profilePictureUrl: null,
      onboardingTourPromptedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    };
    mockStore.users.push(row);
    return row;
  };

  it('findById returns a mapped AuthUserModel for an existing row and null otherwise', async () => {
    seedUser({ onboardingTourPromptedAt: new Date('2025-06-01') });

    const found = await repo.findById('user-1');
    expect(found).not.toBeNull();
    expect(found?.id).toBe('user-1');
    expect(found?.email).toBe('test@example.com');
    expect(found?.username).toBe('testuser');
    expect(found?.passwordHash).toBe('hash');
    expect(found?.emailVerified).toBe(true);
    expect(found?.userType).toBe('REGISTERED');
    expect(found?.profilePictureUrl).toBeNull();
    expect(found?.onboardingTourPromptedAt).toEqual(new Date('2025-06-01'));
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findByEmail resolves by email and returns null for an unknown address', async () => {
    seedUser();
    const found = await repo.findByEmail('test@example.com');
    expect(found?.id).toBe('user-1');
    expect(await repo.findByEmail('other@example.com')).toBeNull();
  });

  it('findByUsername resolves by username and returns null for an unknown name', async () => {
    seedUser();
    const found = await repo.findByUsername('testuser');
    expect(found?.id).toBe('user-1');
    expect(await repo.findByUsername('someone-else')).toBeNull();
  });

  it('create persists all fields and maps back to a model', async () => {
    const created = await repo.create({
      email: 'new@example.com',
      username: 'newuser',
      passwordHash: 'new-hash',
      emailVerified: false,
      userType: UserType.REGISTERED,
      profilePictureUrl: 'https://storage.example.com/pic.jpg',
    });

    expect(created.id).toBe('user-1');
    expect(created.email).toBe('new@example.com');
    expect(created.userType).toBe('REGISTERED');
    expect(mockStore.users).toHaveLength(1);
    expect(mockStore.users[0]?.profilePictureUrl).toBe('https://storage.example.com/pic.jpg');
  });

  it('create stores null profilePictureUrl when none is provided', async () => {
    const created = await repo.create({
      email: 'new@example.com',
      username: 'newuser',
      passwordHash: null,
      emailVerified: true,
      userType: UserType.ARTIST,
    });

    expect(created.profilePictureUrl).toBeNull();
    expect(mockStore.users[0]?.profilePictureUrl).toBeNull();
  });

  it('updateEmailVerified flips the flag on the row', async () => {
    seedUser({ emailVerified: false });
    await repo.updateEmailVerified('user-1', true);
    expect(mockStore.users[0]?.emailVerified).toBe(true);
  });

  it('updatePassword replaces the stored hash', async () => {
    seedUser();
    await repo.updatePassword('user-1', 'new-hash');
    expect(mockStore.users[0]?.passwordHash).toBe('new-hash');
  });

  it('updateUsername replaces the stored username', async () => {
    seedUser();
    await repo.updateUsername('user-1', 'renamed');
    expect(mockStore.users[0]?.username).toBe('renamed');
  });

  it('updateProfilePictureUrl updates the row and returns the refreshed model', async () => {
    seedUser();
    const updated = await repo.updateProfilePictureUrl('user-1', 'https://storage.example.com/new.jpg');

    expect(updated.profilePictureUrl).toBe('https://storage.example.com/new.jpg');
    expect(mockStore.users[0]?.profilePictureUrl).toBe('https://storage.example.com/new.jpg');
  });
});

describe('UserRepository email-verification lifecycle', () => {
  const repo = new UserRepository();

  beforeEach(() => {
    mockStore.emailVerifications.length = 0;
  });

  it('findEmailVerificationByUserId returns the most recently created row for the user', async () => {
    await repo.createEmailVerification({
      userId: 'user-1',
      token: 'old-token',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    await repo.createEmailVerification({
      userId: 'user-1',
      token: 'new-token',
      otpCode: '222222',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });

    const latest = await repo.findEmailVerificationByUserId('user-1');
    expect(latest?.token).toBe(tokenService.hashToken('new-token'));
    // Unknown users resolve to null.
    expect(await repo.findEmailVerificationByUserId('user-2')).toBeNull();
  });

  it('incrementEmailVerificationAttempts bumps the attempt counter', async () => {
    await repo.createEmailVerification({
      userId: 'user-1',
      token: 'tok',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    const rowId = mockStore.emailVerifications[0]?.id;

    const updated = await repo.incrementEmailVerificationAttempts(rowId!);
    expect(updated.attempts).toBe(1);
    expect(mockStore.emailVerifications[0]?.attempts).toBe(1);
  });

  it('deleteEmailVerification removes a single row', async () => {
    await repo.createEmailVerification({
      userId: 'user-1',
      token: 'tok-a',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    await repo.createEmailVerification({
      userId: 'user-1',
      token: 'tok-b',
      otpCode: '222222',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    const rowId = mockStore.emailVerifications[0]?.id;

    await repo.deleteEmailVerification(rowId!);
    expect(mockStore.emailVerifications).toHaveLength(1);
    expect(mockStore.emailVerifications[0]?.token).toBe(tokenService.hashToken('tok-b'));
  });

  it('deleteEmailVerificationsByUserId removes every row for the user only', async () => {
    await repo.createEmailVerification({
      userId: 'user-1',
      token: 'tok-a',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    await repo.createEmailVerification({
      userId: 'user-2',
      token: 'tok-b',
      otpCode: '222222',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });

    await repo.deleteEmailVerificationsByUserId('user-1');
    expect(mockStore.emailVerifications).toHaveLength(1);
    expect(mockStore.emailVerifications[0]?.userId).toBe('user-2');
  });
});

describe('UserRepository password-reset lifecycle', () => {
  const repo = new UserRepository();

  beforeEach(() => {
    mockStore.passwordResets.length = 0;
  });

  it('findPasswordResetByUserId returns the most recently created row for the user', async () => {
    await repo.createPasswordReset({
      userId: 'user-1',
      token: 'old-token',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    await repo.createPasswordReset({
      userId: 'user-1',
      token: 'new-token',
      otpCode: '222222',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });

    const latest = await repo.findPasswordResetByUserId('user-1');
    expect(latest?.token).toBe(tokenService.hashToken('new-token'));
    expect(await repo.findPasswordResetByUserId('user-2')).toBeNull();
  });

  it('incrementPasswordResetAttempts bumps the attempt counter', async () => {
    await repo.createPasswordReset({
      userId: 'user-1',
      token: 'tok',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    const rowId = mockStore.passwordResets[0]?.id;

    const updated = await repo.incrementPasswordResetAttempts(rowId!);
    expect(updated.attempts).toBe(1);
  });

  it('markPasswordResetAsUsed stamps the usedAt timestamp', async () => {
    await repo.createPasswordReset({
      userId: 'user-1',
      token: 'tok',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    const rowId = mockStore.passwordResets[0]?.id;

    await repo.markPasswordResetAsUsed(rowId!);
    expect(mockStore.passwordResets[0]?.usedAt).not.toBeNull();
  });

  it('deletePasswordResetsByUserId removes every row for the user only', async () => {
    await repo.createPasswordReset({
      userId: 'user-1',
      token: 'tok-a',
      otpCode: '111111',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });
    await repo.createPasswordReset({
      userId: 'user-2',
      token: 'tok-b',
      otpCode: '222222',
      otpExpiresAt: EXPIRES_AT,
      expiresAt: EXPIRES_AT,
    });

    await repo.deletePasswordResetsByUserId('user-1');
    expect(mockStore.passwordResets).toHaveLength(1);
    expect(mockStore.passwordResets[0]?.userId).toBe('user-2');
  });
});

describe('UserRepository OAuth accounts', () => {
  const repo = new UserRepository();

  beforeEach(() => {
    mockStore.oAuthAccounts.length = 0;
  });

  it('createOAuthAccount persists the link; findOAuthAccount resolves it back', async () => {
    await repo.createOAuthAccount({ userId: 'user-1', provider: 'google', providerId: 'google-id-1' });

    expect(await repo.findOAuthAccount('google', 'google-id-1')).toEqual({ userId: 'user-1' });
    expect(await repo.findOAuthAccount('google', 'other-id')).toBeNull();
    expect(await repo.findOAuthAccount('github', 'google-id-1')).toBeNull();
  });
});

describe('UserRepository.deleteExpiredRefreshTokens', () => {
  const repo = new UserRepository();

  beforeEach(() => {
    mockStore.refreshTokens.length = 0;
  });

  it('deletes only tokens that expired before now, keeping live ones', async () => {
    await repo.createRefreshToken({ userId: 'user-1', token: 'expired-token', expiresAt: new Date('2020-01-01') });
    await repo.createRefreshToken({ userId: 'user-1', token: 'live-token', expiresAt: EXPIRES_AT });

    await repo.deleteExpiredRefreshTokens();

    expect(mockStore.refreshTokens).toHaveLength(1);
    expect(mockStore.refreshTokens[0]?.token).toBe(tokenService.hashToken('live-token'));
    expect(await repo.findRefreshTokenByToken('expired-token')).toBeNull();
  });
});

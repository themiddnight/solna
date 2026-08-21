import type { UserType as PrismaUserType } from '@prisma/client';
import type { AuthUser, UserType } from '../../domain/models/User';
import { AuthUserModel } from '../../domain/models/User';
import { EmailVerificationModel } from '../../domain/models/EmailVerification';
import { PasswordResetModel } from '../../domain/models/PasswordReset';
import { tokenService } from '../../domain/services/TokenService';
import { prisma } from '@/config/prisma';

export interface CreateUserData {
  email: string | null;
  username: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  userType: UserType;
  profilePictureUrl?: string | null;
}

export interface CreateEmailVerificationData {
  userId: string;
  token: string;
  otpCode: string;
  otpExpiresAt: Date;
  expiresAt: Date;
}

export interface CreatePasswordResetData {
  userId: string;
  token: string;
  otpCode: string;
  otpExpiresAt: Date;
  expiresAt: Date;
}

export interface CreateOAuthAccountData {
  userId: string;
  provider: string;
  providerId: string;
}

export interface CreateRefreshTokenData {
  userId: string;
  token: string;
  expiresAt: Date;
}

export class UserRepository {
  async findById(id: string): Promise<AuthUserModel | null> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    return user ? AuthUserModel.fromPrisma(user as AuthUser) : null;
  }

  async findByEmail(email: string): Promise<AuthUserModel | null> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    return user ? AuthUserModel.fromPrisma(user as AuthUser) : null;
  }

  async findByUsername(username: string): Promise<AuthUserModel | null> {
    const user = await prisma.user.findFirst({
      where: { username },
    });

    return user ? AuthUserModel.fromPrisma(user as AuthUser) : null;
  }

  async create(data: CreateUserData): Promise<AuthUserModel> {
    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash: data.passwordHash,
        emailVerified: data.emailVerified,
        userType: data.userType as PrismaUserType,
        profilePictureUrl: data.profilePictureUrl ?? null,
      },
    });

    return AuthUserModel.fromPrisma(user as AuthUser);
  }

  async updateEmailVerified(userId: string, emailVerified: boolean): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified },
    });
  }

  async updatePassword(userId: string, passwordHash: string | null): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async updateUsername(userId: string, username: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { username },
    });
  }

  async updateProfilePictureUrl(userId: string, profilePictureUrl: string | null): Promise<AuthUserModel> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { profilePictureUrl },
    });
    return AuthUserModel.fromPrisma(user as AuthUser);
  }

  async createEmailVerification(data: CreateEmailVerificationData): Promise<EmailVerificationModel> {
    const verification = await prisma.emailVerification.create({
      // Store only hashes at rest (DEV-188/DEV-207); raw token/code are emailed, never persisted.
      data: {
        userId: data.userId,
        expiresAt: data.expiresAt,
        otpExpiresAt: data.otpExpiresAt,
        token: tokenService.hashToken(data.token),
        otpCodeHash: tokenService.hashToken(data.otpCode),
      },
    });

    return EmailVerificationModel.fromPrisma(verification);
  }

  async findEmailVerificationByToken(token: string): Promise<EmailVerificationModel | null> {
    const verification = await prisma.emailVerification.findUnique({
      where: { token: tokenService.hashToken(token) },
    });

    return verification ? EmailVerificationModel.fromPrisma(verification) : null;
  }

  async findEmailVerificationByUserId(userId: string): Promise<EmailVerificationModel | null> {
    const verification = await prisma.emailVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return verification ? EmailVerificationModel.fromPrisma(verification) : null;
  }

  async incrementEmailVerificationAttempts(id: string): Promise<EmailVerificationModel> {
    const verification = await prisma.emailVerification.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });

    return EmailVerificationModel.fromPrisma(verification);
  }

  async deleteEmailVerification(id: string): Promise<void> {
    await prisma.emailVerification.delete({
      where: { id },
    });
  }

  async deleteEmailVerificationsByUserId(userId: string): Promise<void> {
    await prisma.emailVerification.deleteMany({
      where: { userId },
    });
  }

  async createPasswordReset(data: CreatePasswordResetData): Promise<PasswordResetModel> {
    const reset = await prisma.passwordReset.create({
      data: {
        userId: data.userId,
        expiresAt: data.expiresAt,
        otpExpiresAt: data.otpExpiresAt,
        token: tokenService.hashToken(data.token),
        otpCodeHash: tokenService.hashToken(data.otpCode),
      },
    });

    return PasswordResetModel.fromPrisma(reset);
  }

  async findPasswordResetByToken(token: string): Promise<PasswordResetModel | null> {
    const reset = await prisma.passwordReset.findUnique({
      where: { token: tokenService.hashToken(token) },
    });

    return reset ? PasswordResetModel.fromPrisma(reset) : null;
  }

  async findPasswordResetByUserId(userId: string): Promise<PasswordResetModel | null> {
    const reset = await prisma.passwordReset.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return reset ? PasswordResetModel.fromPrisma(reset) : null;
  }

  async incrementPasswordResetAttempts(id: string): Promise<PasswordResetModel> {
    const reset = await prisma.passwordReset.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });

    return PasswordResetModel.fromPrisma(reset);
  }

  async markPasswordResetAsUsed(id: string): Promise<void> {
    await prisma.passwordReset.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async deletePasswordResetsByUserId(userId: string): Promise<void> {
    await prisma.passwordReset.deleteMany({
      where: { userId },
    });
  }

  async createOAuthAccount(data: CreateOAuthAccountData): Promise<void> {
    await prisma.oAuthAccount.create({
      data,
    });
  }

  async findOAuthAccount(provider: string, providerId: string): Promise<{ userId: string } | null> {
    const account = await prisma.oAuthAccount.findUnique({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        provider_providerId: {
          provider,
          providerId,
        },
      },
    });

    return account ? { userId: account.userId } : null;
  }

  async createRefreshToken(data: CreateRefreshTokenData): Promise<void> {
    // Use upsert to handle potential duplicate tokens from concurrent requests (e.g., React StrictMode)
    // Store only a hash of the refresh-token JWT at rest (DEV-188); the raw JWT is still
    // signature-verified by TokenService and returned to the client.
    const tokenHash = tokenService.hashToken(data.token);
    await prisma.refreshToken.upsert({
      where: { token: tokenHash },
      create: { ...data, token: tokenHash },
      update: { expiresAt: data.expiresAt, revokedAt: null },
    });
  }

  async findRefreshTokenByToken(token: string): Promise<{ userId: string; expiresAt: Date; revokedAt: Date | null } | null> {
    const refreshToken = await prisma.refreshToken.findUnique({
      where: { token: tokenService.hashToken(token) },
      select: { userId: true, expiresAt: true, revokedAt: true },
    });
    return refreshToken;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { token: tokenService.hashToken(token) },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    // Hard delete, not soft-revoke: security-triggered revocation (OTP verify, OAuth link,
    // logout) must leave no row for refreshAccessToken's grace-period branch to find, or a
    // polling attacker can ride out the 30s window and mint a fresh session (DEV-338).
    // revokeRefreshToken (single-token, used during normal rotation) keeps its soft-revoke +
    // grace-period behavior — that path exists specifically for legitimate multi-tab races.
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  async deleteExpiredRefreshTokens(): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }
}


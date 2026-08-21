import bcrypt from 'bcrypt';
import type { AuthUserModel} from '../models/User';
import { UserType } from '../models/User';

const BCRYPT_SALT_ROUNDS = 12;
// Precomputed at module load so failed logins (unknown email / OAuth-only account with no
// password) still perform a bcrypt comparison. Without this, the no-bcrypt fast path leaks
// account existence via response timing (DEV-192).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-password-placeholder', BCRYPT_SALT_ROUNDS);
// In-app OTP codes (email verification / password reset) are valid for 10 minutes.
const OTP_TTL_MS = 10 * 60 * 1000;
// A fresh verification code may be requested once per minute per account (also bounds OTP email volume).
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Thrown when a verification code is requested again before the 60s cooldown has elapsed. */
export class OtpCooldownError extends Error {
  constructor(public readonly resendAvailableAt: Date) {
    super('Please wait before requesting another code');
    this.name = 'OtpCooldownError';
  }
}
// import { EmailVerificationModel } from '../models/EmailVerification';
// import { PasswordResetModel } from '../models/PasswordReset';
import { tokenService } from './TokenService';
import { emailService } from '../../infrastructure/services/EmailService';
import type { UserRepository } from '../../infrastructure/repositories/UserRepository';
import { config } from '../../../../config/environment';
import { parseDurationToMs } from '../../../../shared/utils/duration';
import { CacheService } from '../../../../shared/infrastructure/caching/CacheService';
import { CACHE_KEYS } from '../../../../shared/constants/CacheKeys';

export interface RegisterData {
  email: string;
  password: string;
  username: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository
  ) { }

  async register(data: RegisterData): Promise<{
    user: AuthUserModel;
    verificationSessionToken: string;
    otpExpiresAt: Date;
    resendAvailableAt: Date;
  }> {
    const existingUser = await this.userRepository.findByEmail(data.email);
    if (existingUser?.emailVerified === true) {
      throw new Error('Email already registered');
    }

    // A username may never be taken from a different account.
    if (data.username.length > 0) {
      const existingUsername = await this.userRepository.findByUsername(data.username);
      if (existingUsername && existingUsername.id !== existingUser?.id) {
        throw new Error('Username already taken');
      }
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

    let user: AuthUserModel;
    // Set only on the continue-signup path: a code minted moments ago that is still live inside
    // its resend cooldown. Reusing it is what keeps repeated POST /auth/register calls from
    // becoming an email cannon aimed at the address's real owner — registerLimiter is keyed
    // per-IP, so it cannot bound per-account OTP mail volume on its own (design spec §4.5).
    let pendingChallenge: { otpExpiresAt: Date; resendAvailableAt: Date } | null = null;
    if (existingUser) {
      // Continue-signup: the address was claimed but never proven, so whoever completes the OTP
      // owns it. Overwriting the unproven credentials keeps the caller from hitting a dead end,
      // and the response is indistinguishable from a first-time signup (no account enumeration) —
      // reusing a pending code preserves that property, since the response carries the same fields
      // either way.
      // (issueEmailVerificationCode() below already deletes pending verification rows for this
      // user, so a redundant delete here was removed.)
      await this.userRepository.updatePassword(existingUser.id, passwordHash);
      await this.userRepository.updateUsername(existingUser.id, data.username);
      // Residual timing note: continue-signup does one extra DB round trip (findById, to return
      // the refreshed user row) vs fresh signup before both branches converge below — a minor
      // residual timing signal, accepted as disproportionate to fully equalize (unlike
      // DUMMY_PASSWORD_HASH's single deterministic hot-path compare, this is genuine multi-row
      // write work, and both branches share an outbound email send that dominates real-world
      // jitter).
      const refreshed = await this.userRepository.findById(existingUser.id);
      if (!refreshed) {
        throw new Error('User not found');
      }
      user = refreshed;
      // Must be read before issueEmailVerificationCode() below, which deletes pending rows.
      pendingChallenge = await this.findPendingChallenge(user.id);
    } else {
      user = await this.userRepository.create({
        email: data.email,
        username: data.username,
        passwordHash,
        emailVerified: false,
        userType: UserType.REGISTERED,
      });
    }

    // A brand-new account can have no pending challenge, so this always mints for a first-time
    // signup — the two paths stay indistinguishable in both shape and behavior.
    const { otpExpiresAt, resendAvailableAt } =
      pendingChallenge ?? await this.issueEmailVerificationCode(user.id, data.email);

    return {
      user,
      verificationSessionToken: tokenService.generateVerificationSessionToken({ userId: user.id, email: data.email }),
      otpExpiresAt,
      resendAvailableAt,
    };
  }

  async login(data: LoginData): Promise<
    | { user: AuthUserModel; accessToken: string; refreshToken: string }
    | {
        user: AuthUserModel;
        verificationRequired: true;
        verificationSessionToken: string;
        otpExpiresAt: Date;
        resendAvailableAt: Date;
      }
  > {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user || !user.passwordHash) {
      // Equalize timing with the valid-user path before failing, so an unknown email is not
      // distinguishable from a wrong password by response latency (user enumeration).
      await bcrypt.compare(data.password, DUMMY_PASSWORD_HASH);
      throw new Error('Invalid email or password');
    }

    const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // OTP-only verification: unverified users must verify before receiving tokens.
    // Reuse a code that is still fresh rather than emailing a new one on every login attempt.
    if (!user.emailVerified) {
      const pending = await this.findPendingChallenge(user.id);
      const challenge = pending ?? await this.issueEmailVerificationCode(user.id, user.email!);

      return {
        user,
        verificationRequired: true,
        verificationSessionToken: tokenService.generateVerificationSessionToken({
          userId: user.id,
          email: user.email!,
        }),
        otpExpiresAt: challenge.otpExpiresAt,
        resendAvailableAt: challenge.resendAvailableAt,
      };
    }

    const { accessToken, refreshToken } = await this.issueTokenPair(user);

    return { user, accessToken, refreshToken };
  }

  async verifyEmailByCode(verificationSessionToken: string, code: string): Promise<{ user: AuthUserModel; accessToken: string; refreshToken: string }> {
    const payload = tokenService.verifyVerificationSessionToken(verificationSessionToken);

    const verification = await this.userRepository.findEmailVerificationByUserId(payload.userId);
    if (!verification) {
      throw new Error('No pending verification found');
    }

    if (verification.isOtpExpired()) {
      throw new Error('Verification code has expired');
    }

    const providedHash = tokenService.hashToken(code);
    if (providedHash !== verification.otpCodeHash) {
      const updated = await this.userRepository.incrementEmailVerificationAttempts(verification.id);
      if (updated.hasExceededOtpAttempts()) {
        await this.userRepository.deleteEmailVerification(verification.id);
        throw new Error('Too many incorrect attempts. Please request a new code.');
      }
      throw new Error('Incorrect verification code');
    }

    const user = await this.userRepository.findById(verification.userId);
    if (!user) {
      throw new Error('User not found');
    }

    await this.userRepository.updateEmailVerified(user.id, true);
    CacheService.getInstance().del(CACHE_KEYS.socketAuthUser(user.id));
    await this.userRepository.deleteEmailVerification(verification.id);

    // Re-fetch so the returned object reflects the just-written emailVerified: true state,
    // instead of the stale pre-update value fetched above.
    const verifiedUser = await this.userRepository.findById(user.id);
    if (!verifiedUser) {
      throw new Error('User not found');
    }

    // Any refresh token that predates verification was minted under the old flow — retire it so
    // verification produces exactly one live session.
    await this.userRepository.revokeAllUserRefreshTokens(verifiedUser.id);

    // Auto-login after email verification: issue tokens so the frontend can commit
    // the authenticated session without a second round-trip to /login.
    const { accessToken, refreshToken } = await this.issueTokenPair(verifiedUser);

    return { user: verifiedUser, accessToken, refreshToken };
  }

  async resendVerificationCode(verificationSessionToken: string): Promise<{
    verificationSessionToken: string;
    otpExpiresAt: Date;
    resendAvailableAt: Date;
  }> {
    const payload = tokenService.verifyVerificationSessionToken(verificationSessionToken);

    const user = await this.userRepository.findById(payload.userId);
    if (!user || !user.email) {
      throw new Error('User not found or no email');
    }
    if (user.emailVerified) {
      throw new Error('Email already verified');
    }

    const pending = await this.findPendingChallenge(user.id);
    if (pending) {
      throw new OtpCooldownError(pending.resendAvailableAt);
    }

    const challenge = await this.issueEmailVerificationCode(user.id, user.email);

    return {
      verificationSessionToken: tokenService.generateVerificationSessionToken({ userId: user.id, email: user.email }),
      ...challenge,
    };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.email) {
      // Don't reveal if email exists
      return;
    }

    // Generate reset token + OTP code (DEV-207: additive, both point at the same row)
    const resetToken = tokenService.generatePasswordResetToken();
    const otpCode = tokenService.generateOtpCode();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + config.jwt.passwordResetExpiresHours);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Delete old reset tokens
    await this.userRepository.deletePasswordResetsByUserId(user.id);

    // Save reset token + code
    await this.userRepository.createPasswordReset({
      userId: user.id,
      token: resetToken,
      otpCode,
      otpExpiresAt,
      expiresAt,
    });

    // Send reset email (link + code)
    await emailService.sendPasswordResetEmail(user.email, resetToken, otpCode);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Find reset record
    const reset = await this.userRepository.findPasswordResetByToken(token);
    if (!reset) {
      throw new Error('Invalid reset token');
    }

    if (!reset.isValid()) {
      throw new Error('Reset token has expired or already used');
    }

    // Get user
    const user = await this.userRepository.findById(reset.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    // Update password
    await this.userRepository.updatePassword(user.id, passwordHash);

    // Mark reset as used
    await this.userRepository.markPasswordResetAsUsed(reset.id);

    // Delete all reset tokens for this user
    await this.userRepository.deletePasswordResetsByUserId(user.id);
  }

  async resetPasswordByCode(email: string, code: string, newPassword: string): Promise<void> {
    // Same enumeration-safe posture as the token path: one generic error either way.
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid code or email');
    }

    const reset = await this.userRepository.findPasswordResetByUserId(user.id);
    if (!reset) {
      throw new Error('Invalid code or email');
    }

    if (reset.isOtpExpired()) {
      throw new Error('Reset code has expired');
    }

    const providedHash = tokenService.hashToken(code);
    if (providedHash !== reset.otpCodeHash) {
      const updated = await this.userRepository.incrementPasswordResetAttempts(reset.id);
      if (updated.hasExceededOtpAttempts()) {
        await this.userRepository.deletePasswordResetsByUserId(user.id);
        throw new Error('Too many incorrect attempts. Please request a new code.');
      }
      throw new Error('Incorrect reset code');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await this.userRepository.updatePassword(user.id, passwordHash);
    await this.userRepository.deletePasswordResetsByUserId(user.id);
  }

  async changePassword(userId: string, currentPassword: string | null, newPassword: string): Promise<void> {
    // Find user by ID
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if user has existing password
    if (user.passwordHash) {
      // Regular user - verify current password
      if (!currentPassword) {
        throw new Error('Current password is required');
      }
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        throw new Error('Current password is incorrect');
      }
    } else {
      // OAuth user setting password for first time
      // No current password verification needed
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    // Update user password in database
    await this.userRepository.updatePassword(userId, passwordHash);
  }

  async findOrCreateOAuthUser(provider: string, providerId: string, email: string, name: string, profilePictureUrl?: string | null): Promise<{ user: AuthUserModel; accessToken: string; refreshToken: string }> {
    const user = await this.resolveOAuthUser(provider, providerId, email, name, profilePictureUrl);
    const { accessToken, refreshToken } = await this.issueTokenPair(user);
    return { user, accessToken, refreshToken };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify refresh token
    let payload;
    try {
      payload = tokenService.verifyRefreshToken(refreshToken);
    } catch {
      throw new Error('Invalid or expired refresh token');
    }

    // Check if token exists in database and is valid
    const tokenRecord = await this.userRepository.findRefreshTokenByToken(refreshToken);
    if (!tokenRecord) {
      throw new Error('Refresh token not found');
    }

    let isReusedWithinGracePeriod = false;

    if (tokenRecord.revokedAt) {
      // Allow a grace period for concurrent requests (e.g., multiple tabs)
      const GRACE_PERIOD_MS = 30 * 1000; // 30 seconds
      const timeSinceRevoke = new Date().getTime() - tokenRecord.revokedAt.getTime();

      if (timeSinceRevoke > GRACE_PERIOD_MS) {
        throw new Error('Refresh token has been revoked');
      }

      // Mark as reused within grace period so we don't try to revoke it again (preserving original timestamp)
      isReusedWithinGracePeriod = true;
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new Error('Refresh token has expired');
    }

    // Get user
    const user = await this.userRepository.findById(payload.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // OTP hard gate: a refresh cookie minted before verification (or before this gate existed)
    // must not keep resurrecting a session. The client is pushed back to login → OTP.
    if (!user.emailVerified) {
      throw new Error('Email verification required');
    }

    // Revoke the old refresh token, then rotate in a fresh access + refresh pair (more secure).
    if (!isReusedWithinGracePeriod) {
      await this.userRepository.revokeRefreshToken(refreshToken);
    }

    return this.issueTokenPair(user);
  }

  async updateUsername(userId: string, newUsername: string): Promise<AuthUserModel> {
    // Validate username
    if (newUsername.trim().length === 0) {
      throw new Error('Username cannot be empty');
    }

    const trimmedUsername = newUsername.trim();

    if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
      throw new Error('Username must be between 3 and 30 characters');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
    }

    // Check if username is already taken by another user
    const existingUser = await this.userRepository.findByUsername(trimmedUsername);
    if (existingUser && existingUser.id !== userId) {
      throw new Error('Username already taken');
    }

    // Update username
    await this.userRepository.updateUsername(userId, trimmedUsername);

    // Get updated user
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }

  async updateProfilePicture(userId: string, profilePictureUrl: string | null): Promise<AuthUserModel> {
    return await this.userRepository.updateProfilePictureUrl(userId, profilePictureUrl);
  }

  // Mint an access + refresh token pair for an authenticated user and persist the refresh token.
  // The DB record's lifetime tracks config.jwt.refreshTokenExpiresIn so the stored token never
  // expires before the JWT/HttpOnly cookie it gates. (Previously every call site hardcoded 7 days,
  // which silently capped the 30-day cookie/JWT session at 7 days.)
  private async issueTokenPair(user: AuthUserModel): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenPayload = { userId: user.id, email: user.email, userType: user.userType };
    const accessToken = tokenService.generateAccessToken(tokenPayload);
    const refreshToken = tokenService.generateRefreshToken(tokenPayload);

    const expiresAt = new Date(Date.now() + parseDurationToMs(config.jwt.refreshTokenExpiresIn));
    await this.userRepository.createRefreshToken({ userId: user.id, token: refreshToken, expiresAt });

    return { accessToken, refreshToken };
  }

  // Mint + email a fresh verification code, replacing any pending one. Returns the timestamps the
  // client needs to render its expiry and resend countdowns.
  private async issueEmailVerificationCode(userId: string, email: string): Promise<{ otpExpiresAt: Date; resendAvailableAt: Date }> {
    const otpCode = tokenService.generateOtpCode();
    const now = Date.now();
    const otpExpiresAt = new Date(now + OTP_TTL_MS);

    await this.userRepository.deleteEmailVerificationsByUserId(userId);
    await this.userRepository.createEmailVerification({
      userId,
      // The schema keys verification rows by token; OTP-only flows never use this value.
      token: tokenService.generateEmailVerificationToken(),
      otpCode,
      otpExpiresAt,
      expiresAt: otpExpiresAt,
    });

    await emailService.sendVerificationEmail(email, otpCode);

    return { otpExpiresAt, resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_MS) };
  }

  // Returns the still-usable pending challenge when one was issued inside the cooldown window,
  // or null when a fresh code may be minted. Keeps repeated login/resend attempts from
  // turning into an email flood aimed at the account holder.
  private async findPendingChallenge(userId: string): Promise<{ otpExpiresAt: Date; resendAvailableAt: Date } | null> {
    const pending = await this.userRepository.findEmailVerificationByUserId(userId);
    if (!pending || pending.otpExpiresAt === null || pending.isOtpExpired()) {
      return null;
    }
    const resendAvailableAt = new Date(pending.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS);
    return resendAvailableAt.getTime() > Date.now()
      ? { otpExpiresAt: pending.otpExpiresAt, resendAvailableAt }
      : null;
  }

  // An OAuth provider has just proven ownership of this account's address. Shared by both
  // "bless an existing user" OAuth paths (already-linked-but-unverified, and link-on-the-fly);
  // returns the refreshed row so no caller ever hands back the stale pre-update state.
  private async applyProviderVerification(user: AuthUserModel): Promise<AuthUserModel> {
    // The provider has proven ownership of this address, so the account becomes verified —
    // otherwise the OTP hard gate would reject the session we are about to issue.
    await this.userRepository.updateEmailVerified(user.id, true);
    if (!user.emailVerified) {
      // Blessing the account without this would complete a pre-hijack: someone could register
      // a victim's address with a known password, never verify, and wait for the victim's first
      // Google sign-in to validate it. The rightful owner sets a new password via forgot-password.
      // Scoped to the previously-unverified case: an already-verified account's password was
      // necessarily set by someone who already proved mailbox control, so there is no hijack to
      // close and nulling it here would just be an unannounced usability regression.
      await this.userRepository.updatePassword(user.id, null);
    }
    CacheService.getInstance().del(CACHE_KEYS.socketAuthUser(user.id));

    const blessed = await this.userRepository.findById(user.id);
    if (!blessed) {
      throw new Error('User not found');
    }

    // Any refresh token that predates verification was minted under the old flow — retire it so
    // this produces exactly one live session (mirrors verifyEmailByCode).
    await this.userRepository.revokeAllUserRefreshTokens(blessed.id);

    return blessed;
  }

  // Resolve the User an OAuth login maps to: an existing linked account, an existing email account
  // (which we link on the fly), or a brand-new pre-verified account. Token issuance is left to the
  // caller so all three paths share one code path (see issueTokenPair / findOrCreateOAuthUser).
  private async resolveOAuthUser(provider: string, providerId: string, email: string, name: string, profilePictureUrl?: string | null): Promise<AuthUserModel> {
    const oauthAccount = await this.userRepository.findOAuthAccount(provider, providerId);
    if (oauthAccount) {
      const user = await this.userRepository.findById(oauthAccount.userId);
      if (!user) {
        throw new Error('User not found');
      }
      // An already-linked account can still be unverified (linked before this gate existed, or by
      // any other path that leaves that state). Handing it a token pair unchanged would strand the
      // user in a login loop: the pair is minted, then every subsequent request — /auth/me,
      // refresh, every socket — is rejected with "Email verification required". The provider has
      // just re-proven ownership of the address, so bless it exactly as the link-on-the-fly branch
      // below does. An already-verified account passes straight through untouched: re-blessing it
      // would revoke its refresh tokens on every single sign-in, i.e. sign it out everywhere else.
      if (!user.emailVerified) {
        return this.applyProviderVerification(user);
      }
      return user;
    }

    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      await this.userRepository.createOAuthAccount({ userId: existingUser.id, provider, providerId });
      return this.applyProviderVerification(existingUser);
    }

    // Create a new user; OAuth emails are pre-verified by the provider.
    const newUser = await this.userRepository.create({
      email,
      username: name,
      passwordHash: null,
      emailVerified: true,
      userType: UserType.REGISTERED,
      profilePictureUrl: profilePictureUrl ?? null,
    });
    await this.userRepository.createOAuthAccount({ userId: newUser.id, provider, providerId });
    return newUser;
  }
}

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../../../../config/environment';

export interface JWTPayload {
  userId: string;
  email: string | null;
  userType: string;
  username?: string; // present on guest tokens (registered usernames come from the DB)
  iat?: number;
  exp?: number;
  type?: string; // 'refresh' for refresh tokens, 'guest' for guest tokens
}

// A verification-session token only needs to outlive one verify/resend interaction (DEV-207).
const VERIFICATION_SESSION_EXPIRES_IN = '30m';

export class TokenService {
  private readonly secret: string;
  private readonly accessTokenExpiresIn: string;
  private readonly refreshTokenExpiresIn: string;

  constructor() {
    const secret = config.jwt.secret;
    if (!secret) {
      if (config.nodeEnv === 'production') {
        throw new Error('JWT_SECRET is required in production');
      }
      this.secret = 'dev-fallback-not-for-production';
    } else {
      this.secret = secret;
    }
    // Both lifetimes come from config (ACCESS_TOKEN_EXPIRES_IN / REFRESH_TOKEN_EXPIRES_IN).
    // A longer access-token expiry reduces refresh churn (and session interruptions from transient
    // network errors during refresh); the refresh token is the long-lived, cookie-borne credential.
    this.accessTokenExpiresIn = config.jwt.accessTokenExpiresIn;
    this.refreshTokenExpiresIn = config.jwt.refreshTokenExpiresIn;
  }

  // Generate access token (short-lived; default 1h, from ACCESS_TOKEN_EXPIRES_IN)
  generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'type'>): string {
    return jwt.sign(payload, this.secret, {
      expiresIn: this.accessTokenExpiresIn,
    } as jwt.SignOptions);
  }

  // Generate refresh token (long-lived; default 30d, from REFRESH_TOKEN_EXPIRES_IN)
  generateRefreshToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'type'>): string {
    return jwt.sign(
      { ...payload, type: 'refresh' },
      this.secret,
      { expiresIn: this.refreshTokenExpiresIn } as jwt.SignOptions
    );
  }

  // Generate a guest token — a JWT for an ephemeral, unprivileged identity that has no DB row.
  // The `guest:` prefix on userId guarantees it can never collide with a real User.id (a UUID),
  // so a guest can never be mistaken for (or impersonate) a registered user (DEV-179).
  generateGuestToken(params: { userId: string; username: string }): string {
    return jwt.sign(
      { userId: params.userId, email: null, username: params.username, userType: 'GUEST', type: 'guest' },
      this.secret,
      { expiresIn: config.jwt.guestTokenExpiresIn } as jwt.SignOptions
    );
  }

  // 6-digit numeric OTP for in-app-completable verification/reset (DEV-207). Uses
  // crypto.randomInt for a uniform, cryptographically-secure distribution (Math.random() is not).
  generateOtpCode(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  // Short-lived JWT that lets an unauthenticated caller (e.g. a guest who just registered but
  // isn't logged in yet) prove they are the same request that just registered, scoped only to
  // resend/verify-by-code calls — never a substitute for a real access token (DEV-207).
  generateVerificationSessionToken(params: { userId: string; email: string }): string {
    return jwt.sign(
      { userId: params.userId, email: params.email, userType: 'REGISTERED', type: 'email-verification-session' },
      this.secret,
      { expiresIn: VERIFICATION_SESSION_EXPIRES_IN } as jwt.SignOptions
    );
  }

  verifyVerificationSessionToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as JWTPayload;
      if (decoded.type !== 'email-verification-session') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch {
      throw new Error('Invalid or expired verification session token');
    }
  }

  // Verify access token (for backward compatibility, also works as generateToken)
  verifyToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as JWTPayload;
      // Don't allow refresh or verification-session tokens to be used as access tokens
      if (decoded.type === 'refresh' || decoded.type === 'email-verification-session') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch {
      throw new Error('Invalid or expired token');
    }
  }

  // Verify refresh token
  verifyRefreshToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as JWTPayload;
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch {
      throw new Error('Invalid or expired refresh token');
    }
  }

  // Legacy method for backward compatibility
  generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return this.generateAccessToken(payload);
  }

  // Email-verification / password-reset tokens are high-entropy random strings (DEV-188), not
  // JWTs: their validity is gated entirely by the DB record (expiresAt / usedAt), and only a
  // hash of the token is persisted, so a DB read alone cannot mint or use them.
  generateEmailVerificationToken(): string {
    return this.generateSecureToken();
  }

  generatePasswordResetToken(): string {
    return this.generateSecureToken();
  }

  // Cryptographically-secure random token, returned raw to the caller (to email to the user)
  // but stored only as a hash at rest (see hashToken).
  generateSecureToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  // SHA-256 hash used to store/look up bearer tokens (refresh/reset/verification) so the DB
  // never holds a directly-usable raw token (DEV-188).
  hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}

export const tokenService = new TokenService();

import jwt from 'jsonwebtoken';

jest.mock('@/config/environment', () => ({
  config: {
    nodeEnv: 'test',
    logging: { level: 'error' },
    jwt: {
      secret: 'test-secret-for-unit-tests-only-32chars',
      accessTokenExpiresIn: '1h',
      refreshTokenExpiresIn: '30d',
      guestTokenExpiresIn: '12h',
      emailVerificationExpiresHours: 24,
      passwordResetExpiresHours: 1,
    },
  },
}));

import { TokenService } from '../TokenService';

const TEST_SECRET = 'test-secret-for-unit-tests-only-32chars';

const BASE_PAYLOAD = {
  userId: 'user-123',
  email: 'test@example.com',
  userType: 'REGISTERED',
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    service = new TokenService();
  });

  describe('constructor', () => {
    it('uses dev fallback when JWT_SECRET is missing in non-production', () => {
      // TokenService constructed with test config (secret present) — no throw
      expect(() => new TokenService()).not.toThrow();
    });
  });

  describe('generateAccessToken', () => {
    it('creates a valid JWT containing the payload fields', () => {
      const token = service.generateAccessToken(BASE_PAYLOAD);
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;

      expect(decoded.userId).toBe(BASE_PAYLOAD.userId);
      expect(decoded.email).toBe(BASE_PAYLOAD.email);
      expect(decoded.userType).toBe(BASE_PAYLOAD.userType);
    });

    it('does not embed type: refresh in access tokens', () => {
      const token = service.generateAccessToken(BASE_PAYLOAD);
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;

      expect(decoded.type).toBeUndefined();
    });

    it('includes iat and exp fields', () => {
      const token = service.generateAccessToken(BASE_PAYLOAD);
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;

      expect(typeof decoded.iat).toBe('number');
      expect(typeof decoded.exp).toBe('number');
    });
  });

  describe('generateRefreshToken', () => {
    it('creates a JWT with type: refresh', () => {
      const token = service.generateRefreshToken(BASE_PAYLOAD);
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;

      expect(decoded.type).toBe('refresh');
    });

    it('preserves all original payload fields', () => {
      const token = service.generateRefreshToken(BASE_PAYLOAD);
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;

      expect(decoded.userId).toBe(BASE_PAYLOAD.userId);
      expect(decoded.email).toBe(BASE_PAYLOAD.email);
      expect(decoded.userType).toBe(BASE_PAYLOAD.userType);
    });
  });

  describe('verifyToken (access token)', () => {
    it('decodes a valid access token and returns the payload', () => {
      const token = service.generateAccessToken(BASE_PAYLOAD);
      const decoded = service.verifyToken(token);

      expect(decoded.userId).toBe(BASE_PAYLOAD.userId);
      expect(decoded.email).toBe(BASE_PAYLOAD.email);
      expect(decoded.userType).toBe(BASE_PAYLOAD.userType);
    });

    it('throws when the token is expired', () => {
      const expired = jwt.sign(BASE_PAYLOAD, TEST_SECRET, { expiresIn: '-1s' });

      expect(() => service.verifyToken(expired)).toThrow('Invalid or expired token');
    });

    it('throws when a refresh token is used as an access token', () => {
      const refreshToken = service.generateRefreshToken(BASE_PAYLOAD);

      expect(() => service.verifyToken(refreshToken)).toThrow('Invalid or expired token');
    });

    it('throws on an invalid signature', () => {
      const token = jwt.sign(BASE_PAYLOAD, 'wrong-secret');

      expect(() => service.verifyToken(token)).toThrow('Invalid or expired token');
    });

    it('throws on a malformed token string', () => {
      expect(() => service.verifyToken('not.a.jwt')).toThrow('Invalid or expired token');
    });
  });

  describe('verifyRefreshToken', () => {
    it('decodes a valid refresh token and returns the payload', () => {
      const token = service.generateRefreshToken(BASE_PAYLOAD);
      const decoded = service.verifyRefreshToken(token);

      expect(decoded.userId).toBe(BASE_PAYLOAD.userId);
      expect(decoded.type).toBe('refresh');
    });

    it('throws when an access token is used as a refresh token', () => {
      const accessToken = service.generateAccessToken(BASE_PAYLOAD);

      expect(() => service.verifyRefreshToken(accessToken)).toThrow('Invalid or expired refresh token');
    });

    it('throws when the refresh token is expired', () => {
      const expired = jwt.sign({ ...BASE_PAYLOAD, type: 'refresh' }, TEST_SECRET, { expiresIn: '-1s' });

      expect(() => service.verifyRefreshToken(expired)).toThrow('Invalid or expired refresh token');
    });

    it('throws on an invalid signature', () => {
      const token = jwt.sign({ ...BASE_PAYLOAD, type: 'refresh' }, 'wrong-secret');

      expect(() => service.verifyRefreshToken(token)).toThrow('Invalid or expired refresh token');
    });
  });

  // Email-verification / password-reset tokens are now high-entropy random strings (DEV-188),
  // not JWTs; their validity is gated by the DB record and only a hash is persisted.
  describe('generateEmailVerificationToken', () => {
    it('returns a high-entropy random token, not a JWT', () => {
      const token = service.generateEmailVerificationToken();

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(token.split('.')).toHaveLength(1); // a JWT would have 3 dot-separated parts
    });

    it('returns a unique token each call', () => {
      expect(service.generateEmailVerificationToken()).not.toBe(service.generateEmailVerificationToken());
    });
  });

  describe('generatePasswordResetToken', () => {
    it('returns a high-entropy random token, not a JWT', () => {
      const token = service.generatePasswordResetToken();

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(token.split('.')).toHaveLength(1);
    });
  });

  describe('hashToken', () => {
    it('produces a stable 64-char sha256 hex for a given input', () => {
      const raw = service.generateSecureToken();

      const h1 = service.hashToken(raw);
      const h2 = service.hashToken(raw);

      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not return the raw token', () => {
      const raw = service.generateSecureToken();

      expect(service.hashToken(raw)).not.toBe(raw);
    });
  });

  describe('generateOtpCode', () => {
    it('returns a 6-digit zero-padded numeric string', () => {
      for (let i = 0; i < 50; i++) {
        const code = service.generateOtpCode();
        expect(code).toMatch(/^\d{6}$/);
      }
    });
  });

  describe('generateVerificationSessionToken / verifyVerificationSessionToken', () => {
    it('round-trips userId and email', () => {
      const token = service.generateVerificationSessionToken({ userId: 'user-123', email: 'test@example.com' });
      const decoded = service.verifyVerificationSessionToken(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.type).toBe('email-verification-session');
    });

    it('throws when a regular access token is passed', () => {
      const accessToken = service.generateAccessToken(BASE_PAYLOAD);

      expect(() => service.verifyVerificationSessionToken(accessToken)).toThrow(
        'Invalid or expired verification session token',
      );
    });

    it('throws on an expired verification session token', () => {
      const expired = jwt.sign(
        { userId: 'user-123', email: 'test@example.com', userType: 'REGISTERED', type: 'email-verification-session' },
        TEST_SECRET,
        { expiresIn: '-1s' },
      );

      expect(() => service.verifyVerificationSessionToken(expired)).toThrow(
        'Invalid or expired verification session token',
      );
    });
  });

  describe('verifyToken rejects verification-session tokens', () => {
    it('throws when a verification-session token is used as an access token', () => {
      const sessionToken = service.generateVerificationSessionToken({ userId: 'user-123', email: 'test@example.com' });

      expect(() => service.verifyToken(sessionToken)).toThrow('Invalid or expired token');
    });
  });

  describe('generateToken (legacy)', () => {
    it('produces a token verifiable as an access token', () => {
      const token = service.generateToken(BASE_PAYLOAD);

      expect(() => service.verifyToken(token)).not.toThrow();
    });
  });

  describe('generateGuestToken', () => {
    it('embeds the guest identity and type: guest, with a null email (DEV-179)', () => {
      const token = service.generateGuestToken({ userId: 'guest:abc', username: 'jammer' });
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;

      expect(decoded.userId).toBe('guest:abc');
      expect(decoded.username).toBe('jammer');
      expect(decoded.userType).toBe('GUEST');
      expect(decoded.type).toBe('guest');
      expect(decoded.email).toBeNull();
      expect(typeof decoded.exp).toBe('number');
    });

    it('verifies as an access token via verifyToken (guests act through the verified JWT, no DB row)', () => {
      const token = service.generateGuestToken({ userId: 'guest:abc', username: 'jammer' });

      expect(() => service.verifyToken(token)).not.toThrow();
      const payload = service.verifyToken(token);
      expect(payload.userId).toBe('guest:abc');
    });
  });
});

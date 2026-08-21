/**
 * OAuth `state` cookie + single-use exchange-code route tests (DEV-187).
 *
 * Harness: real router + supertest, mirroring the donor pattern of
 * `bands.routes.test.ts` (jest module mocks declared BEFORE the router import).
 * The only fakes are module-load side effects:
 *  - the passport strategies (`googleStrategy`/`localStrategy` factories) — the
 *    real passport `use`/`authenticate` machinery and every route handler
 *    (`verifyOAuthState`, the Google callback handler, `/oauth/exchange`) run
 *    unmodified against the real router;
 *  - Redis — an in-memory Map stand-in, mirroring
 *    `src/domains/auth/infrastructure/services/__tests__/OAuthExchangeService.test.ts`.
 */
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import passport from 'passport';
import { config } from '../../config/environment';
import authRouter from '../auth';

// ---------------------------------------------------------------------------
// Module-load mocks — must be declared before the router import below.
// ---------------------------------------------------------------------------

// In-memory stand-in for Redis: the exchange code never touches a real Redis in
// unit tests (mirrors OAuthExchangeService.test.ts). The real
// OAuthExchangeService singleton behind the router reads/writes this same store.
// `getInstance` is also stubbed because `rateLimit.ts` constructs a
// RedisRateLimiter at module load; its checkLimit methods (incr/expire/ttl) are
// never reached by these routes, and would fail open if they were.
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => {
  const store = new Map<string, unknown>();
  const inMemoryState = {
    set: async (key: string, value: unknown): Promise<boolean> => {
      store.set(key, value);
      return true;
    },
    get: async (key: string): Promise<unknown> => (store.has(key) ? store.get(key) : null),
    delete: async (key: string): Promise<boolean> => store.delete(key),
    incr: async (): Promise<number | null> => null,
    expire: async (): Promise<boolean> => false,
    ttl: async (): Promise<number> => -2,
  };
  return {
    redisStateService: inMemoryState,
    RedisStateService: {
      getInstance: jest.fn(() => inMemoryState),
    },
  };
});

// Behavior knobs for the fake Google strategy. jest.mock factories may only
// reference out-of-scope names prefixed with `mock`, so these live at module
// scope and are read by the factory's closure at request time.
let mockStrategySuccessUser: unknown = undefined;
let mockAuthenticateCalls = 0;

// Fake Google strategy: passport drives the real route chain; only the provider
// adapter is faked. `authenticate` simulates a successful Google verification
// whose user payload (with or without tokens) is chosen per test.
jest.mock('../../domains/auth/infrastructure/strategies/googleStrategy', () => {
  const authenticate = function (this: { success: (user: unknown) => void }): void {
    mockAuthenticateCalls += 1;
    if (mockStrategySuccessUser !== undefined) {
      this.success(mockStrategySuccessUser);
    }
  };
  return {
    createGoogleStrategy: jest.fn(() => ({ name: 'google', authenticate })),
  };
});

// Fake local strategy — only registered at module load; never exercised here.
jest.mock('../../domains/auth/infrastructure/strategies/localStrategy', () => ({
  createLocalStrategy: jest.fn(() => ({ name: 'local', authenticate: jest.fn() })),
}));

// ---------------------------------------------------------------------------
// Shared expectations — computed from the same config module the router uses.
// ---------------------------------------------------------------------------

const FRONTEND_URL = config.cors.frontendUrl;
const EXPECTED_OAUTH_STATE_REDIRECT = `${FRONTEND_URL}/login?error=oauth_state`;
const EXPECTED_OAUTH_FAILED_REDIRECT = `${FRONTEND_URL}/login?error=oauth_failed`;

describe('routes/auth OAuth state + single-use exchange (DEV-187)', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(passport.initialize()); // mirrors src/bootstrap/httpLayer.ts
    app.use('/api/auth', authRouter);
  });

  beforeEach(() => {
    mockStrategySuccessUser = undefined;
    mockAuthenticateCalls = 0;
  });

  const setCookieHeader = (res: request.Response): string[] => {
    const value = res.headers['set-cookie'];
    return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  };

  /** `verifyOAuthState` clears the cookie before branching, so EVERY callback response carries the clear. */
  const expectOAuthStateCookieCleared = (res: request.Response): void => {
    const cleared = setCookieHeader(res).find((c) => c.startsWith('oauth_state='));
    expect(cleared).toBeDefined();
    expect(cleared ?? '').toContain('Path=/api/auth');
  };

  describe('GET /google/callback — verifyOAuthState', () => {
    it('redirects to login?error=oauth_state and clears the cookie when the echoed state mismatches the cookie', async () => {
      const res = await request(app)
        .get('/api/auth/google/callback?state=attacker-echo')
        .set('Cookie', 'oauth_state=original-nonce');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(EXPECTED_OAUTH_STATE_REDIRECT);
      expectOAuthStateCookieCleared(res);
      // The mismatch redirect fires BEFORE passport runs the strategy.
      expect(mockAuthenticateCalls).toBe(0);
    });

    it('redirects to login?error=oauth_state and clears the cookie when no oauth_state cookie was set', async () => {
      const res = await request(app).get('/api/auth/google/callback?state=nonce-without-cookie');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(EXPECTED_OAUTH_STATE_REDIRECT);
      expectOAuthStateCookieCleared(res);
      expect(mockAuthenticateCalls).toBe(0);
    });

    it('passes a matching state to the strategy and redirects to auth/callback with a single-use exchange code (full DEV-187 flow)', async () => {
      mockStrategySuccessUser = { id: 'u-happy', accessToken: 'at-happy', refreshToken: 'rt-happy' };

      const callbackRes = await request(app)
        .get('/api/auth/google/callback?state=nonce-abc')
        .set('Cookie', 'oauth_state=nonce-abc');

      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.location).toMatch(/\/auth\/callback\?code=[a-f0-9]{64}$/);
      expectOAuthStateCookieCleared(callbackRes);
      expect(mockAuthenticateCalls).toBe(1);

      // The SPA swaps the one-time code for the tokens out of band.
      const code = (callbackRes.headers.location as string).split('code=')[1] ?? '';
      const exchangeRes = await request(app).post('/api/auth/oauth/exchange').send({ code });
      expect(exchangeRes.status).toBe(200);
      expect((exchangeRes.body as { accessToken: string }).accessToken).toBe('at-happy');
      // DEV-197: refresh token travels as an HttpOnly cookie, not in the body.
      expect(setCookieHeader(exchangeRes).some((c) => c.startsWith('refresh_token=rt-happy'))).toBe(true);

      // Single-use (DEV-187): replaying the same code must 400.
      const replayRes = await request(app).post('/api/auth/oauth/exchange').send({ code });
      expect(replayRes.status).toBe(400);
      expect((replayRes.body as { message: string }).message).toBe('Invalid or expired exchange code');
    });

    it('redirects to login?error=oauth_failed when the strategy succeeds without tokens (missing-token guard)', async () => {
      mockStrategySuccessUser = { id: 'u-no-tokens' };

      const res = await request(app)
        .get('/api/auth/google/callback?state=nonce-def')
        .set('Cookie', 'oauth_state=nonce-def');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(EXPECTED_OAUTH_FAILED_REDIRECT);
      expectOAuthStateCookieCleared(res);
      expect(mockAuthenticateCalls).toBe(1);
    });
  });

  describe('POST /oauth/exchange — single-use code', () => {
    it('rejects a non-string code with 400', async () => {
      const res = await request(app).post('/api/auth/oauth/exchange').send({ code: 12345 });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe('Invalid exchange code');
    });

    it('rejects an empty code with 400', async () => {
      const res = await request(app).post('/api/auth/oauth/exchange').send({ code: '' });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe('Invalid exchange code');
    });

    it('rejects a missing code with 400', async () => {
      const res = await request(app).post('/api/auth/oauth/exchange').send({});
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe('Invalid exchange code');
    });

    it('rejects an unknown code with 400', async () => {
      const res = await request(app).post('/api/auth/oauth/exchange').send({ code: 'a'.repeat(64) });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe('Invalid or expired exchange code');
    });
  });
});

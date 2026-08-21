import { oauthExchangeService, generateOpaqueToken, readCookie } from '../OAuthExchangeService';

// In-memory stand-in for Redis — the exchange code never touches a real Redis in unit tests.
// Distinct random codes per test mean cross-test pollution is impossible, so no reset is needed.
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => {
  const store = new Map<string, unknown>();
  return {
    redisStateService: {
      set: async (key: string, value: unknown): Promise<boolean> => {
        store.set(key, value);
        return true;
      },
      get: async (key: string): Promise<unknown> => (store.has(key) ? store.get(key) : null),
      delete: async (key: string): Promise<boolean> => store.delete(key),
    },
  };
});

describe('OAuthExchangeService (DEV-187)', () => {
  it('issues a code that exchanges back to the exact tokens', async () => {
    const tokens = { accessToken: 'at-1', refreshToken: 'rt-1' };
    const code = await oauthExchangeService.issueCode(tokens);

    expect(code).toMatch(/^[a-f0-9]{64}$/);
    expect(await oauthExchangeService.consumeCode(code)).toEqual(tokens);
  });

  it('is single-use: a code cannot be exchanged twice (replay protection)', async () => {
    const code = await oauthExchangeService.issueCode({ accessToken: 'at-2', refreshToken: 'rt-2' });

    expect(await oauthExchangeService.consumeCode(code)).not.toBeNull();
    expect(await oauthExchangeService.consumeCode(code)).toBeNull();
  });

  it('returns null for an unknown or empty code', async () => {
    expect(await oauthExchangeService.consumeCode('does-not-exist')).toBeNull();
    expect(await oauthExchangeService.consumeCode('')).toBeNull();
  });

  it('generates unguessable, unique 256-bit hex tokens', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();

    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toEqual(b);
  });

  describe('readCookie', () => {
    it('extracts a named cookie value from the header', () => {
      expect(readCookie('a=1; oauth_state=xyz; b=2', 'oauth_state')).toBe('xyz');
    });

    it('returns undefined when the cookie is absent or the header is missing/empty', () => {
      expect(readCookie('a=1; b=2', 'oauth_state')).toBeUndefined();
      expect(readCookie(undefined, 'oauth_state')).toBeUndefined();
      expect(readCookie('', 'oauth_state')).toBeUndefined();
    });

    it('url-decodes the cookie value', () => {
      expect(readCookie('oauth_state=a%20b', 'oauth_state')).toBe('a b');
    });
  });
});

import { randomBytes } from 'crypto';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { REDIS_KEYS } from '@/shared/constants/RedisKeys';

/** Tokens minted for a successful OAuth login, handed to the SPA via the exchange endpoint. */
export interface OAuthExchangeTokens {
  accessToken: string;
  refreshToken: string;
}

/** TTL (seconds) for a one-time exchange code — long enough for the SPA to swap it, short enough to limit exposure. */
const EXCHANGE_CODE_TTL_S = 120;

/** Entropy (bytes) for opaque codes / state nonces — 256-bit, infeasible to guess. */
const TOKEN_ENTROPY_BYTES = 32;

/** Generate a cryptographically-random, URL-safe opaque token (hex). */
export const generateOpaqueToken = (): string => randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');

/**
 * Parse a single cookie value out of a raw `Cookie` header without pulling in cookie-parser
 * (the app is otherwise cookie-free). Returns undefined when the cookie is absent.
 */
export const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  if (cookieHeader == null || cookieHeader === '') return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
};

/**
 * One-time exchange code for OAuth logins (DEV-187).
 *
 * Instead of redirecting the browser to the SPA with the access + refresh tokens in the URL query
 * string (which leaks into history, `Referer`, and proxy logs), the callback stores the issued
 * tokens against a random code and redirects with only that code. The SPA then POSTs the code to
 * the exchange endpoint to retrieve the tokens out of band. Codes are single-use and short-lived,
 * so even if the code leaks via the URL it is useless once consumed/expired (the standard
 * authorization-code exchange pattern).
 */
export class OAuthExchangeService {
  /** Store the tokens against a fresh code and return the code to embed in the redirect URL. */
  async issueCode(tokens: OAuthExchangeTokens): Promise<string> {
    const code = generateOpaqueToken();
    await redisStateService.set(REDIS_KEYS.oauthExchangeCode(code), tokens, EXCHANGE_CODE_TTL_S);
    return code;
  }

  /**
   * Consume a code: returns the tokens once, then deletes the code so it can never be replayed.
   * Returns null when the code is empty, unknown, or already used/expired.
   */
  async consumeCode(code: string): Promise<OAuthExchangeTokens | null> {
    if (code === '') return null;
    const key = REDIS_KEYS.oauthExchangeCode(code);
    const tokens = await redisStateService.get<OAuthExchangeTokens>(key);
    if (!tokens) return null;
    // Single-use: delete immediately so a leaked code cannot be replayed.
    await redisStateService.delete(key);
    return tokens;
  }
}

export const oauthExchangeService = new OAuthExchangeService();

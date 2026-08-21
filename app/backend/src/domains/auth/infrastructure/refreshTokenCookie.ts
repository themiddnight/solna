import type { Request, Response } from 'express';
import { config } from '../../../config/environment';
import { parseDurationToMs } from '../../../shared/utils/duration';
import { readCookie } from './services/OAuthExchangeService';

/**
 * Refresh-token cookie (DEV-197).
 *
 * The 30-day refresh token — the durable account-takeover prize — is delivered as an HttpOnly
 * cookie so XSS can't read it (the short-lived access token stays JS-readable for sockets/axios).
 * Scoped to `/api/auth` so it is only sent on auth endpoints, never on every API call. SameSite=Lax
 * is sufficient because the prod FE and API are sub-domains of the same registrable domain
 * (same-site), so the cookie flows on cross-subdomain XHR without needing SameSite=None.
 */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

const REFRESH_COOKIE_MAX_AGE_MS = parseDurationToMs(config.jwt.refreshTokenExpiresIn);

/** Set the refresh-token cookie (HttpOnly, Secure in prod, SameSite=Lax, scoped to /api/auth). */
export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

/** Clear the refresh-token cookie (must match path so the browser actually removes it). */
export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_COOKIE_PATH });
}

/** Read the refresh token from the request cookie, or undefined when absent. */
export function readRefreshTokenCookie(req: Request): string | undefined {
  return readCookie(req.headers.cookie, REFRESH_TOKEN_COOKIE);
}

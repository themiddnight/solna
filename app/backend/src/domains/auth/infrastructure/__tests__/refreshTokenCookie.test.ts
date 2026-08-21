import type { Request, Response } from 'express';
import { createPartialMock } from '@/testing/mocks';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE,
} from '../refreshTokenCookie';

/**
 * DEV-197: the refresh token is delivered as an HttpOnly, Secure (prod), SameSite=Lax cookie
 * scoped to /api/auth — never the JS-readable body.
 */
describe('DEV-197 — refreshTokenCookie', () => {
  it('sets an HttpOnly, SameSite=Lax cookie scoped to /api/auth', () => {
    const cookie = jest.fn();
    const res = createPartialMock<Response>({ cookie });

    setRefreshTokenCookie(res, 'refresh-token-value');

    expect(cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh-token-value',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/api/auth' }),
    );
  });

  it('clears the cookie on the same path so the browser actually removes it', () => {
    const clearCookie = jest.fn();
    const res = createPartialMock<Response>({ clearCookie });

    clearRefreshTokenCookie(res);

    expect(clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
  });

  it('reads the refresh token from the request Cookie header', () => {
    const req = createPartialMock<Request>({
      headers: { cookie: `oauth_state=abc; ${REFRESH_TOKEN_COOKIE}=tok-xyz; other=1` },
    });
    expect(readRefreshTokenCookie(req)).toBe('tok-xyz');
  });

  it('returns undefined when the cookie is absent', () => {
    const req = createPartialMock<Request>({ headers: { cookie: 'other=1' } });
    expect(readRefreshTokenCookie(req)).toBeUndefined();
  });
});

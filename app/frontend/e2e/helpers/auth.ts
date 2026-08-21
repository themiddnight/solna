import type { Page } from '@playwright/test'

/**
 * Read the auth token. Registered access tokens live in localStorage; guest tokens are
 * session-scoped in sessionStorage (2026-07-04). Mirror the app's read routing
 * (see shared/utils/authTokenStorage.ts): prefer localStorage, then sessionStorage.
 * Returns null if not logged in.
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('auth_token') ?? sessionStorage.getItem('auth_token'))
}

/**
 * Decode a JWT's payload (claims) without verifying the signature.
 * Used by tests to assert token type (e.g. guest vs registered — DEV-179).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
}

/**
 * Build Bearer auth headers for direct API calls via page.request.
 */
export async function makeAuthHeaders(page: Page): Promise<Record<string, string>> {
  const token = await getAuthToken(page)
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

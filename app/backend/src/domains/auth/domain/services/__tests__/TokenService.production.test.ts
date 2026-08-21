/**
 * TokenService config-guard tests.
 *
 * The main TokenService.test.ts mocks `@/config/environment` with a present JWT secret, so
 * the production guard — a missing secret must throw in production instead of falling back
 * to the dev secret — needs its own config mock (sibling-file pattern:
 * UserRepository.revokeAllUserRefreshTokens.test.ts).
 *
 * TokenService.ts also exports a module-level `tokenService` singleton, so under the
 * production mock the guard fires at module evaluation: the import itself rejects.
 * isolateModulesAsync gives the import a fresh module registry, making the rejection
 * observable here instead of failing the whole suite at load.
 */
jest.mock('@/config/environment', () => ({
  config: {
    nodeEnv: 'production',
    logging: { level: 'error' },
    jwt: {
      secret: '',
      accessTokenExpiresIn: '1h',
      refreshTokenExpiresIn: '30d',
      guestTokenExpiresIn: '12h',
      emailVerificationExpiresHours: 24,
      passwordResetExpiresHours: 1,
    },
  },
}));

describe('TokenService production config guard', () => {
  it('throws when JWT_SECRET is missing in production — no silent fallback secret', async () => {
    // A hardcoded dev fallback in production would mint tokens anyone could forge.
    const importModule = (): Promise<void> => {
      return jest.isolateModulesAsync(() => import('../TokenService').then(() => undefined));
    };
    await expect(importModule()).rejects.toThrow('JWT_SECRET is required in production');
  });
});

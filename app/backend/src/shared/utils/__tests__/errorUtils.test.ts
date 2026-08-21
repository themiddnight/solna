/**
 * errorUtils — documents the client-facing error contract (DEV-192) and the
 * recoverable-connection-code allow-list.
 *
 * DEV-192: clientErrorDetail must never leak internal / Prisma error messages to
 * clients in production; outside production it returns the real message to aid
 * debugging. config.nodeEnv is toggled directly (same object the module reads).
 */
import { config } from '@/config/environment';
import { clientErrorDetail, isRecoverableConnectionError } from '../errorUtils';

/**
 * config is declared `as const`, so nodeEnv is readonly at the type level — but the
 * runtime object is a plain mutable object, and errorUtils reads the very same
 * instance. Casting to a mutable view lets a single test file cover both production
 * and non-production behavior without module mocking.
 */
const setNodeEnv = (env: 'development' | 'test' | 'production'): void => {
  (config as { nodeEnv: string }).nodeEnv = env;
};

describe('clientErrorDetail', () => {
  afterEach(() => {
    setNodeEnv('test');
  });

  it('returns the real message outside production (debugging aid)', () => {
    setNodeEnv('development');
    expect(clientErrorDetail(new Error('prisma: connection pool exhausted'))).toBe(
      'prisma: connection pool exhausted'
    );
  });

  it('returns the raw string for a non-Error value outside production', () => {
    setNodeEnv('development');
    expect(clientErrorDetail('some failure detail')).toBe('some failure detail');
  });

  it('suppresses internal error messages in production (DEV-192 — no leaks)', () => {
    setNodeEnv('production');
    expect(clientErrorDetail(new Error('prisma: P2002 unique constraint on users.email'))).toBeUndefined();
    expect(clientErrorDetail('internal detail: /etc/secrets')).toBeUndefined();
  });
});

describe('isRecoverableConnectionError', () => {
  const errorWithCode = (code: string): Error => {
    const error = new Error(`connection failed (${code})`);
    (error as NodeJS.ErrnoException).code = code;
    return error;
  };

  it('matches every allow-listed code', () => {
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND']) {
      expect(isRecoverableConnectionError(errorWithCode(code))).toBe(true);
    }
  });

  it('rejects other error codes', () => {
    for (const code of ['ENOENT', 'EACCES', 'EISDIR', 'ECONNABORTED', 'EADDRINUSE']) {
      expect(isRecoverableConnectionError(errorWithCode(code))).toBe(false);
    }
  });

  it('rejects Errors without a code', () => {
    expect(isRecoverableConnectionError(new Error('no code attached'))).toBe(false);
  });

  it('rejects non-Error values even when they look like an errno error', () => {
    expect(isRecoverableConnectionError('ECONNRESET')).toBe(false);
    expect(isRecoverableConnectionError({ code: 'ECONNRESET' })).toBe(false);
    expect(isRecoverableConnectionError(null)).toBe(false);
    expect(isRecoverableConnectionError(undefined)).toBe(false);
  });
});

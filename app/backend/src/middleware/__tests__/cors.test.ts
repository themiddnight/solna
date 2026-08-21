import { describe, it, expect, jest } from '@jest/globals';

// The production fail-fast guard in src/middleware/cors.ts reads config at import
// time, so each case must re-import the module with fresh env stubs
// (jest.resetModules + dynamic import — same pattern as SystemPressureService).
import type { corsOptions } from '../cors';

type CorsModule = { corsOptions: typeof corsOptions };

interface OriginResult {
  error: Error | null;
  allowed: boolean;
}

/** Prod env that passes environment.ts's own fail-fast validations. */
const prodEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://test',
  JWT_SECRET: '0123456789abcdef0123456789abcdef', // >= 32 chars
  AI_ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef', // >= 32 chars
  PERFORMANCE_API_KEY: 'test-key',
  ...extra,
});

function withEnv(vars: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function loadCorsModule(vars: Record<string, string | undefined>): Promise<CorsModule> {
  const restore = withEnv(vars);
  jest.resetModules();
  try {
    return await import('../cors');
  } finally {
    // config is a static snapshot read at import — safe to restore env now.
    restore();
  }
}

function invokeOrigin(mod: CorsModule, origin: string | undefined): OriginResult {
  const result: OriginResult = { error: null, allowed: false };
  mod.corsOptions.origin(origin, (err, allow) => {
    result.error = err;
    result.allowed = allow === true;
  });
  return result;
}

describe('cors middleware — production fail-fast guard', () => {
  it('throws at import in production when CORS_ORIGIN="*" with CORS_CREDENTIALS=true', async () => {
    await expect(
      loadCorsModule(prodEnv({ CORS_ORIGIN: '*', CORS_CREDENTIALS: 'true' })),
    ).rejects.toThrow('Insecure CORS configuration');
  });

  it('does not throw in production for wildcard without credentials', async () => {
    const mod = await loadCorsModule(prodEnv({ CORS_ORIGIN: '*', CORS_CREDENTIALS: 'false' }));
    expect(mod.corsOptions.credentials).toBe(false);
  });

  it('does not throw in production for an explicit allow-list with credentials', async () => {
    const mod = await loadCorsModule(
      prodEnv({ CORS_ORIGIN: 'https://app.example.com', CORS_CREDENTIALS: 'true' }),
    );
    expect(mod.corsOptions.credentials).toBe(true);
  });
});

describe('cors origin callback', () => {
  it('allows a dev frontend origin in development (union with dev fallback origins)', async () => {
    const mod = await loadCorsModule({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://test',
      CORS_ORIGIN: 'https://app.example.com',
      CORS_CREDENTIALS: 'true',
    });
    const result = invokeOrigin(mod, 'http://localhost:5173');
    expect(result.error).toBeNull();
    expect(result.allowed).toBe(true);
  });

  it('allows requests without an Origin header (non-browser clients)', async () => {
    const mod = await loadCorsModule({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://test',
      CORS_ORIGIN: 'https://app.example.com',
      CORS_CREDENTIALS: 'true',
    });
    const result = invokeOrigin(mod, undefined);
    expect(result.error).toBeNull();
    expect(result.allowed).toBe(true);
  });

  it('denies an origin outside the union in development', async () => {
    const mod = await loadCorsModule({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://test',
      CORS_ORIGIN: 'https://app.example.com',
      CORS_CREDENTIALS: 'true',
    });
    const result = invokeOrigin(mod, 'http://evil.example.com');
    expect(result.error?.message).toBe('Not allowed by CORS');
    expect(result.allowed).toBe(false);
  });

  it('allows a listed origin in production', async () => {
    const mod = await loadCorsModule(
      prodEnv({ CORS_ORIGIN: 'https://app.example.com', CORS_CREDENTIALS: 'true' }),
    );
    const result = invokeOrigin(mod, 'https://app.example.com');
    expect(result.error).toBeNull();
    expect(result.allowed).toBe(true);
  });

  it('denies an unknown origin in production', async () => {
    const mod = await loadCorsModule(
      prodEnv({ CORS_ORIGIN: 'https://app.example.com', CORS_CREDENTIALS: 'true' }),
    );
    const result = invokeOrigin(mod, 'https://evil.example.com');
    expect(result.error?.message).toBe('Not allowed by CORS');
    expect(result.allowed).toBe(false);
  });

  it('denies dev fallback origins in production (no dev union in prod)', async () => {
    const mod = await loadCorsModule(
      prodEnv({ CORS_ORIGIN: 'https://app.example.com', CORS_CREDENTIALS: 'true' }),
    );
    const result = invokeOrigin(mod, 'http://localhost:5173');
    expect(result.error?.message).toBe('Not allowed by CORS');
    expect(result.allowed).toBe(false);
  });
});

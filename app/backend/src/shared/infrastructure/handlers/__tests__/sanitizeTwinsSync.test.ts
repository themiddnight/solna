import { sanitizeEventData } from '../sanitizeEventData';

// The sanitize implementation used to be duplicated verbatim in two handlers
// (campaign Task 4 ruling). Both now delegate to the shared module — this
// suite pins the module's contract so the handlers' logging stays redacted.
// Regression coverage for the two drift-triggering patches (904b9976, 2e548a49)
// lives in BaseSocketHandler.test.ts `describe('BaseSocketHandler — sanitizeEventData')`.

describe('sanitizeEventData — shared sanitizer', () => {
  it('redacts sensitive keys (case-insensitive substring match)', () => {
    // `api_key` uses bracket notation to dodge the naming-convention lint —
    // separator-stripped matching is exactly what it exercises.
    const result = sanitizeEventData({
      password: 'p',
      newAccessToken: 'jwt-value', // compound key — substring match must catch it
      ['api_key']: 'k', // separator-stripped matching
      Author: 'a', // case-insensitive
      note: 'keep',
    });
    expect(result).toEqual({
      password: '[REDACTED]',
      newAccessToken: '[REDACTED]',
      ['api_key']: '[REDACTED]',
      Author: '[REDACTED]',
      note: 'keep',
    });
  });

  it('redacts the extended key set (jwt, credentials, passphrase, pwd, cookie)', () => {
    const result = sanitizeEventData({
      jwt: 'x',
      credentials: 'x',
      passphrase: 'x',
      pwd: 'x',
      cookie: 'x',
      safeField: 'x',
    });
    expect(result).toEqual({
      jwt: '[REDACTED]',
      credentials: '[REDACTED]',
      passphrase: '[REDACTED]',
      pwd: '[REDACTED]',
      cookie: '[REDACTED]',
      safeField: 'x',
    });
  });

  it('walks nested objects and arrays of objects', () => {
    const result = sanitizeEventData({
      user: { name: 'n', token: 't' },
      history: [{ value: 'v' }, { secret: 's' }],
    });
    expect(result).toEqual({
      user: { name: 'n', token: '[REDACTED]' },
      history: [{ value: 'v' }, { secret: '[REDACTED]' }],
    });
  });

  it('redacts at the depth cap instead of passing nested objects through', () => {
    const deep: Record<string, unknown> = { level0: { token: 'buried' } };
    let cursor = deep;
    for (let i = 1; i <= 10; i++) {
      const next: Record<string, unknown> = { level: `deep-${i}` };
      cursor.child = next;
      cursor = next;
    }
    const result = sanitizeEventData(deep);
    const walk = (node: Record<string, unknown>, depth: number): unknown => {
      if (node.child === undefined) return node;
      return walk(node.child as Record<string, unknown>, depth + 1);
    };
    const boundary = walk(result as Record<string, unknown>, 0);
    expect(boundary).toBe('[REDACTED]');
  });

  it('writes a __proto__ key as an own data property (no prototype pollution)', () => {
    const result = sanitizeEventData(JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
    expect(result.safe).toBe(1);
  });

  it('passes through non-objects unchanged', () => {
    expect(sanitizeEventData(null)).toBeNull();
    expect(sanitizeEventData(undefined)).toBeUndefined();
    expect(sanitizeEventData('plain string')).toBe('plain string');
    expect(sanitizeEventData(42)).toBe(42);
    expect(sanitizeEventData({})).toEqual({});
  });
});

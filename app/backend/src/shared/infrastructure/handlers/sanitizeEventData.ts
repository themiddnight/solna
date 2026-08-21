/**
 * Event-payload sanitizer for error logs.
 *
 * Single source of truth for redaction — BaseSocketHandler and
 * NamespaceEventHandlers both delegate here. Previously the block was
 * duplicated verbatim in both handlers; the two copies were patched in
 * lockstep twice (sanitize fixes 904b9976, 2e548a49) before extraction.
 */

/** Keys (matched case-insensitively) whose values are redacted before logging. */
const SENSITIVE_KEYS: readonly string[] = [
  'password',
  'token',
  'secret',
  'key',
  'auth',
  'apikey',
  'jwt',
  'credentials',
  'passphrase',
  'pwd',
  'cookie',
];

/** Cheap recursion guard — JSON event data is acyclic; nothing legitimate nests deeper. */
const MAX_SANITIZE_DEPTH = 10;

const isSensitiveKey = (key: string): boolean => {
  const stripped = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Substring match: compound keys like newAccessToken must not leak a JWT
  // into error logs. Over-redaction (e.g. `author` contains `auth`) is an
  // accepted log-only trade-off (controller ruling 1).
  return SENSITIVE_KEYS.some((sensitive) => stripped.includes(sensitive));
};

const sanitizeNode = (value: unknown, depth: number): unknown => {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    // Never pass deeply nested objects through unredacted — an adversarial
    // payload could bury a secret past the cap. Redact at the boundary.
    return '[REDACTED]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNode(item, depth + 1));
  }
  // typeof/Array.isArray narrowed `value` to a plain object; JSON event
  // payloads carry only own string keys, so the Record view is safe.
  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    // defineProperty (not `sanitized[key] = …`) so a `__proto__` key becomes
    // an own data property instead of invoking the prototype setter.
    Object.defineProperty(sanitized, key, {
      value: isSensitiveKey(key) ? '[REDACTED]' : sanitizeNode(source[key], depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return sanitized;
};

/** Sanitize event data for logging (remove sensitive information). */
export function sanitizeEventData(data: unknown): unknown {
  return sanitizeNode(data, 0);
}

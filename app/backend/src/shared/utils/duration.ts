/**
 * Parse a JWT-style duration string ("30d", "1h", "15m", "45s") to milliseconds.
 *
 * Mirrors the subset of the `ms`/`jsonwebtoken` duration grammar this project uses for
 * token/cookie lifetimes (single integer + unit). Unparseable input falls back to `fallbackMs`
 * (default 30 days) so a misconfigured env var can never produce a NaN/zero lifetime.
 */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function parseDurationToMs(value: string, fallbackMs: number = THIRTY_DAYS_MS): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (match === null) {
    return fallbackMs;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
  return fallbackMs;
}

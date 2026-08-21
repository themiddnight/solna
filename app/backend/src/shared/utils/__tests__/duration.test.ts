import { parseDurationToMs } from '../duration';

describe('parseDurationToMs', () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('parses seconds', () => {
    expect(parseDurationToMs('45s')).toBe(45 * SECOND);
  });

  it('parses minutes', () => {
    expect(parseDurationToMs('15m')).toBe(15 * MINUTE);
  });

  it('parses hours', () => {
    expect(parseDurationToMs('1h')).toBe(HOUR);
  });

  it('parses days', () => {
    expect(parseDurationToMs('30d')).toBe(30 * DAY);
  });

  it('trims surrounding whitespace', () => {
    expect(parseDurationToMs('  7d  ')).toBe(7 * DAY);
  });

  it('falls back to 30 days for an unparseable value', () => {
    expect(parseDurationToMs('not-a-duration')).toBe(30 * DAY);
  });

  it('uses a caller-supplied fallback when provided', () => {
    expect(parseDurationToMs('garbage', HOUR)).toBe(HOUR);
  });
});

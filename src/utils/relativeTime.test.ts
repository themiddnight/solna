import { describe, expect, test } from 'bun:test';
import { formatRelativeTime } from './relativeTime';

const NOW = 1_700_000_000_000;
const s = 1000, m = 60 * s, h = 60 * m, d = 24 * h;

describe('formatRelativeTime', () => {
  test('buckets', () => {
    expect(formatRelativeTime(NOW - 5 * s, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 1 * m, NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(NOW - 2 * m, NOW)).toBe('2 minutes ago');
    expect(formatRelativeTime(NOW - 3 * h, NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(NOW - 30 * h, NOW)).toBe('yesterday');
    expect(formatRelativeTime(NOW - 5 * d, NOW)).toBe('5 days ago');
  });
  test('older than 30 days falls back to a date', () => {
    expect(formatRelativeTime(NOW - 45 * d, NOW)).toBe(new Date(NOW - 45 * d).toLocaleDateString());
  });
  test('a timestamp in the future reads as just now', () => {
    expect(formatRelativeTime(NOW + 5 * m, NOW)).toBe('just now');
  });
});

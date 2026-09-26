import { describe, expect, test } from 'bun:test';
import { settledMenuOpen } from './usePopupMenu';

describe('settledMenuOpen', () => {
  test('an enabled menu is open exactly when it was opened', () => {
    expect(settledMenuOpen(true, false)).toBe(true);
    expect(settledMenuOpen(false, false)).toBe(false);
  });

  // R341: arming a recording locks the target chip. A menu open at that
  // moment shuts, and because usePopupMenu writes this back into its state
  // rather than masking it, unlocking never springs the menu open again.
  test('a disabled menu is shut whether or not it was open', () => {
    expect(settledMenuOpen(true, true)).toBe(false);
    expect(settledMenuOpen(false, true)).toBe(false);
  });
});

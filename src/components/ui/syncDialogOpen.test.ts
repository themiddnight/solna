import { describe, expect, test } from 'bun:test';
import { syncDialogOpen, type DialogHandle } from './syncDialogOpen';

/**
 * There is no DOM in this runner (.claude/rules/testing.md), so the reconciler
 * is tested against the three-member shape it actually uses. A real
 * HTMLDialogElement satisfies the same shape.
 */
function stubDialog(open: boolean): DialogHandle & { calls: string[] } {
  return {
    open,
    calls: [] as string[],
    showModal() {
      this.open = true;
      this.calls.push('showModal');
    },
    close() {
      this.open = false;
      this.calls.push('close');
    },
  };
}

describe('syncDialogOpen', () => {
  test('opens a closed dialog modally', () => {
    const el = stubDialog(false);
    syncDialogOpen(el, true);
    expect(el.calls).toEqual(['showModal']);
    expect(el.open).toBe(true);
  });

  test('closes an open dialog', () => {
    const el = stubDialog(true);
    syncDialogOpen(el, false);
    expect(el.calls).toEqual(['close']);
    expect(el.open).toBe(false);
  });

  /**
   * The effect re-runs on every parent render. showModal() on an already-open
   * dialog throws InvalidStateError, so the no-ops are the point of the helper,
   * not a nicety.
   */
  test('is a no-op when the dialog already matches the prop', () => {
    const alreadyOpen = stubDialog(true);
    syncDialogOpen(alreadyOpen, true);
    expect(alreadyOpen.calls).toEqual([]);

    const alreadyClosed = stubDialog(false);
    syncDialogOpen(alreadyClosed, false);
    expect(alreadyClosed.calls).toEqual([]);
  });

  test('tolerates a ref that has not attached yet', () => {
    expect(() => syncDialogOpen(null, true)).not.toThrow();
  });
});

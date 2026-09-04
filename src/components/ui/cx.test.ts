import { describe, expect, test } from 'bun:test';
import { cx } from './cx';

describe('cx', () => {
  test('drops falsy fragments', () => {
    expect(cx('btn', undefined, false, null, 'btn-xs')).toBe('btn btn-xs');
  });

  /**
   * The primitives interpolate optional props into a class string. Without the
   * collapse, an absent `tint` leaves a double space in the rendered attribute
   * and every renderToString assertion has to know about it.
   */
  test('collapses the whitespace an absent fragment leaves behind', () => {
    expect(cx('btn  btn-square', '   ', 'btn-ghost')).toBe('btn btn-square btn-ghost');
  });

  test('is the empty string when every fragment is falsy', () => {
    expect(cx(undefined, '', false)).toBe('');
  });
});

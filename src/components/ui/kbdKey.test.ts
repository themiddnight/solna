import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * The keycaps are a desktop affordance: a QWERTY shortcut means nothing on a
 * touch screen or a narrow window, and an iPad in landscape is wide enough for
 * `lg` but has no fine pointer. So the one `kbd-key` utility shows the chip
 * only on a wide screen with a hovering, fine pointer, and hides it otherwise.
 */
describe('the kbd-key utility', () => {
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  const start = css.indexOf('@utility kbd-key {');
  const block = css.slice(start, css.indexOf('\n}\n', start));

  test('is hidden by default', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/^\s*display:\s*none;/m);
  });

  test('shows only from lg with a hovering, fine pointer', () => {
    expect(block).toContain(
      '@media (width >= theme(--breakpoint-lg)) and (hover: hover) and (pointer: fine)',
    );
    const media = block.slice(block.indexOf('@media'));
    expect(media).toContain('display: inline-flex;');
  });
});

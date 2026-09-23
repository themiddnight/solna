import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { VIBES } from '@/data/vibes';
import { VibePickerModal } from './VibePickerModal';
import { VibesButton } from './VibesButton';

// Rendered from the store's initial state; nothing here is seeded, so the R257
// trap (testing.md) does not apply. Effects do not run under renderToString,
// so nothing is previewed and the lazy module is never loaded.
describe('the vibe picker (R334)', () => {
  const html = renderToString(<VibePickerModal open={false} onClose={() => {}} />);

  test('one card per vibe, none pressed, no dice before a preview', () => {
    for (const vibe of VIBES) expect(html).toContain(`id="btn-vibes-card-${vibe.id}"`);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain('id="btn-vibes-reroll"');
  });

  test('Use and Play are disabled until something is previewed; Cancel never is', () => {
    expect(html).toMatch(/id="btn-vibes-use"[^>]*disabled=""/);
    expect(html).toMatch(/id="btn-vibes-play"[^>]*disabled=""/);
    expect(html).not.toMatch(/id="btn-vibes-cancel"[^>]*disabled=""/);
    expect(html).toContain('Pick a vibe to hear it on this loop.');
  });

  test('the grid scrolls between a pinned header and a pinned footer', () => {
    expect(html).toContain('flex flex-col overflow-hidden');
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(html).toContain('shrink-0');
  });

  test('the Header button opens a dialog and brings the picker with it', () => {
    const bar = renderToString(<VibesButton />);
    expect(bar).toContain('id="btn-vibes"');
    expect(bar).toContain('aria-haspopup="dialog"');
    expect(bar).toContain('<dialog class="modal"');
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { VIBES } from '@/data/vibes';
import { useAppStore } from '@/store/store';
import { VibeFooter, VibePickerModal } from './VibePickerModal';
import { VibesButton } from './VibesButton';

// Rendered from the store's initial state; nothing here is seeded, so the R257
// trap (testing.md) does not apply. Effects do not run under renderToString,
// so nothing is previewed and the lazy module is never loaded.
describe('the vibe picker (R334)', () => {
  const html = renderToString(<VibePickerModal open={false} onClose={() => {}} />);

  test('one row per vibe, none pressed, each with its own dice beside the card', () => {
    for (const vibe of VIBES) {
      const card = html.indexOf(`id="btn-vibes-card-${vibe.id}"`);
      expect(card).toBeGreaterThan(-1);
      if (vibe.random) expect(html.indexOf(`id="btn-vibes-reroll-${vibe.id}"`)).toBeGreaterThan(card);
      else expect(html).not.toContain(`id="btn-vibes-reroll-${vibe.id}"`);
    }
    expect(html).not.toContain('aria-pressed="true"');
  });

  test('the vibes stack as a list, one per row', () => {
    expect(html).toContain('<ul class="flex flex-col gap-2">');
    expect(html).not.toContain('grid-cols');
  });

  test('Use and Play are disabled until something is previewed; Cancel never is', () => {
    expect(html).toMatch(/id="btn-vibes-use"[^>]*disabled=""/);
    expect(html).toMatch(/id="btn-vibes-play"[^>]*disabled=""/);
    expect(html).not.toMatch(/id="btn-vibes-cancel"[^>]*disabled=""/);
    expect(html).toContain('Pick a vibe to hear it on this loop.');
  });

  test('the list scrolls between a pinned header and a pinned footer', () => {
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

/** The card's markup, from its opening tag to the end of its button. */
function cardHtml(html: string, vibeId: string): string {
  const start = html.indexOf(`id="btn-vibes-card-${vibeId}"`);
  return html.slice(start, html.indexOf('</button>', start));
}

// selectedVibeId is read through useLiveStore, so a setState before the render
// DOES reach it (the R257 trap does not bite; testing.md).
describe('the current-vibe mark', () => {
  const initial = useAppStore.getState().selectedVibeId;
  afterEach(() => {
    useAppStore.setState({ selectedVibeId: initial });
  });

  test('marks only the card of the vibe the loop was loaded from, without pressing it', () => {
    const [other, current] = VIBES;
    useAppStore.setState({ selectedVibeId: current.id });
    const html = renderToString(<VibePickerModal open={false} onClose={() => {}} />);
    expect(cardHtml(html, current.id)).toContain('id="vibes-current-mark"');
    expect(cardHtml(html, current.id)).toContain('>Current<');
    expect(cardHtml(html, current.id)).toContain('aria-pressed="false"');
    expect(cardHtml(html, other.id)).not.toContain('Current');
  });

  test('no vibe loaded: no card is marked', () => {
    useAppStore.setState({ selectedVibeId: null });
    const html = renderToString(<VibePickerModal open={false} onClose={() => {}} />);
    expect(html).not.toContain('id="vibes-current-mark"');
  });
});

describe('the footer under a preview', () => {
  const [vibe] = VIBES;
  const footer = (reroll?: { headline: string }) => renderToString(
    <VibeFooter previewed={{ base: vibe, spec: vibe, detail: 'ii – V – I · Push · Legato · drums: Kit', reroll }}
      playing={false} onTogglePlay={() => {}} onCancel={() => {}} onUse={() => {}} />,
  );

  test('a pick shows the name line and its detail at once, with no dice mark', () => {
    const html = footer();
    expect(html).toContain('id="vibes-summary"');
    expect(html).toContain('id="vibes-detail"');
    expect(html).toContain('drums: Kit');
    expect(html).not.toContain('vibes-rerolled-mark');
  });

  test('a reroll marks the name line with the dice and never repeats the name', () => {
    const html = footer({ headline: `🎲 ${vibe.name}` });
    expect(html).toContain('id="vibes-rerolled-mark"');
    expect(html.split(vibe.name)).toHaveLength(2);
  });
});

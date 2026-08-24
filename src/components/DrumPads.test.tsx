import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { DrumPads, DEFAULT_PADS } from './DrumPads';

describe('DrumPads', () => {
  test('renders the pad grid without a title or kit selector', () => {
    const html = renderToString(<DrumPads />);
    // The title and kit selector moved to the Step Matrix header card.
    expect(html.includes('Drum Pads')).toBe(false);
    expect(html.includes('<select')).toBe(false);
    // The pad grid itself survives the header removal.
    expect(html).toContain('Kick Drum');
    expect(html).toContain('Crash Cymbal');
    expect(html).toContain('btn-pad-kick');
  });
});

describe('DrumPads theming and key-binding contract', () => {
  test('exports DEFAULT_PADS under the name check-key-bindings.ts imports', () => {
    expect(Array.isArray(DEFAULT_PADS)).toBe(true);
    expect(DEFAULT_PADS).toHaveLength(8);
  });

  test('shortcuts are untouched by the colour migration', () => {
    expect(DEFAULT_PADS.map((p) => p.shortcut)).toEqual([
      'KeyZ',
      'KeyX',
      'KeyC',
      'KeyV',
      'KeyM',
      'Comma',
      'Period',
      'Slash',
    ]);
  });

  test('every pad colour is a semantic ramp with a matching content token', () => {
    const allowed = [
      'from-primary to-primary/60 text-primary-content',
      'from-secondary to-secondary/60 text-secondary-content',
      'from-accent to-accent/60 text-accent-content',
    ];
    for (const pad of DEFAULT_PADS) {
      expect(allowed).toContain(pad.color);
    }
  });

  test('the pad grid renders on daisyUI components and semantic tokens', () => {
    const html = renderToString(<DrumPads />);

    expect(html).toContain('card bg-base-100 border border-base-300');
    expect(html).toContain('card-body');
    expect(html).toContain('kbd-key');
    expect(html).toContain('range range-xs range-primary');
    expect(html).toContain('text-base-content/50');
    // `ring-primary` only renders when a pad is active (activePadId is null
    // on a static server render), so it cannot appear here; the source
    // string is asserted directly below via the absence of `ring-white`.

    expect(html).not.toContain('#12152A');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('ring-white');
    expect(html).not.toContain('bg-black/30');
    expect(html).not.toContain('slate-');
  });
});

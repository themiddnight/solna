import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { DrumPadGrid, DEFAULT_PADS } from './DrumPadGrid';

const noop = () => {};
const props = {
  pads: DEFAULT_PADS,
  activePadId: null,
  onTriggerPad: noop,
  onPadVolumeChange: noop,
};

describe('DEFAULT_PADS', () => {
  test('exports exactly the eight pads check-key-bindings.ts needs', () => {
    expect(Array.isArray(DEFAULT_PADS)).toBe(true);
    expect(DEFAULT_PADS).toHaveLength(8);
  });

  test('shortcuts are untouched by the colour migration', () => {
    expect(DEFAULT_PADS.map((p) => p.shortcut)).toEqual([
      'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyM', 'Comma', 'Period', 'Slash',
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
});

describe('DrumPadGrid', () => {
  test('renders the pad grid on daisyUI components and semantic tokens', () => {
    const html = renderToString(<DrumPadGrid {...props} />);
    expect(html).toContain('Kick Drum');
    expect(html).toContain('Crash Cymbal');
    expect(html).toContain('btn-pad-kick');
    expect(html).toContain('kbd-key');
    expect(html).toContain('range range-xs range-primary');
    expect(html).toContain('text-base-content/50');
    expect(html).not.toContain('#12152A');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('ring-white');
    expect(html).not.toContain('bg-black/30');
    expect(html).not.toContain('slate-');
  });

  test('lights the active pad', () => {
    const html = renderToString(<DrumPadGrid {...props} activePadId="kick" />);
    expect(html).toContain('ring-4 ring-primary');
  });
});

import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { DrumPadGrid, DEFAULT_PADS, PADLESS_VOICES } from './DrumPadGrid';
import { DRUM_TYPES } from '@/data/drumKits';

const noop = () => {};
const props = {
  pads: DEFAULT_PADS,
  activePadId: null,
  onTriggerPad: noop,
  onPadVolumeChange: noop,
};

describe('DEFAULT_PADS', () => {
  test('exports exactly the ten pads check-key-bindings.ts needs', () => {
    expect(Array.isArray(DEFAULT_PADS)).toBe(true);
    expect(DEFAULT_PADS).toHaveLength(10);
  });

  test('shortcuts lay the pads out as two rows of five on the QWERTY bottom row', () => {
    expect(DEFAULT_PADS.map((p) => p.shortcut)).toEqual([
      'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB',
      'KeyN', 'KeyM', 'Comma', 'Period', 'Slash',
    ]);
  });

  test('every pad is coloured from the drum namespace, one token per voice', () => {
    for (const pad of DEFAULT_PADS) {
      expect(pad.color, `${pad.id} colour`).toBe(
        `from-drum-${pad.note} to-drum-${pad.note}/60 text-drum-${pad.note}-content`,
      );
    }
  });

  test('there is one pad per drum voice, in the canonical order', () => {
    expect(DEFAULT_PADS.map((p) => p.note)).toEqual(
      DRUM_TYPES.filter((t) => !(PADLESS_VOICES as readonly string[]).includes(t)),
    );
  });

  test('DEFAULT_PADS unioned with PADLESS_VOICES equals DRUM_TYPES', () => {
    // bell is deliberately dropped from the pad grid (ten pads fit one
    // physical keyboard row, eleven did not) — this must stay a visible,
    // asserted omission rather than a silently-relaxed subset check.
    const combined = new Set([...DEFAULT_PADS.map((p) => p.note), ...PADLESS_VOICES]);
    expect(combined.size).toBe(DRUM_TYPES.length);
    expect(DRUM_TYPES.every((t) => combined.has(t))).toBe(true);
  });

  test('the two tom pads name the voice they actually play', () => {
    // The High Tom pad used to play `tom` with a dead `pitch: 4` — the engine
    // never read it, so the two tom pads were the same drum at the same pitch.
    const hitom = DEFAULT_PADS.find((p) => p.id === 'hitom')!;
    expect(hitom.note).toBe('hitom');
    expect(hitom.pitch).toBe(0);
    expect(DEFAULT_PADS.find((p) => p.id === 'lowtom')!.note).toBe('lowtom');
  });

  test('shortcuts are free of the synth map and of each other, and KeyQ is freed', () => {
    const codes = DEFAULT_PADS.map((p) => p.shortcut);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('KeyB');
    expect(codes).toContain('KeyN');
    expect(codes).not.toContain('KeyQ');
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

import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChordPresetLibrary, isProgressionAvailable } from './ChordPresetLibrary';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import { CHORD_PROGRESSIONS, progressionById } from '../audio/data/chordProgressions';
import { SCALES } from '../utils/musicTheory';

const noop = () => {};

const html = renderToString(
  <ChordPresetLibrary
    isOpen
    onClose={noop}
    currentChords={[
      { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
    ]}
    scaleRoot="C"
    scaleType="Major"
    autoReharmonize
    synthParams={INITIAL_SYNTH_PARAMS}
    onApplyChords={noop}
  />
);

describe('ChordPresetLibrary theming', () => {
  test('template and custom cards are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-base-200 border border-base-300');
    expect(html).toContain('hover:border-module-chord/50');
    // The custom card's hover:border-secondary/50 cannot be asserted here:
    // under renderToString, zustand's useStore takes getInitialState() as the
    // React server snapshot, which is frozen at store creation, and the custom
    // card renders only from customChordProgressions, which starts empty in
    // tests. The guard's source-level scan still enforces its tokens.
  });

  test('tags are daisyUI badges with a valid padding step', () => {
    expect(html).toContain('badge badge-sm');
    expect(html).not.toContain('py-0.2');
  });

  test('card actions are daisyUI buttons', () => {
    expect(html).toContain('btn btn-xs btn-ghost');
    expect(html).toContain('[--btn-color:var(--color-module-chord)]');
    // hover:btn-error (the custom-card delete button) is unreachable under
    // renderToString for the same frozen-server-snapshot reason as above.
  });

  test('the footer sits on base tokens', () => {
    expect(html).toContain('border-t border-base-300 bg-base-200');
    expect(html).toContain('btn btn-sm btn-ghost');
  });

  test('no legacy hex or palette utilities survive', () => {
    for (const s of [
      '#0B0D19',
      '#252B48',
      '#2D355A',
      '#171B36',
      '#20264A',
      '#1C213E',
      '#0E1022',
      '#1A1F3B',
      'indigo-',
      'purple-',
      'red-',
      'slate-',
      'text-white',
    ]) {
      expect(html).not.toContain(s);
    }
  });
});

describe('isProgressionAvailable', () => {
  const sevenNote = progressionById('pop-i-v-vi-iv')!;
  const fiveNote = progressionById('zen-bamboo-vamp')!;

  test('a seven-degree progression is hidden in every short scale', () => {
    for (const scaleType of ['Hirajoshi', 'Major Pentatonic', 'Minor Pentatonic', 'Blues']) {
      expect(isProgressionAvailable(sevenNote, scaleType)).toBe(false);
    }
  });

  test('a seven-degree progression is available in every seven-degree scale', () => {
    for (const [scaleType, scale] of Object.entries(SCALES)) {
      if (scale.intervals.length !== 7) continue;
      expect(isProgressionAvailable(sevenNote, scaleType)).toBe(true);
    }
  });

  test('a five-degree progression is available everywhere', () => {
    for (const scaleType of Object.keys(SCALES)) {
      expect(isProgressionAvailable(fiveNote, scaleType)).toBe(true);
    }
  });

  test('an unknown scale type is treated as seven degrees, matching SCALES own fallback', () => {
    expect(isProgressionAvailable(sevenNote, 'Pentatonic Major')).toBe(true);
  });

  test('a five-note scale leaves exactly the four zen entries', () => {
    const visible = CHORD_PROGRESSIONS.filter((p) => isProgressionAvailable(p, 'Hirajoshi'));
    expect(visible.map((p) => p.id)).toEqual([
      'zen-bamboo-vamp',
      'zen-moonlit-koto',
      'zen-still-pond',
      'zen-temple-bell',
    ]);
  });
});

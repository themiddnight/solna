import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChordView } from './ChordView';
import { useAppStore } from '../../store/store';
import { COUNT_BADGE } from '../ui/fieldClasses';

describe('ChordView preview UI', () => {
  test('renders separate chord and bass pattern preview buttons', () => {
    const html = renderToString(<ChordView />);

    expect(html).toContain('btn-preview-chord-pattern');
    expect(html).toContain('btn-preview-bass-pattern');
    expect(html).toContain('Hold to Preview Chord Pattern Loop');
    expect(html).toContain('Hold to Preview Bass Pattern Loop');
    // The two modules no longer share one combined preview.
    expect(html).not.toContain('Chord &amp; Bass Pattern Loop');
    // Progression pads preview the chord legato, not the old pattern hold.
    expect(html).toContain('Hold to Preview Chord');
    expect(html).not.toContain(
      'title="Hold to Preview Chord &amp; Bass Pattern"',
    );
  });
});

describe('ChordView progression drawer button', () => {
  // See the matching test in SynthView.test.tsx for why neither button says
  // "Library" any more.
  test('names its content, not the container', () => {
    const html = renderToString(<ChordView />);
    expect(html).toContain('>Progressions<');
    expect(html).toContain('title="Progression Library"');
    expect(html).not.toContain('>Library<');
  });
});

describe('ChordView theming', () => {
  const html = renderToString(<ChordView />);

  test('panels are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-panel border border-base-300');
    expect(html).toContain('border-module-chord/30');
    expect(html).toContain('border-module-bass/30');
  });

  test('the chord and bass module cards are opaque panels with a flat tint', () => {
    // Both used to be a 10% module colour with no surface under them, so on the
    // gradient canvas the sky read straight through and the cards themselves
    // looked like gradients. A tinted card needs bg-panel beneath the tint.
    expect(html).toContain('card bg-panel tint-chord');
    expect(html).toContain('card bg-panel tint-bass');
    // Nothing on this page paints a gradient of its own.
    expect(html).not.toContain('bg-gradient');
    expect(html).not.toContain('bg-linear');
  });

  test('every select is a bordered daisyUI select', () => {
    expect(html).toContain('select select-sm');
  });

  // Was: an assertion that this badge used a valid `py-` step. The padding is
  // gone — it was compensating for a badge whose display had been overridden to
  // plain `inline`, which drops daisyUI's own centring. The shared COUNT_BADGE
  // keeps `inline-flex`, so the badge centres its own digits and needs none.
  test('the library counter badge is the shared token, centred by inline-flex', () => {
    expect(html).toContain(COUNT_BADGE);
    expect(html).not.toContain('tabular-nums py-0.5');
  });

  test('chord chips are keyboard-reachable buttons with font-mono labels', () => {
    // Real <button> elements, not divs with click handlers — that is what makes
    // the chips tab-reachable. btn-soft is the daisyUI variant they wear since
    // a1b4ac2; the earlier btn-outline was a styling choice, not a contract.
    expect(html).toContain('<button type="button" class="btn btn-xs btn-soft');
    expect(html).toContain('font-mono');
  });

  test('no legacy hex or palette utilities survive', () => {
    expect(/#[0-9a-fA-F]{6}\b/.test(html)).toBe(false);
    for (const s of [
      'amber-',
      'indigo-',
      'slate-',
      'rose-',
      'cyan-',
      'emerald-',
      'purple-',
      'violet-',
      'pink-',
      'teal-',
      'blue-',
      'red-',
      'orange-',
      'yellow-',
      'zinc-',
      'gray-',
      'text-white',
      'bg-black',
      'ring-white',
      'rgba(',
    ]) {
      expect(html).not.toContain(s);
    }
  });
});

describe('ChordView pattern selects carry each pattern\'s meter', () => {
  test('in 4/4 both selects label every pattern with its own meter', () => {
    useAppStore.setState({ meterId: '4/4' });
    const html = renderToString(<ChordView />);
    expect(html).toContain('Sustained · 4/4');
    expect(html).toContain('Whole-Note Root · 4/4');
    expect(html).toContain('value="sustained"');
    expect(html).toContain('value="whole-note-root"');
  });

  // There is no companion test here rendering a non-default active meter
  // (e.g. '6/8') through `<ChordView />` and asserting the "what it becomes"
  // wording. A real `<ChordView />` cannot be rendered in a non-default
  // active meter through this harness: zustand v5's `useStore` wires
  // `getServerSnapshot` to `selector(api.getInitialState())`
  // (node_modules/zustand/react.js), and `getInitialState()` always returns
  // the object captured once at store creation — `useAppStore.setState(...)`
  // never touches it, and `react-dom/server`'s `useSyncExternalStore` shim
  // calls only `getServerSnapshot()`. Already confirmed and documented in
  // this repo at `TransportBar.test.tsx:51-66` and `InstantVibesBar.test.tsx`;
  // verified empirically here too (`useAppStore.setState({ meterId: '6/8' })`
  // followed by `renderToString(<ChordView />)` still renders the 4/4
  // default).
  //
  // A test that calls `patternOptionLabel`/`patternMeterTitle` directly with
  // a '6/8' argument instead of going through the component would not
  // exercise `ChordView.tsx` at all — it cannot fail for a wiring bug in
  // either select (e.g. a swapped `p.meter`/`meterId` argument order, or a
  // dropped `title` prop), and `meterSelect.test.ts` already pins that
  // composition at the helper level. So no such substitute test is added
  // here; a future task that needs the mismatch case rendered end-to-end will
  // need either a production-code change to how `ChordView` reads `meterId`
  // (e.g. a prop/context seam a test can drive) or new module-mocking test
  // infrastructure this repo does not otherwise use.
});

import { applyKeyScaleChange, shouldClearReharmonizeIndicator } from './ChordView';
import { deriveChordNotes } from '../../utils/musicTheory';
import type { ChordItem } from '../../types';

const chord = (id: string, root: string, quality: string): ChordItem =>
  deriveChordNotes({ id, root, quality, bars: 1, notes: [] }, 4);

// A Natural Minor, i - VI - III - VII.
const PROGRESSION: ChordItem[] = [
  chord('c1', 'A', 'min'),
  chord('c2', 'F', 'maj'),
  chord('c3', 'C', 'maj'),
  chord('c4', 'G', 'maj'),
];

const names = (chords: ChordItem[] | null) =>
  chords === null ? null : chords.map((c) => `${c.root}${c.quality}`);

const A_MINOR = { root: 'A', scaleType: 'Natural Minor' };

describe('applyKeyScaleChange', () => {
  test('a root-only change transposes and does not snap', () => {
    // The case the chordsReplaced guard could wrongly skip (ruling R1): the
    // chords array is the same object across the render, only the key moved.
    expect(
      names(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' }, 4, false)),
    ).toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('a scale-only change snaps and does not transpose', () => {
    expect(
      names(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, scaleType: 'Major' }, 4, false)),
    ).toEqual(['Amaj', 'Emaj', 'Bmin', 'F#min']);
  });

  test('both changed transposes first, then snaps — the order is pinned', () => {
    const both = applyKeyScaleChange(
      PROGRESSION,
      A_MINOR,
      { root: 'C', scaleType: 'Major' },
      4,
      false,
    );
    expect(names(both)).toEqual(['Cmaj', 'Gmaj', 'Dmin', 'Amin']);
    // Snapping first would measure the chords against a root they are not yet
    // in — today's bug. It produces a visibly different progression:
    expect(names(both)).not.toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('replaced chords are never touched, whatever else changed', () => {
    // An Instant Vibe writes scaleRoot, scaleType and chords in one batch. Its
    // chords were authored correct in its own key; harmonizing them is the bug.
    expect(
      applyKeyScaleChange(PROGRESSION, A_MINOR, { root: 'C', scaleType: 'Major' }, 4, true),
    ).toBeNull();
    expect(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' }, 4, true)).toBeNull();
  });

  test('an unchanged key and an empty chord list both return null', () => {
    expect(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR }, 4, false)).toBeNull();
    expect(applyKeyScaleChange([], A_MINOR, { root: 'C', scaleType: 'Major' }, 4, false)).toBeNull();
  });

  test('the octave is honoured', () => {
    const moved = applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' }, 3, false);
    expect(moved?.[0].notes).toEqual(deriveChordNotes(chord('c1', 'C', 'min'), 3).notes);
  });
});

describe('shouldClearReharmonizeIndicator', () => {
  test('an Instant Vibe swap (chords replaced and key changed) clears the badge', () => {
    expect(
      shouldClearReharmonizeIndicator(A_MINOR, { root: 'C', scaleType: 'Major' }, true),
    ).toBe(true);
    expect(shouldClearReharmonizeIndicator(A_MINOR, { ...A_MINOR, root: 'C' }, true)).toBe(true);
    expect(
      shouldClearReharmonizeIndicator(A_MINOR, { ...A_MINOR, scaleType: 'Major' }, true),
    ).toBe(true);
  });

  test('Re-harmonize and manual chord edits (replaced, key unchanged) do not clear it', () => {
    // This is the regression case: setChords + setIsAutoReharmonizedIndicator(true)
    // batched together must not have their own effect run wipe the badge back off.
    expect(shouldClearReharmonizeIndicator(A_MINOR, { ...A_MINOR }, true)).toBe(false);
  });

  test('a key change with the same chords array does not clear it', () => {
    expect(shouldClearReharmonizeIndicator(A_MINOR, { ...A_MINOR, root: 'C' }, false)).toBe(false);
  });
});

import { nextBassStepChoice, bassStepLabel } from './ChordView';
import type { BassStepChoice } from '../../audio/bassPatterns';

describe('ChordView custom step grid helpers', () => {
  test('bass steps cycle rest → root → third → fifth → seventh → octave → rest', () => {
    let value: BassStepChoice = 'rest';
    const seen: BassStepChoice[] = [value];
    for (let i = 0; i < 6; i++) {
      value = nextBassStepChoice(value);
      seen.push(value);
    }
    expect(seen).toEqual(['rest', 'root', 'third', 'fifth', 'seventh', 'octave', 'rest']);
  });

  test('bass step labels abbreviate each tone', () => {
    expect(bassStepLabel('root')).toBe('R');
    expect(bassStepLabel('third')).toBe('3');
    expect(bassStepLabel('fifth')).toBe('5');
    expect(bassStepLabel('seventh')).toBe('7');
    expect(bassStepLabel('octave')).toBe('8');
    expect(bassStepLabel('rest')).toBe('');
  });
});

describe('ChordView custom step grids', () => {
  // renderToString serves the store's INITIAL snapshot (zustand v5 wires the
  // server snapshot to api.getInitialState(), which setState never touches —
  // see the note above the meter tests). Live setState therefore cannot put
  // the component into custom mode for a server render, so these tests drive
  // the server-snapshot object directly and restore it afterward.
  test('the rhythm dropdown offers Custom; the grid renders only in custom mode', () => {
    useAppStore.getState().setChordRhythmMode('preset');
    const presetHtml = renderToString(<ChordView />);
    expect(presetHtml).toContain('>Custom…<');
    expect(presetHtml).not.toContain('bg-module-chord text-module-chord-content');

    const initial = useAppStore.getInitialState();
    initial.chordRhythmMode = 'custom';
    initial.customChordRhythm = [true, ...new Array(15).fill(false)];
    const customHtml = renderToString(<ChordView />);
    // The active step 0 of the chord grid wears the module fill.
    expect(customHtml).toContain('bg-module-chord text-module-chord-content');
    // The chord grid has no per-step labels, so no tone letter can appear.
    expect(customHtml).not.toContain('>R<');

    initial.chordRhythmMode = 'preset';
    initial.customChordRhythm = new Array(16).fill(false);
    useAppStore.getState().setChordRhythmMode('preset');
    useAppStore.getState().setCustomChordRhythm(new Array(16).fill(false));
  });

  test('the bass dropdown offers Custom; the bass grid renders in custom mode', () => {
    const initial = useAppStore.getInitialState();
    initial.bassPatternMode = 'custom';
    initial.customBassPattern = ['root', ...new Array<BassStepChoice>(15).fill('rest')];
    const customHtml = renderToString(<ChordView />);
    // The active step 0 of the bass grid wears the module fill and its label.
    expect(customHtml).toContain('bg-module-bass text-module-bass-content');
    expect(customHtml).toContain('>R<');
    initial.bassPatternMode = 'preset';
    initial.customBassPattern = new Array<BassStepChoice>(16).fill('rest');
    useAppStore.getState().setBassPatternMode('preset');
    useAppStore.getState().setCustomBassPattern(new Array<BassStepChoice>(16).fill('rest'));
  });
});

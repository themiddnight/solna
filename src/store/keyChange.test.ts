import { describe, expect, test } from 'bun:test';
import { ROOTS } from '@/musicCore';
import type { ChordQuality } from '@/musicCore';
import type { ChordItem } from '@/types';
import type { LeadNote } from '../audio/leadMelody';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { createDefaultLoop } from './loopSlice';
import { changeKey, harmonizeChordsToKey, type KeyChangeSource } from './keyChange';

const chord = (id: string, root: string, quality: ChordQuality, extra: Partial<ChordItem> = {}): ChordItem =>
  ({ id, root, quality, bars: 1, ...extra });

// A Natural Minor, i - VI - III - VII (the same fixture ChordView.test used).
const PROGRESSION: ChordItem[] = [
  chord('c1', 'A', 'min'),
  chord('c2', 'F', 'maj'),
  chord('c3', 'C', 'maj'),
  chord('c4', 'G', 'maj'),
];
const A_MINOR = { root: 'A', scaleType: 'Natural Minor' };
const names = (chords: ChordItem[] | null | undefined) =>
  chords == null ? null : chords.map((c) => `${c.root}${c.quality}`);

function melody(notes: LeadNote[]): LeadNote[][] {
  const steps = Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]);
  steps[0] = notes;
  return steps;
}

function source(over: Partial<KeyChangeSource> = {}): KeyChangeSource {
  return {
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    chords: PROGRESSION,
    leadMelodySteps: melody([{ note: 'A3', len: 1 }, { note: 'C4', len: 1 }]),
    fxMelodySteps: melody([{ note: 'E4', len: 1 }]),
    ...over,
  };
}

describe('harmonizeChordsToKey', () => {
  test('a root-only change transposes and does not snap', () => {
    expect(names(harmonizeChordsToKey(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' })))
      .toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('a scale-only change snaps and does not transpose', () => {
    expect(names(harmonizeChordsToKey(PROGRESSION, A_MINOR, { ...A_MINOR, scaleType: 'Major' })))
      .toEqual(['Amaj', 'Emaj', 'Bmin', 'F#min']);
  });

  test('both changed transposes first, then snaps — the order is pinned', () => {
    const both = harmonizeChordsToKey(PROGRESSION, A_MINOR, { root: 'C', scaleType: 'Major' });
    expect(names(both)).toEqual(['Cmaj', 'Gmaj', 'Dmin', 'Amin']);
    expect(names(both)).not.toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('an unchanged key and an empty chord list both return null', () => {
    expect(harmonizeChordsToKey(PROGRESSION, A_MINOR, { ...A_MINOR })).toBeNull();
    expect(harmonizeChordsToKey([], A_MINOR, { root: 'C', scaleType: 'Major' })).toBeNull();
  });

  test('bars and slash bass survive; every root stays ROOTS-spelled', () => {
    const input = [chord('c1', 'A', 'min', { bars: 2, bassNote: 'E' }), chord('c2', 'F', 'maj')];
    const out = harmonizeChordsToKey(input, A_MINOR, { root: 'C#', scaleType: 'Major' })!;
    expect(out.map((c) => c.bars)).toEqual([2, 1]);
    expect(out[0].bassNote).toBeDefined();
    for (const c of out) expect(ROOTS as readonly string[]).toContain(c.root);
  });
});

describe('changeKey', () => {
  test('melodies follow exactly as before: root transpose under the old type', () => {
    const patch = changeKey(source(), { root: 'C' }, { harmonizeChords: false });
    expect(patch.scaleRoot).toBe('C');
    expect('scaleType' in patch).toBe(false);
    expect(patch.leadMelodySteps![0]).toEqual([{ note: 'C3', len: 1 }, { note: 'D#3', len: 1 }]);
    expect(patch.fxMelodySteps![0]).toEqual([{ note: 'G3', len: 1 }]);
  });

  test('harmonizeChords: false leaves chords out of the patch', () => {
    expect('chords' in changeKey(source(), { root: 'C' }, { harmonizeChords: false })).toBe(false);
  });

  test('harmonizeChords: true transposes then snaps the chords', () => {
    const patch = changeKey(source(), { root: 'C', scaleType: 'Major' }, { harmonizeChords: true });
    expect(names(patch.chords)).toEqual(['Cmaj', 'Gmaj', 'Dmin', 'Amin']);
  });

  test('no chords key for an empty progression or an unchanged key', () => {
    expect('chords' in changeKey(source({ chords: [] }), { root: 'C' }, { harmonizeChords: true })).toBe(false);
    expect('chords' in changeKey(source(), { root: 'A' }, { harmonizeChords: true })).toBe(false);
  });

  test('touches only key, melody and chord fields — bass, pad, drums and mix stay out', () => {
    const patch = changeKey(createDefaultLoop(), { root: 'D', scaleType: 'Dorian' }, { harmonizeChords: true });
    for (const key of Object.keys(patch)) {
      expect(['scaleRoot', 'scaleType', 'chords', 'leadMelodySteps', 'fxMelodySteps']).toContain(key);
    }
  });

  test('works on a non-active loop from loops[] exactly as on flat state', () => {
    // changeKey reads only its argument — a Loop in loops[] and a flat state
    // holding the same content give the same patch; no activeLoopId is read.
    const loop = { ...createDefaultLoop(), id: 'loop-other', ...source() };
    const fromLoop = changeKey(loop, { root: 'E', scaleType: 'Major' }, { harmonizeChords: true });
    const fromFlat = changeKey(source(), { root: 'E', scaleType: 'Major' }, { harmonizeChords: true });
    expect(fromLoop).toEqual(fromFlat);
  });
});

import { describe, expect, test } from 'bun:test';
import { sanitizeLoops } from './sanitize';
import { createDefaultLoop } from './loopSlice';
import { generateBlockChordNotes, snapProgressionToScale } from '../utils/musicTheory';
import { resolveBassSteps } from '../audio/bassPatterns';
import { resolvePadArm } from '../audio/playback/padPlayback';
import { BASS_PATTERNS } from '@/data/bassPatterns';
import type { Loop } from './types';
import type { ChordItem } from '../types';

// Every bar's hold time is irrelevant here; a fixed bar duration keeps the
// pad's holdSec computation well-defined without depending on tempo.
const BAR_DUR_SEC = 2;

function assertConsumersAgree(loop: Loop, chord: ChordItem, expected: string[]): void {
  // Bass fallback-tone resolution (Task 4).
  const thirdOnlyPattern = BASS_PATTERNS.find((p) => p.id === 'root-fifth-walk') ?? BASS_PATTERNS[0];
  const bassEvents = resolveBassSteps(thirdOnlyPattern, [chord], 0, 4, 'C', 'Major', 120);
  expect(bassEvents.length).toBeGreaterThan(0);
  for (const event of bassEvents) {
    // Every bass event's pitch class must come from the SAME chord family
    // as `expected`, never from a stray/contradictory notes array.
    expect(expected.some((n) => n.replace(/\d+$/, '') === event.noteName.replace(/\d+$/, ''))).toBe(true);
  }

  // Pad arm (already-derive-fresh path) must land on the exact same set.
  const arm = resolvePadArm({
    mode: 'pad',
    isLoopStart: true,
    chord,
    degree: 0,
    intervals: [],
    padOctave: 4,
    voicing: 'triad',
    scaleRoot: 'C',
    scaleType: 'Major',
    barDur: BAR_DUR_SEC,
    loopBarCount: loop.repeatCount ?? 1,
  });
  expect(arm?.notes).toEqual(expected);
}

describe('a chord installed with a contradictory stored notes field resolves identically everywhere', () => {
  // A malicious/legacy body: root C maj, but a stray notes array naming an
  // entirely different chord (F# minor). Nothing downstream may read that
  // array — it does not exist on ChordItem any more, and sanitize does not
  // validate a field it does not check.
  const rawChord = {
    id: 'c1',
    root: 'C',
    quality: 'maj',
    bars: 1,
    notes: ['F#3', 'A3', 'C#4'],
  };

  test('sanitizeLoops, bass resolution and the pad arm all agree on the derived pitches', () => {
    const [loop] = sanitizeLoops([{ ...createDefaultLoop(), chords: [rawChord] }]) ?? [];
    const chord = loop.chords[0];

    // The stray notes field must not have survived sanitize at all.
    expect(chord).not.toHaveProperty('notes');

    const expected = generateBlockChordNotes('maj', 'C', 4);
    assertConsumersAgree(loop, chord, expected);
  });
});

describe('the preserve-quality snap case: root moves, quality is kept verbatim', () => {
  // 'add9' is in the added-tone reharmonization family, one of the four
  // categories shouldPreserveQualityOnSnap keeps verbatim through a scale
  // snap (see chordQuality.ts). C# is not a diatonic root of C Major, so
  // snapping guarantees the root actually moves off its original pitch —
  // this is not the common "quality also changes" case Task 1's review
  // flagged as under-covered.
  const original: ChordItem = { id: 'c2', root: 'C#', quality: 'add9', bars: 1 };

  test('snapProgressionToScale preserves quality while relocating the root', () => {
    const [snapped] = snapProgressionToScale([original], 'C', 'Major');

    expect(snapped.quality).toBe('add9');
    expect(snapped.root).not.toBe(original.root);
  });

  test('every consumer derives the same pitches for the snapped (preserved-quality, moved-root) chord', () => {
    const [snapped] = snapProgressionToScale([original], 'C', 'Major');

    // Round-trip through the real ingress path with a stray contradictory
    // notes field attached, exactly like the first describe block, so this
    // case is proven under the same conditions rather than only in isolation.
    const rawSnapped = { ...snapped, notes: ['F#3', 'A3', 'C#4'] };
    const [loop] = sanitizeLoops([{ ...createDefaultLoop(), chords: [rawSnapped] }]) ?? [];
    const chord = loop.chords[0];

    expect(chord.quality).toBe('add9');
    expect(chord.root).toBe(snapped.root);

    const expected = generateBlockChordNotes(snapped.quality, snapped.root, 4);
    assertConsumersAgree(loop, chord, expected);
  });
});

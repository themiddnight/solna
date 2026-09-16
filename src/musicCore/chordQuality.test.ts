import { describe, expect, test } from 'bun:test';
import {
  CHORD_QUALITY_ALIASES,
  CHORD_QUALITY_GROUPS,
  CHORD_QUALITY_REGISTRY,
  formatChordQuality,
  getChordQualityEntry,
  isChordQuality,
  resolveChordNotes,
  shouldPreserveQualityOnSnap,
} from './chordQuality';
import type { ChordQuality } from './chordQuality';

describe('CHORD_QUALITY_REGISTRY', () => {
  test('every registered quality resolves through Tonal at a natural root', () => {
    for (const entry of CHORD_QUALITY_REGISTRY) {
      expect(() => resolveChordNotes(entry.token, 'C', 4)).not.toThrow();
      expect(resolveChordNotes(entry.token, 'C', 4).length).toBeGreaterThan(0);
    }
  });

  test('has no duplicate tokens', () => {
    const tokens = CHORD_QUALITY_REGISTRY.map((e) => e.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  test('every quality resolveDegreeQuality can emit is registered', () => {
    // The closed output set of `resolveDegreeQuality` (src/utils/musicTheory.ts)
    // is exactly the values of its two interval->quality tables, read off the
    // source at the time this registry was written. Restated here as a literal
    // rather than imported, because `src/musicCore/` sits BELOW `src/utils/`
    // and may not depend on it — Task 3 moves the resolver in, and this list is
    // what it must keep satisfying.
    const emittable = [
      // TRIAD_QUALITY_BY_INTERVALS
      'maj',
      'min',
      'dim',
      'aug',
      // SEVENTH_QUALITY_BY_INTERVALS
      'maj7',
      '7',
      'min7',
      'm7b5',
      'dim7',
      'minMaj7',
      'maj7#5',
    ];
    for (const quality of emittable) {
      expect(isChordQuality(quality), quality).toBe(true);
    }
  });

  test('every entry carries a non-empty reharmonization category', () => {
    for (const entry of CHORD_QUALITY_REGISTRY) {
      expect(typeof entry.reharmonizationCategory, entry.token).toBe('string');
      expect(entry.reharmonizationCategory.length, entry.token).toBeGreaterThan(0);
    }
  });
});

describe('resolveChordNotes', () => {
  test('an unregistered quality throws rather than silently becoming maj', () => {
    expect(() => resolveChordNotes('not-a-real-quality', 'C', 4)).toThrow();
  });

  test('resolves the notes a registered quality names', () => {
    expect(resolveChordNotes('maj7', 'C', 4)).toEqual(['C4', 'E4', 'G4', 'B4']);
    expect(resolveChordNotes('min', 'A', 4)).toEqual(['A4', 'C5', 'E5']);
  });

  test('output notes are canonical sharp-spelled, never flats (DEV-380)', () => {
    for (const entry of CHORD_QUALITY_REGISTRY) {
      for (const note of resolveChordNotes(entry.token, 'D#', 4)) {
        expect(note, `${entry.token} -> ${note}`).not.toContain('b');
      }
    }
  });
});

describe('isChordQuality / getChordQualityEntry', () => {
  test('accepts every registered token case-insensitively', () => {
    expect(isChordQuality('minMaj7')).toBe(true);
    expect(isChordQuality('MINMAJ7')).toBe(true);
    expect(isChordQuality('not-a-quality')).toBe(false);
  });

  test('getChordQualityEntry returns undefined for an unregistered token', () => {
    expect(getChordQualityEntry('not-a-quality')).toBeUndefined();
  });
});

describe('formatChordQuality', () => {
  test('returns the registry display suffix', () => {
    expect(formatChordQuality('maj')).toBe('');
    expect(formatChordQuality('min7')).toBe('m7');
    expect(formatChordQuality('minMaj7')).toBe('mM7');
    expect(formatChordQuality('maj7#5')).toBe('maj7#5');
  });

  test('an unregistered token echoes itself', () => {
    expect(formatChordQuality('not-a-quality')).toBe('not-a-quality');
  });
});

describe('CHORD_QUALITY_ALIASES', () => {
  test('only lists tokens whose Tonal alias actually differs, matching the historical contract', () => {
    expect(CHORD_QUALITY_ALIASES.min9).toBe('m9');
    expect(CHORD_QUALITY_ALIASES.min6).toBe('m6');
    expect(CHORD_QUALITY_ALIASES.minmaj7).toBe('mMaj7');
    for (const [app, tonalType] of Object.entries(CHORD_QUALITY_ALIASES)) {
      expect(app).not.toBe(tonalType);
    }
  });
});

describe('CHORD_QUALITY_GROUPS', () => {
  test('covers every registered token exactly once, across the three groups', () => {
    const flattened = CHORD_QUALITY_GROUPS.flatMap((g) => g.options.map((o) => o.value));
    const registered = CHORD_QUALITY_REGISTRY.map((e) => e.token);
    expect([...flattened].sort()).toEqual([...registered].sort());
  });

  test('includes the two qualities the pre-DEV-394 picker was missing', () => {
    const values = CHORD_QUALITY_GROUPS.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain('minMaj7');
    expect(values).toContain('maj7#5');
  });
});

describe('shouldPreserveQualityOnSnap', () => {
  // resolveDegreeQuality (src/utils/musicTheory.ts) can itself emit exactly
  // these eleven qualities at some degree of some scale — regenerating them
  // on a snap asks the target key for its OWN version of the same shape.
  const REGENERATE: ChordQuality[] = [
    'maj', 'min', 'dim', 'aug',
    'maj7', 'min7', '7', 'm7b5', 'dim7', 'minMaj7', 'maj7#5',
  ];
  // No interval tuple resolveDegreeQuality resolves ever names one of these —
  // there is no diatonic version to regenerate to, so a snap preserves them.
  const PRESERVE: ChordQuality[] = [
    'sus2', 'sus4', '7sus4', '9', 'maj9', 'min9', 'add9', '6', 'min6',
  ];

  test('regenerates every quality resolveDegreeQuality can itself emit', () => {
    for (const quality of REGENERATE) {
      expect(shouldPreserveQualityOnSnap(quality), quality).toBe(false);
    }
  });

  test('preserves every quality resolveDegreeQuality can never emit', () => {
    for (const quality of PRESERVE) {
      expect(shouldPreserveQualityOnSnap(quality), quality).toBe(true);
    }
  });

  test('covers every registered token exactly once between the two lists', () => {
    const registered = CHORD_QUALITY_REGISTRY.map((e) => e.token).sort();
    expect([...REGENERATE, ...PRESERVE].sort()).toEqual(registered);
  });

  test('altered 7th-shaped qualities (minMaj7, maj7#5) regenerate — NOT preserved', () => {
    // The one pairing the issue's own hypothesis got backwards: altered is a
    // regenerate category (resolveDegreeQuality can emit both), not a
    // preserve one. Named explicitly so a future reader does not "fix" this
    // back the other way.
    expect(shouldPreserveQualityOnSnap('minMaj7')).toBe(false);
    expect(shouldPreserveQualityOnSnap('maj7#5')).toBe(false);
  });

  test('throws for an unregistered quality, same contract as resolveChordNotes', () => {
    expect(() => shouldPreserveQualityOnSnap('not-a-real-quality' as ChordQuality)).toThrow();
  });
});

import { describe, expect, test } from 'bun:test';
import {
  ARP_SEQUENCE_CACHE_MAX,
  arpCacheStats,
  buildArpSequence,
  buildArpSequenceUncached,
  resetArpSequenceCache,
} from './arpeggiator';

describe('buildArpSequence octave expansion', () => {
  test('a single held note over one octave yields that note', () => {
    expect(buildArpSequence(['C4'], 'up', 1)).toEqual(['C4']);
  });

  test('a single held note over three octaves climbs by real octaves', () => {
    expect(buildArpSequence(['C4'], 'up', 3)).toEqual(['C4', 'C5', 'C6']);
  });

  test('a held chord over two octaves repeats the chord an octave up', () => {
    expect(buildArpSequence(['C4', 'E4', 'G4'], 'up', 2)).toEqual([
      'C4', 'E4', 'G4', 'C5', 'E5', 'G5',
    ]);
  });

  test('held notes are ordered by pitch regardless of press order', () => {
    expect(buildArpSequence(['G4', 'C4', 'E4'], 'up', 1)).toEqual(['C4', 'E4', 'G4']);
  });

  test('octave count below one is clamped to one', () => {
    expect(buildArpSequence(['C4'], 'up', 0)).toEqual(['C4']);
  });
});

describe('buildArpSequence modes', () => {
  test('down reverses the expanded notes', () => {
    expect(buildArpSequence(['C4', 'E4', 'G4'], 'down', 1)).toEqual(['G4', 'E4', 'C4']);
  });

  test('updown walks up then back without repeating the endpoints', () => {
    expect(buildArpSequence(['C4', 'E4', 'G4'], 'updown', 1)).toEqual([
      'C4', 'E4', 'G4', 'E4',
    ]);
  });

  test('updown with two notes keeps both ends of the turnaround', () => {
    expect(buildArpSequence(['C4', 'E4'], 'updown', 1)).toEqual(['C4', 'E4', 'E4', 'C4']);
  });

  test('random returns a permutation of the expanded notes', () => {
    const out = buildArpSequence(['C4', 'E4', 'G4'], 'random', 2);
    expect(out.length).toBe(6);
    expect([...out].sort()).toEqual(['C4', 'C5', 'E4', 'E5', 'G4', 'G5'].sort());
  });

  test('an unknown mode falls back to up instead of going silent', () => {
    expect(buildArpSequence(['C4', 'E4'], 'bogus' as never, 1)).toEqual(['C4', 'E4']);
  });
});

describe('buildArpSequence edge cases', () => {
  test('no held notes yields an empty sequence', () => {
    expect(buildArpSequence([], 'up', 2)).toEqual([]);
  });

  test('an unparseable note name is dropped rather than emitted as an empty string', () => {
    expect(buildArpSequence(['C4', 'not-a-note'], 'up', 1)).toEqual(['C4']);
  });

  test('sharps survive octave expansion', () => {
    expect(buildArpSequence(['D#4'], 'up', 2)).toEqual(['D#4', 'D#5']);
  });
});

describe('buildArpSequence memoization', () => {
  test('N ticks with unchanged inputs build the sequence exactly once', () => {
    resetArpSequenceCache();
    const held = new Set(['C4', 'E4', 'G4']);
    const first = buildArpSequence(held, 'up', 2);
    for (let tick = 0; tick < 15; tick++) {
      expect(buildArpSequence(held, 'up', 2)).toBe(first);
    }
    expect(arpCacheStats()).toEqual({ hits: 15, misses: 1 });
  });

  test('a changed held set, mode or octave count is a miss', () => {
    resetArpSequenceCache();
    buildArpSequence(['C4'], 'up', 1);
    buildArpSequence(['C4', 'E4'], 'up', 1);
    buildArpSequence(['C4', 'E4'], 'down', 1);
    buildArpSequence(['C4', 'E4'], 'down', 2);
    expect(arpCacheStats()).toEqual({ hits: 0, misses: 4 });
  });

  test('four concurrent arp sources with different held sets all stay cached', () => {
    // chord arp, bass arp, lead arp and the keyboard arp all call this from
    // the same clock tick with different held sets — a one-entry cache would
    // thrash to a 0% hit rate, which is why the cache holds 8.
    resetArpSequenceCache();
    const sets = [['C4', 'E4'], ['C2'], ['G5', 'B5'], ['A4']];
    for (let tick = 0; tick < 4; tick++) {
      for (const s of sets) buildArpSequence(s, 'up', 1);
    }
    expect(arpCacheStats()).toEqual({ hits: 12, misses: 4 });
  });

  test('the cache is bounded and evicts the oldest key', () => {
    resetArpSequenceCache();
    for (let i = 0; i < ARP_SEQUENCE_CACHE_MAX + 1; i++) {
      buildArpSequence([`C${i % 8}`, 'E4'], 'up', i + 1);
    }
    // The first key was evicted by the 9th insert, so asking for it again misses.
    buildArpSequence(['C0', 'E4'], 'up', 1);
    expect(arpCacheStats().misses).toBe(ARP_SEQUENCE_CACHE_MAX + 2);
  });

  test('random mode is never cached — its per-step reshuffle is the behaviour', () => {
    resetArpSequenceCache();
    const held = ['C4', 'E4', 'G4', 'B4', 'D5', 'F5'];
    buildArpSequence(held, 'random', 2);
    buildArpSequence(held, 'random', 2);
    buildArpSequence(held, 'random', 2);
    expect(arpCacheStats()).toEqual({ hits: 0, misses: 0 });
  });

  test('the memo wrapper returns exactly what the uncached builder returns', () => {
    resetArpSequenceCache();
    for (const mode of ['up', 'down', 'updown'] as const) {
      for (const octaves of [1, 2, 3]) {
        expect(buildArpSequence(['G4', 'C4', 'E4'], mode, octaves)).toEqual(
          buildArpSequenceUncached(['G4', 'C4', 'E4'], mode, octaves),
        );
      }
    }
  });
});

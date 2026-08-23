import { describe, expect, test } from 'bun:test';
import { buildArpSequence } from './arpeggiator';

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

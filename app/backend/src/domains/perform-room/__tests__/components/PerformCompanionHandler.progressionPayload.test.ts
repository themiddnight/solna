import { describe, expect, it } from '@jest/globals';
import { isValidProgressionPayload } from '../../infrastructure/handlers/progressionPayloadGuard';

const ok = { mode: 'manual', barsPerChord: 1, currentChordIndex: 0 };

describe('isValidProgressionPayload', () => {
  it('accepts diatonic step (no kind)', () => {
    expect(isValidProgressionPayload({ ...ok, chords: [{ degree: 1, durationBars: 1 }] })).toBe(true);
  });
  it('accepts borrowed step', () => {
    expect(isValidProgressionPayload({ ...ok, chords: [{ kind: 'borrowed', semitones: 5, quality: 'min', durationBars: 1 }] })).toBe(true);
  });
  it('accepts modifiers array', () => {
    expect(isValidProgressionPayload({ ...ok, chords: [{ degree: 5, durationBars: 1, modifiers: ['dominant7'] }] })).toBe(true);
  });
  it('rejects bad semitones', () => {
    expect(isValidProgressionPayload({ ...ok, chords: [{ kind: 'borrowed', semitones: 12, quality: 'min', durationBars: 1 }] })).toBe(false);
  });
  it('rejects unknown modifier', () => {
    expect(isValidProgressionPayload({ ...ok, chords: [{ degree: 1, durationBars: 1, modifiers: ['bogus'] }] })).toBe(false);
  });
  it('rejects unknown kind', () => {
    expect(isValidProgressionPayload({ ...ok, chords: [{ kind: 'weird', degree: 1, durationBars: 1 }] })).toBe(false);
  });
});

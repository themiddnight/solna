import { describe, expect, test } from 'bun:test';
import { DEFAULT_DRUM_KIT, DRUM_KITS, GENRE_TO_KIT, mergeDrumKit } from './drumKits';
import { GENRE_PRESETS } from './data/genrePresets';

const DRUM_TYPES = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'] as const;

describe('mergeDrumKit', () => {
  test('no argument returns the defaults', () => {
    expect(mergeDrumKit()).toEqual(DEFAULT_DRUM_KIT);
  });

  test('a partial override keeps the sibling params of the same drum', () => {
    // The merge is one level deep PER DRUM TYPE and every DrumKit value is a
    // flat number, so there is no third level to lose.
    const merged = mergeDrumKit({ kick: { ...DEFAULT_DRUM_KIT.kick, gain: 0.1 } });
    expect(merged.kick.gain).toBe(0.1);
    expect(merged.kick.freqStart).toBe(DEFAULT_DRUM_KIT.kick.freqStart);
    expect(merged.snare).toEqual(DEFAULT_DRUM_KIT.snare);
  });

  test('never mutates DEFAULT_DRUM_KIT', () => {
    const before = JSON.stringify(DEFAULT_DRUM_KIT);
    const merged = mergeDrumKit(DRUM_KITS['Trap Beat']);
    merged.kick.gain = 99;
    expect(JSON.stringify(DEFAULT_DRUM_KIT)).toBe(before);
  });

  test('every kit merges to a complete DrumKit', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      const kit = mergeDrumKit(partial);
      for (const type of DRUM_TYPES) {
        expect(kit[type], `${name}/${type}`).toBeTruthy();
      }
      expect(Number.isFinite(kit.snare.reverbSend)).toBe(true);
      expect(Number.isFinite(kit.clap.reverbSend)).toBe(true);
      expect(Number.isFinite(kit.crash.reverbSend)).toBe(true);
    }
  });
});

describe('genre → kit mapping', () => {
  test('GENRE_TO_KIT and GENRE_PRESETS have identical key sets', () => {
    // SequencerView builds the dropdown from Object.keys(GENRE_PRESETS) and
    // looks the choice up in GENRE_TO_KIT; a one-sided edit makes a genre
    // silently fall through to `?? selectedGenre` and select no kit at all.
    expect(Object.keys(GENRE_TO_KIT).sort()).toEqual(Object.keys(GENRE_PRESETS).sort());
  });

  test('every GENRE_TO_KIT value names a real kit', () => {
    for (const [genre, kit] of Object.entries(GENRE_TO_KIT)) {
      expect(DRUM_KITS[kit], `${genre} -> ${kit}`).toBeTruthy();
    }
  });
});

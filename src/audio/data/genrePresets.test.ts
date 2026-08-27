import { describe, expect, test } from 'bun:test';
import { GENRE_PRESETS } from './genrePresets';
import { getMeter, isMeterId } from '../../utils/meter';

const GENRES = [
  'Synthwave',
  'House',
  'Trap',
  'Boom Bap',
  'Cyberpunk',
  'DnB',
  'Dubstep',
  'Techno',
  'Funk',
  'Rock',
  'Reggae',
  'Lo-Fi Hip-Hop',
  'Waltz',
  'Afro 6/8',
];

const GENRE_METERS: Record<string, string> = {
  Synthwave: '4/4',
  House: '4/4',
  Trap: '4/4',
  'Boom Bap': '4/4',
  Cyberpunk: '4/4',
  DnB: '4/4',
  Dubstep: '4/4',
  Techno: '4/4',
  Funk: '4/4',
  Rock: '4/4',
  Reggae: '4/4',
  'Lo-Fi Hip-Hop': '4/4',
  Waltz: '3/4',
  'Afro 6/8': '6/8',
};

const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'bass'];

describe('GENRE_PRESETS data sanity', () => {
  test('holds exactly the fourteen genre keys, unchanged by the reshape', () => {
    expect(Object.keys(GENRE_PRESETS).sort()).toEqual([...GENRES].sort());
  });

  test('every genre declares a real meter', () => {
    for (const genre of GENRES) {
      expect(isMeterId(GENRE_PRESETS[genre].meter), `${genre} meter`).toBe(true);
    }
  });

  test('every genre carries the meter it was authored in', () => {
    for (const genre of GENRES) {
      expect(GENRE_PRESETS[genre].meter, genre).toBe(GENRE_METERS[genre]);
    }
  });

  test('every genre defines all seven rows and nothing else', () => {
    for (const genre of GENRES) {
      expect(Object.keys(GENRE_PRESETS[genre].rows).sort()).toEqual([...ROWS].sort());
    }
  });

  test("every row is exactly its own meter's bar length, in booleans", () => {
    for (const genre of GENRES) {
      const preset = GENRE_PRESETS[genre];
      const expected = getMeter(preset.meter).stepsPerBar;
      for (const [instrument, steps] of Object.entries(preset.rows)) {
        expect(steps.length, `${genre}/${instrument} must be ${expected} steps`).toBe(expected);
        expect(
          steps.every((v) => typeof v === 'boolean'),
          `${genre}/${instrument} must be booleans`,
        ).toBe(true);
      }
    }
  });

  test('the rows are byte-identical to the pre-reshape data for a spot-checked genre', () => {
    // Synthwave kick: four on the floor. Pinned so the reshape cannot silently
    // reorder or rewrite a row while moving it under `rows`.
    expect(GENRE_PRESETS.Synthwave.rows.kick).toEqual([
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
    ]);
    expect(GENRE_PRESETS['Boom Bap'].rows.snare).toEqual([
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false,
    ]);
  });
});

describe('the two non-4/4 genres state their meter through their accents', () => {
  const on = (genre: string, row: string) =>
    GENRE_PRESETS[genre].rows[row].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  test('Waltz is oom-pah-pah on the [4,4,4] beat set', () => {
    expect(on('Waltz', 'kick')).toEqual([0]);
    expect(on('Waltz', 'snare')).toEqual([4, 8]);
    expect(on('Waltz', 'bass')).toEqual([0, 8]);
  });

  test('Afro 6/8 kicks the two dotted-quarter beats and pushes off 4 and 10', () => {
    expect(on('Afro 6/8', 'kick')).toEqual([0, 6]);
    expect(on('Afro 6/8', 'snare')).toEqual([4, 10]);
    expect(on('Afro 6/8', 'bass')).toEqual([0, 6, 10]);
  });

  test('the two twelve-step genres are not the same pattern under two names', () => {
    // Both bars are twelve steps. If the kicks ever matched, one of them would
    // be mislabelled — bar length cannot tell 3/4 from 6/8.
    expect(on('Waltz', 'kick')).not.toEqual(on('Afro 6/8', 'kick'));
    expect(on('Waltz', 'snare')).not.toEqual(on('Afro 6/8', 'snare'));
  });
});

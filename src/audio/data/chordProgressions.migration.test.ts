import { describe, expect, test } from 'bun:test';
import { progressionById, resolveProgression } from './chordProgressions';
import { generateBlockChordNotes, ROOTS, rootSemitone, SCALES } from '../../utils/musicTheory';

/**
 * The 22 original interval-form templates, copied verbatim. `interval` is
 * semitones from the key root. This fixture outlives the data it was copied
 * from: Task 7 deletes CHORD_PROGRESSION_TEMPLATES, and this stays as the only
 * remaining record of what each progression used to sound like.
 *
 * `referenceScale` is the scale each progression's degrees are authored in —
 * the first scale in the preference order [Major, Natural Minor, Dorian,
 * Mixolydian, Lydian, Phrygian, Harmonic Minor] that contains every one of its
 * chord roots without collapsing two distinct chords onto one degree.
 */
interface OriginalTemplate {
  id: string;
  name: string;
  referenceScale: string;
  relativeChords: Array<{ interval: number; quality: string; bars: number }>;
}

const c = (interval: number, quality: string, bars = 1) => ({ interval, quality, bars });

export const ORIGINAL_TEMPLATES: OriginalTemplate[] = [
  { id: 'pop-i-v-vi-iv', name: 'Classic 4-Chord Pop Anthem', referenceScale: 'Major',
    relativeChords: [c(0, 'maj'), c(7, 'maj'), c(9, 'min'), c(5, 'maj')] },
  { id: 'pop-vi-iv-i-v', name: 'Emotional Minor Synthwave', referenceScale: 'Major',
    relativeChords: [c(9, 'min'), c(5, 'maj'), c(0, 'maj'), c(7, 'maj')] },
  { id: 'pop-doowop', name: 'Classic 50s Doo-Wop Cadence', referenceScale: 'Major',
    relativeChords: [c(0, 'maj'), c(9, 'min'), c(5, 'maj'), c(7, 'maj')] },
  { id: 'pop-future-bass', name: 'Future Bass / Euphoric EDM Lift', referenceScale: 'Major',
    relativeChords: [c(5, 'maj7'), c(7, '7'), c(4, 'min7'), c(9, 'min7')] },
  { id: 'pop-club-house', name: 'Club Dance & House Groove', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min7'), c(8, 'maj7'), c(10, '7'), c(7, 'min7')] },
  { id: 'jazz-ii-v-i-vi', name: 'Jazz ii-V-I-VI Turnaround', referenceScale: 'Major',
    relativeChords: [c(2, 'min7'), c(7, '7'), c(0, 'maj7'), c(9, '7')] },
  { id: 'jazz-neosoul-butter', name: 'Neo-Soul Butter Flow', referenceScale: 'Major',
    relativeChords: [c(0, 'maj9'), c(11, 'm7b5'), c(4, '7'), c(9, 'min9')] },
  { id: 'jazz-chromatic-mediants', name: 'Chromatic Mediants / Giant Step Cycle', referenceScale: 'Phrygian',
    relativeChords: [c(0, 'maj7'), c(8, 'maj7'), c(1, 'maj7'), c(7, '7sus4')] },
  { id: 'lofi-coffeehouse', name: 'Lofi Extended 9th Coffeehouse', referenceScale: 'Major',
    relativeChords: [c(2, 'min9'), c(7, '7'), c(0, 'maj9'), c(5, 'maj7')] },
  { id: 'lofi-trapsoul', name: 'Contemporary R&B / Trap-Soul Flow', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min9'), c(5, 'min7'), c(10, '9'), c(3, 'maj7')] },
  { id: 'lofi-bedroom-pop', name: 'Melancholy Bedroom Pop', referenceScale: 'Major',
    relativeChords: [c(0, 'maj7'), c(5, 'maj7'), c(2, 'min7'), c(7, '7')] },
  { id: 'jpop-royal-road', name: 'Royal Road / Oudo Cadence (王道進行)', referenceScale: 'Major',
    relativeChords: [c(5, 'maj7'), c(7, '7'), c(4, 'min7'), c(9, 'min7')] },
  { id: 'jpop-marusa', name: 'City Pop / Marusa Groove (丸サ進行)', referenceScale: 'Major',
    relativeChords: [c(5, 'maj7'), c(4, '7'), c(9, 'min7'), c(0, '7')] },
  { id: 'jpop-heroic', name: 'Heroic Anthem / J-Rock Drive', referenceScale: 'Major',
    relativeChords: [c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(0, 'maj')] },
  { id: 'blues-12bar', name: '12-Bar Blues Standard', referenceScale: 'Major',
    relativeChords: [c(0, '7', 2), c(5, '7'), c(0, '7'), c(7, '7'), c(5, '7'), c(0, '7', 2)] },
  { id: 'rock-mixolydian', name: 'Mixolydian Rock Anthem', referenceScale: 'Mixolydian',
    relativeChords: [c(0, 'maj'), c(10, 'maj'), c(5, 'maj'), c(0, 'maj')] },
  { id: 'rock-andalusian', name: 'Andalusian / Flamenco Descent', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(7, '7')] },
  { id: 'cine-epic-ostinato', name: 'Epic Cinematic Ostinato', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min'), c(8, 'maj'), c(3, 'maj'), c(10, 'maj')] },
  { id: 'cine-dorian-voyage', name: 'Dorian Space Voyage', referenceScale: 'Dorian',
    relativeChords: [c(0, 'min7'), c(5, '7'), c(0, 'min7'), c(5, '7')] },
  { id: 'cine-lydian-dream', name: 'Lydian Dreamscape', referenceScale: 'Lydian',
    relativeChords: [c(0, 'maj7'), c(2, 'maj'), c(0, 'maj7'), c(2, 'maj')] },
  { id: 'baroque-canon', name: 'Baroque Canon Cadence', referenceScale: 'Major',
    relativeChords: [c(0, 'maj'), c(7, 'maj'), c(9, 'min'), c(4, 'min'), c(5, 'maj'), c(0, 'maj'), c(5, 'maj'), c(7, 'maj')] },
  { id: 'baroque-passacaglia', name: 'Passacaglia / Circle of Fifths Descent', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min'), c(5, 'min'), c(10, 'maj'), c(3, 'maj'), c(8, 'maj'), c(2, 'dim'), c(7, '7'), c(0, 'min')] },
];

describe('migration fixture', () => {
  test('ids are unique and every progression has at least one chord', () => {
    expect(new Set(ORIGINAL_TEMPLATES.map((t) => t.id)).size).toBe(ORIGINAL_TEMPLATES.length);
    for (const t of ORIGINAL_TEMPLATES) {
      expect(t.relativeChords.length).toBeGreaterThan(0);
    }
  });
});

describe('migration equivalence: degree form reproduces interval form', () => {
  test('every progression, in every one of the 12 roots, resolves to the same chords', () => {
    // 22 progressions x 12 roots. Running all 12 rather than C alone is what
    // catches modulo and wrap mistakes; a single wrong degree fails here.
    for (const original of ORIGINAL_TEMPLATES) {
      const progression = progressionById(original.id);
      expect(progression).toBeDefined();
      if (!progression) continue;
      expect(progression.name).toBe(original.name);
      expect(progression.referenceScale).toBe(original.referenceScale);
      expect(progression.steps).toHaveLength(original.relativeChords.length);

      for (const root of ROOTS) {
        const resolved = resolveProgression(progression, root, progression.referenceScale, 4);
        expect(resolved).toHaveLength(original.relativeChords.length);
        original.relativeChords.forEach((rc, i) => {
          const expectedRoot = ROOTS[(rootSemitone(root) + rc.interval) % 12];
          expect({
            root: resolved[i].root,
            quality: resolved[i].quality,
            bars: resolved[i].bars,
            notes: resolved[i].notes,
          }).toEqual({
            root: expectedRoot,
            quality: rc.quality,
            bars: rc.bars,
            notes: generateBlockChordNotes(rc.quality, expectedRoot, 4),
          });
        });
      }
    }
  });

  test('an omitted quality means the reference scale said so, not that it was forgotten', () => {
    // The one way a step can silently disagree with the original: leaving the
    // quality out when the scale's triad for that degree is something else.
    for (const original of ORIGINAL_TEMPLATES) {
      const progression = progressionById(original.id);
      if (!progression) continue;
      progression.steps.forEach((step, i) => {
        if (step.quality === undefined) {
          expect(SCALES[progression.referenceScale].triadQualities[step.degree]).toBe(
            original.relativeChords[i].quality,
          );
        }
      });
    }
  });
});

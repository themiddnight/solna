import { describe, expect, test } from 'bun:test';
import {
  SIMPLE_CONTROL_IDS,
  readSubtractiveSimple,
  simpleFeelSummary,
  writeSubtractiveSimple,
  type SimpleControlId,
} from './subtractiveSimple';
import { oscillatorBalance, SYNTH_GAIN_FLOOR_DB } from './synthPatch';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import type { ActiveSynth } from '@/types/synth';

/**
 * The Simple view is a LOSSLESS projection of the same patch Pro edits: every
 * control but Shape reads and writes exactly one canonical parameter, and Shape
 * is the documented reversible two-level equal-power transform over the two
 * oscillator levels.
 *
 * A fresh clone per test, because these assertions are about reference identity
 * and a shared module-scope fixture would let one test's write be visible to
 * the next.
 */
function fixture(): ActiveSynth<'subtractive'> {
  const base = structuredClone(SUBTRACTIVE_INIT);
  // Values pulled away from the Init preset's resting state so a read that
  // returned a default instead of the patch would be visible.
  base.patch.common.stereoWidth = 0.82;
  base.patch.common.unisonDetuneCents = 37;
  base.patch.synth.filter.cutoffHz = 3200;
  base.patch.synth.filter.resonance = 0.38;
  base.patch.synth.ampEnvelope.attack = 0.04;
  base.patch.synth.ampEnvelope.release = 0.6;
  base.patch.synth.lfo.depth = 0.34;
  base.patch.synth.utility.subLevelDb = -18;
  base.patch.synth.oscillators[1].levelDb = -6;
  return base;
}

/** The canonical parameter each control is a view of, read out of a patch. */
const CANONICAL: Record<SimpleControlId, (s: ActiveSynth<'subtractive'>) => number> = {
  shape: (s) =>
    oscillatorBalance({
      osc1Db: s.patch.synth.oscillators[0].levelDb,
      osc2Db: s.patch.synth.oscillators[1].levelDb,
    }),
  weight: (s) => s.patch.synth.utility.subLevelDb,
  brightness: (s) => s.patch.synth.filter.cutoffHz,
  bite: (s) => s.patch.synth.filter.resonance,
  attack: (s) => s.patch.synth.ampEnvelope.attack,
  tail: (s) => s.patch.synth.ampEnvelope.release,
  movement: (s) => s.patch.synth.lfo.depth,
  width: (s) => s.patch.common.stereoWidth,
};

describe('readSubtractiveSimple', () => {
  test('every reading is its canonical parameter, unconverted', () => {
    const synth = fixture();
    const reading = readSubtractiveSimple(synth);
    for (const id of SIMPLE_CONTROL_IDS) {
      expect(reading[id].value).toBe(CANONICAL[id](synth));
    }
  });

  test('the eight controls are exactly the approved set', () => {
    expect([...SIMPLE_CONTROL_IDS]).toEqual([
      'shape',
      'weight',
      'brightness',
      'bite',
      'attack',
      'tail',
      'movement',
      'width',
    ]);
  });

  test('descriptors are derived from the value, never stored', () => {
    const synth = fixture();
    expect(readSubtractiveSimple(synth).brightness.descriptor).toBe('Open');

    const dark = writeSubtractiveSimple(synth, 'brightness', 300);
    const bright = writeSubtractiveSimple(synth, 'brightness', 12_000);
    expect(readSubtractiveSimple(dark).brightness.descriptor).toBe('Dark');
    expect(readSubtractiveSimple(bright).brightness.descriptor).toBe('Bright');

    // Nothing a descriptor is spelled with reaches the patch: the written
    // patch is the fixture with one number changed and no extra key.
    const expected = structuredClone(synth);
    expected.patch.synth.filter.cutoffHz = 300;
    expect(dark).toEqual(expected);
  });

  test('the whole vocabulary is reachable from canonical values alone', () => {
    const at = (id: SimpleControlId, value: number) =>
      readSubtractiveSimple(writeSubtractiveSimple(fixture(), id, value))[id].descriptor;

    expect(at('weight', SYNTH_GAIN_FLOOR_DB)).toBe('Light');
    expect(at('weight', -20)).toBe('Full');
    expect(at('weight', -4)).toBe('Heavy');

    expect(at('bite', 0.05)).toBe('Smooth');
    expect(at('bite', 0.38)).toBe('Warm');
    expect(at('bite', 0.9)).toBe('Sharp');

    expect(at('attack', 0.004)).toBe('Instant');
    expect(at('attack', 0.05)).toBe('Quick');
    expect(at('attack', 1.5)).toBe('Soft');

    expect(at('tail', 0.08)).toBe('Short');
    expect(at('tail', 0.6)).toBe('Natural');
    expect(at('tail', 3)).toBe('Lasting');

    expect(at('movement', 0)).toBe('Still');
    expect(at('movement', 0.34)).toBe('Gentle');
    expect(at('movement', 0.8)).toBe('Strong');

    expect(at('width', 0.1)).toBe('Centred');
    expect(at('width', 0.5)).toBe('Spacious');
    expect(at('width', 0.82)).toBe('Wide');
  });

  /**
   * Shape names the waveform actually carrying the sound, which is the only
   * honest three-band phrase for a balance: at either end one layer IS the
   * sound, and only the middle is a blend.
   */
  test('Shape names the dominant layer, and Blended between them', () => {
    const synth = fixture();
    synth.patch.synth.oscillators[0].waveform = 'sawtooth';
    synth.patch.synth.oscillators[1].waveform = 'square';

    const low = writeSubtractiveSimple(synth, 'shape', 0);
    const mid = writeSubtractiveSimple(synth, 'shape', 0.5);
    const high = writeSubtractiveSimple(synth, 'shape', 1);
    expect(readSubtractiveSimple(low).shape.descriptor).toBe('Saw');
    expect(readSubtractiveSimple(mid).shape.descriptor).toBe('Blended');
    expect(readSubtractiveSimple(high).shape.descriptor).toBe('Square');
  });
});

describe('writeSubtractiveSimple', () => {
  test('Tail writes the amp release and touches no other envelope', () => {
    const synth = fixture();
    const changed = writeSubtractiveSimple(synth, 'tail', 1.2);
    expect(changed.patch.synth.ampEnvelope.release).toBe(1.2);
    expect(changed.patch.synth.modEnvelope).toBe(synth.patch.synth.modEnvelope);
    expect(changed.patch.synth.ampEnvelope.attack).toBe(synth.patch.synth.ampEnvelope.attack);
    expect(changed.patch.synth.ampEnvelope.decay).toBe(synth.patch.synth.ampEnvelope.decay);
    expect(changed.patch.synth.ampEnvelope.sustain).toBe(synth.patch.synth.ampEnvelope.sustain);
  });

  test('each control moves its own canonical parameter and no other', () => {
    for (const id of SIMPLE_CONTROL_IDS) {
      const synth = fixture();
      const before = readSubtractiveSimple(synth);
      // A target the fixture is not already sitting on, per control range.
      const target = id === 'weight' ? -30 : id === 'brightness' ? 900 : id === 'attack' ? 0.5 : id === 'tail' ? 2 : 0.25;
      const changed = writeSubtractiveSimple(synth, id, target);
      const after = readSubtractiveSimple(changed);

      for (const other of SIMPLE_CONTROL_IDS) {
        if (other === id) continue;
        // Shape is the one control whose write touches a pair of fields; no
        // OTHER control may disturb it either.
        expect(after[other].value).toBe(before[other].value);
      }
      expect(after[id].value).toBeCloseTo(target, 6);
    }
  });

  test('the source patch is never mutated', () => {
    const synth = fixture();
    const snapshot = structuredClone(synth);
    for (const id of SIMPLE_CONTROL_IDS) {
      writeSubtractiveSimple(synth, id, 0.3);
    }
    expect(synth).toEqual(snapshot);
  });

  /**
   * The reference-identity rule the engine's change detection depends on:
   * everything a control did not write comes back as the SAME object, not an
   * equal copy.
   */
  test('every unrelated patch branch retains reference identity', () => {
    const branches: Record<string, (s: ActiveSynth<'subtractive'>) => unknown> = {
      common: (s) => s.patch.common,
      oscillators: (s) => s.patch.synth.oscillators,
      osc1: (s) => s.patch.synth.oscillators[0],
      osc2: (s) => s.patch.synth.oscillators[1],
      utility: (s) => s.patch.synth.utility,
      filter: (s) => s.patch.synth.filter,
      ampEnvelope: (s) => s.patch.synth.ampEnvelope,
      modEnvelope: (s) => s.patch.synth.modEnvelope,
      env2Routes: (s) => s.patch.synth.env2Routes,
      lfo: (s) => s.patch.synth.lfo,
    };
    const touched: Record<SimpleControlId, readonly string[]> = {
      shape: ['oscillators', 'osc1', 'osc2'],
      weight: ['utility'],
      brightness: ['filter'],
      bite: ['filter'],
      attack: ['ampEnvelope'],
      tail: ['ampEnvelope'],
      movement: ['lfo'],
      width: ['common'],
    };

    for (const id of SIMPLE_CONTROL_IDS) {
      const synth = fixture();
      const changed = writeSubtractiveSimple(synth, id, 0.3);
      for (const [name, read] of Object.entries(branches)) {
        if (touched[id].includes(name)) continue;
        expect(read(changed)).toBe(read(synth));
      }
      expect(changed.engine).toBe(synth.engine);
      expect(changed.sourcePresetId).toBe(synth.sourcePresetId);
    }
  });

});

describe('Shape, the one control that writes two fields', () => {
  test('it is an equal-power crossfade that round-trips and preserves loudness', () => {
    const synth = fixture();
    const power = (s: ActiveSynth<'subtractive'>) =>
      10 ** (s.patch.synth.oscillators[0].levelDb / 10) +
      10 ** (s.patch.synth.oscillators[1].levelDb / 10);

    // 0 and 1 INCLUDED: they are where `gainToDb` clamps a zero-power side to
    // the floor, so an endpoint the loop skipped was exactly the case that
    // could round-trip wrongly — and exactly where Shape used to mute the patch.
    for (const balance of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const changed = writeSubtractiveSimple(synth, 'shape', balance);
      expect(readSubtractiveSimple(changed).shape.value).toBeCloseTo(balance, 6);
      expect(power(changed)).toBeCloseTo(power(synth), 6);
    }

    // Reversible: back to where it started is back to the same reading.
    const there = writeSubtractiveSimple(synth, 'shape', 0.8);
    const back = writeSubtractiveSimple(there, 'shape', readSubtractiveSimple(synth).shape.value);
    expect(readSubtractiveSimple(back).shape.value).toBeCloseTo(
      readSubtractiveSimple(synth).shape.value,
      6,
    );
  });

  test('it writes the two levels and their enablement, never tuning', () => {
    const synth = fixture();
    const changed = writeSubtractiveSimple(synth, 'shape', 0.4);
    for (const i of [0, 1] as const) {
      const before = synth.patch.synth.oscillators[i];
      const after = changed.patch.synth.oscillators[i];
      expect(after.waveform).toBe(before.waveform);
      expect(after.octave).toBe(before.octave);
      expect(after.semitone).toBe(before.semitone);
      expect(after.fineCents).toBe(before.fineCents);
    }
  });

  /**
   * The defect this test replaces a pin on: `enabled: false` is how this model
   * spells a level of silence, so Shape has to move it with the level. Init
   * ships oscillator 2 switched off at the gain floor, and writing the balance
   * onto it without the flag put every bit of power on a dead oscillator and
   * dropped the live one to the floor — a knob that muted the instrument.
   */
  test('it can never leave the patch silent, from any preset at any balance', () => {
    const audible = (s: ActiveSynth<'subtractive'>) =>
      s.patch.synth.oscillators.some((o) => o.enabled && o.levelDb > SYNTH_GAIN_FLOOR_DB);

    // The real Init preset, not the doctored fixture: osc 2 is `enabled: false`
    // at the floor, which is the shape that made this reachable.
    for (const start of [structuredClone(SUBTRACTIVE_INIT), fixture()]) {
      expect(audible(start)).toBe(true);
      for (const balance of [0, 0.25, 0.5, 0.75, 1]) {
        expect(audible(writeSubtractiveSimple(start, 'shape', balance))).toBe(true);
      }
    }
  });

  test('enablement follows the level in both directions, so the patch round-trips', () => {
    const start = structuredClone(SUBTRACTIVE_INIT);
    expect(start.patch.synth.oscillators[1].enabled).toBe(false);

    const swapped = writeSubtractiveSimple(start, 'shape', 1);
    expect(swapped.patch.synth.oscillators[1].enabled).toBe(true);
    // The side that lost all its power is switched OFF, not left on at silence.
    expect(swapped.patch.synth.oscillators[0].enabled).toBe(false);
    expect(swapped.patch.synth.oscillators[0].levelDb).toBe(SYNTH_GAIN_FLOOR_DB);

    const back = writeSubtractiveSimple(swapped, 'shape', 0);
    expect(back.patch.synth.oscillators[0].enabled).toBe(true);
    expect(back.patch.synth.oscillators[1].enabled).toBe(false);
    expect(back.patch.synth.oscillators[0].levelDb).toBeCloseTo(
      start.patch.synth.oscillators[0].levelDb,
      6,
    );
  });

});

describe('the three spread-ish names stay apart', () => {
  /**
   * Simple has no control over unison detune at all — Pro's "Spread". The
   * three spread-ish names drifted into each other once; this is the guard
   * that they cannot again.
   */
  test('no Simple control reaches unison detune', () => {
    for (const id of SIMPLE_CONTROL_IDS) {
      const synth = fixture();
      const changed = writeSubtractiveSimple(synth, id, 0.3);
      expect(changed.patch.common.unisonDetuneCents).toBe(37);
    }
  });

  test('Width writes stereoWidth, the same parameter Pro Width writes', () => {
    const synth = fixture();
    const changed = writeSubtractiveSimple(synth, 'width', 0.22);
    expect(changed.patch.common.stereoWidth).toBe(0.22);
    expect(changed.patch.common.unisonDetuneCents).toBe(synth.patch.common.unisonDetuneCents);
    expect(changed.patch.common.unisonVoices).toBe(synth.patch.common.unisonVoices);
    expect(changed.patch.common.voiceMode).toBe(synth.patch.common.voiceMode);
  });
});

describe('simpleFeelSummary', () => {
  test('the header summary is derived from width and brightness', () => {
    const synth = fixture();
    expect(simpleFeelSummary(synth)).toBe('Wide & rounded');

    const centredDark = writeSubtractiveSimple(
      writeSubtractiveSimple(synth, 'width', 0.1),
      'brightness',
      300,
    );
    expect(simpleFeelSummary(centredDark)).toBe('Centred & muted');

    const spaciousVivid = writeSubtractiveSimple(
      writeSubtractiveSimple(synth, 'width', 0.5),
      'brightness',
      9000,
    );
    expect(simpleFeelSummary(spaciousVivid)).toBe('Spacious & vivid');
  });

  /**
   * The summary's first word IS the Width badge's word, not a synonym for it:
   * both state the same number, and a header reading "Focused" over a badge
   * reading "Centred" would leave a reader deciding which to believe.
   */
  test('the spread word is always the Width control own phrase', () => {
    for (const width of [0, 0.1, 0.2, 0.5, 0.69, 0.7, 1]) {
      const synth = writeSubtractiveSimple(fixture(), 'width', width);
      const badge = readSubtractiveSimple(synth).width.descriptor;
      expect(simpleFeelSummary(synth).startsWith(`${badge} &`)).toBe(true);
    }
  });
});

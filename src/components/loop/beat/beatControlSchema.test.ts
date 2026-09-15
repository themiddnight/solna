import { describe, expect, test } from 'bun:test';
import { BEAT_PRESETS, BEAT_VOICE_IDS } from '@/data/beatPresets';
import {
  BEAT_CONTROL_SCHEMA,
  BEAT_CONTROL_UNITS,
  BEAT_FILTER_CONTROLS,
  formatBeatValue,
  readBeatParam,
} from './beatControlSchema';
import type { BeatControl } from './beatControlSchema';
import type { BeatVoiceId } from '@/types';

/**
 * The schema is the ONLY parameter roster the Beat editor walks, so the one
 * question worth asking of it is whether it covers the stored shape exactly:
 * a key the schema forgets is a parameter with no knob and no error, and a key
 * it invents is a knob that writes a field nothing reads.
 *
 * The stored shape is read off a factory patch rather than re-listed here — a
 * second hand-written roster would be exactly the drift this asserts against.
 */
const storedKeys = (voice: BeatVoiceId): string[] =>
  Object.keys(BEAT_PRESETS[0].patch.voices[voice]).sort();

const schemaKeys = (voice: BeatVoiceId): string[] => {
  const { primary, more } = BEAT_CONTROL_SCHEMA[voice];
  return [...primary, ...more].map((c) => c.key).sort();
};

const allControls = (voice: BeatVoiceId): readonly BeatControl[] => [
  ...BEAT_CONTROL_SCHEMA[voice].primary,
  ...BEAT_CONTROL_SCHEMA[voice].more,
];

describe('BEAT_CONTROL_SCHEMA exhaustiveness', () => {
  test('every voice is in the schema, in canonical roster order', () => {
    expect(Object.keys(BEAT_CONTROL_SCHEMA)).toEqual([...BEAT_VOICE_IDS]);
  });

  for (const voice of BEAT_VOICE_IDS) {
    test(`${voice}: Primary + More is exactly the stored parameter set`, () => {
      expect(schemaKeys(voice)).toEqual(storedKeys(voice));
    });

    test(`${voice}: no parameter key appears twice`, () => {
      const keys = [...allControls(voice)].map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    test(`${voice}: every Primary control is outside More`, () => {
      const more = new Set(BEAT_CONTROL_SCHEMA[voice].more.map((c) => c.key));
      for (const control of BEAT_CONTROL_SCHEMA[voice].primary) {
        expect(more.has(control.key)).toBe(false);
      }
    });
  }

  // `outputTrimDb` is measured calibration metadata on the PATCH, not a voice
  // field, and it is not user-editable. It cannot reach a control by accident,
  // so this asserts the intent rather than the type: a control named for it
  // would be a knob that detunes the app's level calibration.
  test('no control edits hidden calibration or provenance', () => {
    for (const voice of BEAT_VOICE_IDS) {
      for (const control of allControls(voice)) {
        expect(control.key).not.toBe('outputTrimDb');
        expect(control.key).not.toBe('basePresetId');
      }
    }
  });
});

/**
 * Disclosure is the spec's literal list, not a derived rule: only the two
 * hats have no `reverbSend` at all and no other denser control, so they are
 * the only voices with an empty More group. Every other voice discloses
 * `reverbSend` under More alongside whatever less frequently adjusted
 * partial, start-frequency and component controls it already had there —
 * a mix decision belongs beside those, not on the card a user sees first.
 */
describe('BEAT_CONTROL_SCHEMA disclosure', () => {
  const EMPTY_MORE: BeatVoiceId[] = ['hihat', 'openhat'];
  const HAS_MORE: BeatVoiceId[] = [
    'kick',
    'snare',
    'rimshot',
    'clap',
    'hitom',
    'lowtom',
    'ride',
    'crash',
    'bell',
  ];

  test('the two lists together are the whole roster', () => {
    expect([...EMPTY_MORE, ...HAS_MORE].sort()).toEqual([...BEAT_VOICE_IDS].sort());
  });

  for (const voice of EMPTY_MORE) {
    test(`${voice} has no More group`, () => {
      expect(BEAT_CONTROL_SCHEMA[voice].more).toEqual([]);
    });
  }

  for (const voice of HAS_MORE) {
    test(`${voice} discloses its denser controls under More`, () => {
      expect(BEAT_CONTROL_SCHEMA[voice].more.length).toBeGreaterThan(0);
      expect(BEAT_CONTROL_SCHEMA[voice].primary.length).toBeGreaterThan(0);
    });
  }
});

describe('BEAT_CONTROL_SCHEMA units, ranges and scales', () => {
  for (const voice of BEAT_VOICE_IDS) {
    test(`${voice}: every descriptor is a usable knob range`, () => {
      for (const control of allControls(voice)) {
        expect(control.label.length).toBeGreaterThan(0);
        expect(BEAT_CONTROL_UNITS).toContain(control.unit);
        expect(Number.isFinite(control.min)).toBe(true);
        expect(Number.isFinite(control.max)).toBe(true);
        expect(control.max).toBeGreaterThan(control.min);
        expect(control.step).toBeGreaterThan(0);
        expect(['linear', 'log']).toContain(control.scale);
        // A log taper has no value at zero — `valueToT` divides by `min`.
        if (control.scale === 'log') expect(control.min).toBeGreaterThan(0);
      }
    });

    test(`${voice}: unit and scale follow the spec's one rule per unit`, () => {
      for (const control of allControls(voice)) {
        // Hz and time are perceptually logarithmic and are tapered; percent is
        // a plain 0..1 fraction, so a log taper there would only mean a knob
        // that cannot reach zero.
        if (control.unit === 'percent') {
          expect(control.scale).toBe('linear');
          expect(control.min).toBe(0);
          expect(control.max).toBe(1);
        } else {
          expect(control.scale).toBe('log');
        }
      }
    });

    /**
     * The range test that cannot pass vacuously: every value the thirteen
     * factory patches actually hold must be reachable on its own knob. A
     * descriptor whose range excludes the sound the preset ships with would
     * clamp the patch the moment the knob was touched.
     */
    test(`${voice}: every factory value lies inside its control's range`, () => {
      for (const preset of BEAT_PRESETS) {
        for (const control of allControls(voice)) {
          const value = readBeatParam(preset.patch.voices, voice, control.key);
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(control.min);
          expect(value).toBeLessThanOrEqual(control.max);
        }
      }
    });
  }

  // Snare and rimshot are one parameter family (`BeatSnareParams`), as are the
  // two hats and the two toms. Their schemas are the same table, so a range
  // widened for one voice can never leave its twin behind.
  test('voices sharing a parameter family share one control table', () => {
    expect(BEAT_CONTROL_SCHEMA.rimshot).toBe(BEAT_CONTROL_SCHEMA.snare);
    expect(BEAT_CONTROL_SCHEMA.openhat).toBe(BEAT_CONTROL_SCHEMA.hihat);
    expect(BEAT_CONTROL_SCHEMA.lowtom).toBe(BEAT_CONTROL_SCHEMA.hitom);
  });
});

describe('formatBeatValue', () => {
  test('frequency reads in Hz and rolls over to kHz', () => {
    expect(formatBeatValue('hz', 440)).toBe('440 Hz');
    expect(formatBeatValue('hz', 4400)).toBe('4.4 kHz');
  });

  test('time reads in ms below a second and in seconds above it', () => {
    expect(formatBeatValue('time', 0.018)).toBe('18 ms');
    expect(formatBeatValue('time', 1.5)).toBe('1.50 s');
  });

  test('linear gain, send and balance read as percent', () => {
    expect(formatBeatValue('percent', 0)).toBe('0%');
    expect(formatBeatValue('percent', 0.45)).toBe('45%');
    expect(formatBeatValue('percent', 1)).toBe('100%');
  });

  test('every descriptor formats in the unit it declares', () => {
    for (const voice of BEAT_VOICE_IDS) {
      for (const control of allControls(voice)) {
        const text = control.format(readBeatParam(BEAT_PRESETS[0].patch.voices, voice, control.key));
        if (control.unit === 'hz') expect(text.endsWith('Hz')).toBe(true);
        if (control.unit === 'time') expect(/(ms|s)$/.test(text)).toBe(true);
        if (control.unit === 'percent') expect(text.endsWith('%')).toBe(true);
      }
    }
  });
});

/**
 * The bus filter's two knobs are descriptors like every other, so they are held
 * to the same containment rule. Inline on the panel they were not: a range that
 * stopped short of the shipped 12 kHz cutoff would have clamped every factory
 * patch on first touch, with nothing failing anywhere.
 */
describe('BEAT_FILTER_CONTROLS', () => {
  test('names exactly the filter fields a knob can edit', () => {
    expect(BEAT_FILTER_CONTROLS.map((c) => c.key)).toEqual(['cutoff', 'resonance']);
    // `type` is a three-way switch, not a knob: it has no range to contain.
    expect(BEAT_FILTER_CONTROLS.some((c) => c.key === 'type')).toBe(false);
  });

  test('is a usable knob range, and Q keeps the linear taper it shipped with', () => {
    for (const control of BEAT_FILTER_CONTROLS) {
      expect(BEAT_CONTROL_UNITS).toContain(control.unit);
      expect(control.max).toBeGreaterThan(control.min);
      expect(control.step).toBeGreaterThan(0);
      if (control.scale === 'log') expect(control.min).toBeGreaterThan(0);
    }
    expect(BEAT_FILTER_CONTROLS.find((c) => c.key === 'resonance')?.scale).toBe('linear');
    expect(BEAT_FILTER_CONTROLS.find((c) => c.key === 'cutoff')?.scale).toBe('log');
  });

  test('every factory filter value lies inside its control range', () => {
    for (const preset of BEAT_PRESETS) {
      for (const control of BEAT_FILTER_CONTROLS) {
        const value = (preset.patch.filter as unknown as Record<string, number>)[control.key];
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(control.min);
        expect(value).toBeLessThanOrEqual(control.max);
      }
    }
  });

  test('reads in the SAME formatters the voice knobs use', () => {
    for (const control of BEAT_FILTER_CONTROLS) {
      const value = (BEAT_PRESETS[0].patch.filter as unknown as Record<string, number>)[control.key];
      expect(control.format(value)).toBe(formatBeatValue(control.unit, value));
    }
    // The disagreement this replaced: the panel's own `${Math.round(v)} Hz`
    // rendered `12000 Hz` where every other frequency in the editor rolls over.
    expect(formatBeatValue('hz', 12000)).toBe('12 kHz');
  });
});

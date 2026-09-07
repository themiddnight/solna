import { describe, expect, test } from 'bun:test';
import { SYNTH_PRESETS } from './synthPresets';
import { presetById } from '@/audio/presetRegistry';

/**
 * The five patches that used to be FACTORY_BASS_PRESETS, pinned by id.
 *
 * Written out rather than derived with `.filter(p => p.category === 'Bass')`:
 * four `factory-` presets are also category Bass, so a filter would assert 9
 * and change the value this test has always pinned. The id list is what makes
 * "the five bass patches survived the merge" checkable at all.
 */
const BASS_PRESET_IDS = [
  'bass-deep-sine',
  'bass-round-pluck',
  'bass-punchy-square',
  'bass-saw-growl',
  'bass-warm-tri',
];

describe('bass presets', () => {
  test('every bass preset is category Bass', () => {
    // VibeSpec.bassPresetId is documented as having to resolve to category
    // 'Bass'; a mis-categorised preset makes a vibe load a lead patch onto the
    // bass bus.
    for (const id of BASS_PRESET_IDS) {
      const p = SYNTH_PRESETS.find((entry) => entry.id === id);
      expect(p, id).toBeDefined();
      expect(p!.category, p!.name).toBe('Bass');
    }
    expect(BASS_PRESET_IDS.length).toBe(5);
  });

  test('ids are unique across the whole factory library', () => {
    const ids = SYNTH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no preset pins its own name into params.preset', () => {
    // Every merge site overwrites it with the preset's name anyway; carrying a
    // copy in the data means two places to keep in sync for zero effect.
    for (const p of SYNTH_PRESETS) {
      expect(p.params.preset, p.name).toBeUndefined();
    }
  });

  test('the merged library is 29 entries', () => {
    // 24 factory + 5 bass. A count, not a cap: it is here so that adding a
    // preset is a deliberate two-line change rather than an accident of a
    // merge conflict.
    expect(SYNTH_PRESETS.length).toBe(29);
  });
});

describe('preset library invariants', () => {
  test('every preset name in SYNTH_PRESETS is unique', () => {
    // resolveVibeSynthParams stamps the resolved preset's *name* into
    // params.preset, and the preset library UI selects a preset back by name
    // via findPresetByName. A duplicate name would make a vibe silently
    // highlight the wrong patch in the picker.
    const names = SYNTH_PRESETS.map((p) => p.name);
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });

  test('no preset bakes arpeggiator settings into its params', () => {
    // Arp is a performance setting the user drives from the UI, not a timbre:
    // a preset carrying it would arpeggiate in every role it was reused for.
    const ARP_FIELDS = ['arpActive', 'arpMode', 'arpRate', 'arpOctaves'] as const;
    const offenders: string[] = [];
    for (const preset of SYNTH_PRESETS) {
      for (const field of ARP_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(preset.params, field)) {
          offenders.push(`${preset.id}.${field}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('factory-neon-poly-saw', () => {
  // 118 BPM (synthwave-80s) -> one eighth note is 60/118/2 ≈ 0.254 s.
  const EIGHTH_AT_118 = 60 / 118 / 2;

  test('is a Pad-category detuned saw', () => {
    const p = presetById('factory-neon-poly-saw');
    expect(p).toBeDefined();
    expect(p!.category).toBe('Pad');
    expect(p!.params.oscType).toBe('sawtooth');
    expect(p!.params.detune).toBe(15);
  });

  test('reaches full level well inside one eighth note at 118 BPM', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.attack! < EIGHTH_AT_118).toBe(true);
  });

  test('releases longer than the note gap so consecutive stabs glue into a bed', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.release! >= EIGHTH_AT_118).toBe(true);
  });

  test('gets its brightness from the filter envelope, not a permanently open cutoff', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.filterCutoff).toBe(2600);
    expect(p.params.filterEnvAmount).toBe(1200);
    // must stay under factory-hyper-saw-lead, which is this vibe's own lead
    expect(p.params.filterCutoff! < presetById('factory-hyper-saw-lead')!.params.filterCutoff!).toBe(true);
  });

  test('does not transpose, so the comp stays in its authored register', () => {
    expect(presetById('factory-neon-poly-saw')!.params.octave).toBe(0);
  });
});

describe('factory-koto-pluck', () => {
  test('is a Pluck-category triangle string body', () => {
    const p = presetById('factory-koto-pluck');
    expect(p).toBeDefined();
    expect(p!.category).toBe('Pluck');
    expect(p!.params.oscType).toBe('triangle');
  });

  test('pins a near-instant attack and a nonzero noiseVolume field', () => {
    // noiseVolume is authored data only: the engine's synth voice path never
    // reads it (only the drum path does), so it contributes no audible noise
    // burst today. This just pins the values, not a pick-transient claim.
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.attack! <= 0.005).toBe(true);
    expect(p.params.noiseVolume! > 0).toBe(true);
  });

  test('pins a filter envelope that closes well before the amp decay finishes', () => {
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.filterEnvAmount).toBe(2200);
    expect(p.params.filterSustain! <= 0.15).toBe(true);
    expect(p.params.filterDecay! < p.params.decay!).toBe(true);
  });

  test('keeps the residual ring both existing Pluck presets lack', () => {
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.sustain! > presetById('factory-pluck')!.params.sustain!).toBe(true);
    expect(p.params.sustain! > presetById('factory-trance-pluck')!.params.sustain!).toBe(true);
    // a bar at 78 BPM is 4 * 60/78 ≈ 3.08 s; decay + release must cover most of it
    expect(p.params.decay! + p.params.release! >= 2.4).toBe(true);
  });

  test('does not transpose, so the comp stays in its authored register', () => {
    expect(presetById('factory-koto-pluck')!.params.octave).toBe(0);
  });
});

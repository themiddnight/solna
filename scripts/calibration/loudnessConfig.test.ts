import { describe, expect, test } from 'bun:test';
import { mergeDrumKit } from '@/audio/drumKits';
import { DRUM_KITS, DRUM_TYPES, type DrumKit } from '@/data/drumKits';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import {
  DRUM_HASH_EXCLUDED,
  SYNTH_HASH_EXCLUDED,
  drumLoudnessHash,
  hashLoudnessConfig,
  presetLoudnessHash,
} from './loudnessConfig.ts';

describe('hashLoudnessConfig', () => {
  test('is stable across key order — a reformat must not fire the lock test', () => {
    expect(hashLoudnessConfig({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashLoudnessConfig({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  test('changes when any hashed value changes', () => {
    expect(hashLoudnessConfig({ gain: 0.9 })).not.toBe(hashLoudnessConfig({ gain: 0.91 }));
  });
});

describe('the drum hash', () => {
  test('excludes reverbSend and nothing else', () => {
    expect(DRUM_HASH_EXCLUDED).toEqual(['reverbSend']);
  });

  test('two different kits hash differently', () => {
    expect(drumLoudnessHash('Retro Drive')).not.toBe(drumLoudnessHash('808 Vintage'));
  });

  test('the kit name is inside the hash, so an entry cannot be copy-pasted between kits', () => {
    // Even were two kits' merged voices identical, their hashes must differ.
    const a = hashLoudnessConfig({ kit: 'A', voices: { kick: { gain: 0.9 } } });
    const b = hashLoudnessConfig({ kit: 'B', voices: { kick: { gain: 0.9 } } });
    expect(a).not.toBe(b);
  });

  test('is stable across repeated calls', () => {
    expect(drumLoudnessHash('Warehouse')).toBe(drumLoudnessHash('Warehouse'));
  });

  test('a change to ANY voice moves the hash, not just kick — the whole kit is one fingerprint', () => {
    // Mirrors drumLoudnessHash's own construction (merge, then omit DRUM_HASH_EXCLUDED
    // per voice) so this proves the real function's sensitivity, not a reimplementation's.
    const buildVoices = (kit: DrumKit): Record<string, unknown> => {
      const record = kit as unknown as Record<string, Record<string, unknown>>;
      const voices: Record<string, unknown> = {};
      for (const voice of DRUM_TYPES) {
        const params = { ...record[voice]! };
        for (const excluded of DRUM_HASH_EXCLUDED) delete params[excluded];
        voices[voice] = params;
      }
      return voices;
    };
    const base = mergeDrumKit(DRUM_KITS['Retro Drive']);
    const baseHash = hashLoudnessConfig({ kit: 'Retro Drive', voices: buildVoices(base) });
    expect(baseHash).toBe(drumLoudnessHash('Retro Drive'));

    // ride — not kick, not snare, not hihat — proves the fingerprint is whole-kit.
    const rideChanged: DrumKit = { ...base, ride: { ...base.ride, gain: base.ride.gain + 0.05 } };
    const rideHash = hashLoudnessConfig({ kit: 'Retro Drive', voices: buildVoices(rideChanged) });
    expect(rideHash).not.toBe(baseHash);
  });
});

describe('the synth hash', () => {
  test('excludes the applied output gain and nothing else', () => {
    // The display name and the four arp fields used to be excluded because a
    // flat SynthParams carried them INSIDE the measured object; neither is in
    // an `EnginePatch`, so neither is here any more. `common.outputGainDb` is,
    // for a different reason: the uncalibrated measurement pass NEUTRALISES it
    // (renderOffline.ts), so it provably cannot move `measuredDbfs`. Hashing it
    // would demand a multi-minute regeneration to reproduce a number that
    // cannot have changed — and the field is already guarded, by the tolerance
    // check that reads it live.
    expect(SYNTH_HASH_EXCLUDED).toEqual(['outputGainDb']);
  });

  test('retuning the applied output gain does NOT move the hash', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    const louder = structuredClone(base);
    louder.patch.common.outputGainDb = base.patch.common.outputGainDb + 4;
    expect(presetLoudnessHash(louder)).toBe(presetLoudnessHash(base));
  });

  test('every OTHER common field still moves the hash — the exclusion is one field, not the block', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    const wider = structuredClone(base);
    wider.patch.common.stereoWidth = base.patch.common.stereoWidth === 1 ? 0.5 : 1;
    expect(presetLoudnessHash(wider)).not.toBe(presetLoudnessHash(base));
  });

  test('a patch is hashed by value, so a copy of one entry hashes as that entry', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    expect(presetLoudnessHash({ ...base, patch: structuredClone(base.patch) }))
      .toBe(presetLoudnessHash(base));
  });

  test('a rename does not change the hash', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    expect(presetLoudnessHash({ ...base, name: 'Renamed' })).toBe(presetLoudnessHash(base));
  });

  test('a filter cutoff change DOES change the hash — ebur128 is K-weighted, so spectrum is level', () => {
    const base = SYNTH_PRESETS[0];
    if (!base) throw new Error('Unreachable: SYNTH_PRESETS is non-empty');
    const brighter = structuredClone(base);
    brighter.patch.synth.filter.cutoffHz = 9000;
    expect(presetLoudnessHash(brighter)).not.toBe(presetLoudnessHash(base));
  });

  test('every factory preset produces a distinct hash', () => {
    const hashes = SYNTH_PRESETS.map((preset) => presetLoudnessHash(preset));
    expect(new Set(hashes).size).toBe(SYNTH_PRESETS.length);
  });
});

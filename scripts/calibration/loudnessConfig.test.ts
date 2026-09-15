import { describe, expect, test } from 'bun:test';
import { BEAT_PRESETS, BEAT_VOICE_IDS } from '@/data/beatPresets';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import type { BeatVoices } from '@/types';
import {
  BEAT_HASH_EXCLUDED,
  SYNTH_HASH_EXCLUDED,
  beatLoudnessHash,
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

describe('the beat hash', () => {
  test('excludes reverbSend and nothing else', () => {
    expect(BEAT_HASH_EXCLUDED).toEqual(['reverbSend']);
  });

  test('two different presets hash differently', () => {
    expect(beatLoudnessHash('retro-drive')).not.toBe(beatLoudnessHash('808-vintage'));
  });

  test('every factory preset produces a distinct hash', () => {
    const hashes = BEAT_PRESETS.map((preset) => beatLoudnessHash(preset.id));
    expect(new Set(hashes).size).toBe(BEAT_PRESETS.length);
  });

  test('the preset id is inside the hash, so an entry cannot be copy-pasted between presets', () => {
    // Even were two presets' voices identical, their hashes must differ.
    const a = hashLoudnessConfig({ preset: 'a', voices: { kick: { gain: 0.9 } } });
    const b = hashLoudnessConfig({ preset: 'b', voices: { kick: { gain: 0.9 } } });
    expect(a).not.toBe(b);
  });

  test('an unknown id throws rather than hashing nothing', () => {
    expect(() => beatLoudnessHash('no-such-preset')).toThrow();
  });

  test('is stable across repeated calls', () => {
    expect(beatLoudnessHash('warehouse')).toBe(beatLoudnessHash('warehouse'));
  });

  test('retuning the embedded output trim does NOT move the hash', () => {
    // The uncalibrated render withholds it, exactly as it neutralises the
    // synth half's `common.outputGainDb`, so it provably cannot move the
    // measurement. The lock test is what guards it instead.
    const preset = BEAT_PRESETS[0];
    if (!preset) throw new Error('Unreachable: BEAT_PRESETS is non-empty');
    const before = beatLoudnessHash(preset.id);
    const original = preset.patch.outputTrimDb;
    (preset.patch as { outputTrimDb: number }).outputTrimDb = original + 4;
    try {
      expect(beatLoudnessHash(preset.id)).toBe(before);
    } finally {
      (preset.patch as { outputTrimDb: number }).outputTrimDb = original;
    }
  });

  test('a change to ANY voice moves the hash, not just kick — the whole patch is one fingerprint', () => {
    // Mirrors beatLoudnessHash's own construction (omit BEAT_HASH_EXCLUDED per
    // voice) so this proves the real function's sensitivity, not a
    // reimplementation's.
    const preset = BEAT_PRESETS[0];
    if (!preset) throw new Error('Unreachable: BEAT_PRESETS is non-empty');
    const buildVoices = (voices: BeatVoices): Record<string, unknown> => {
      const record = voices as unknown as Record<string, Record<string, unknown>>;
      const built: Record<string, unknown> = {};
      for (const voice of BEAT_VOICE_IDS) {
        const params = { ...record[voice]! };
        for (const excluded of BEAT_HASH_EXCLUDED) delete params[excluded];
        built[voice] = params;
      }
      return built;
    };
    const base = structuredClone(preset.patch.voices);
    const baseHash = hashLoudnessConfig({
      preset: preset.id,
      filter: preset.patch.filter,
      voices: buildVoices(base),
    });
    expect(baseHash).toBe(beatLoudnessHash(preset.id));

    // ride — not kick, not snare, not hihat — proves the fingerprint is whole-patch.
    const rideChanged: BeatVoices = { ...base, ride: { ...base.ride, gain: base.ride.gain + 0.05 } };
    const rideHash = hashLoudnessConfig({
      preset: preset.id,
      filter: preset.patch.filter,
      voices: buildVoices(rideChanged),
    });
    expect(rideHash).not.toBe(baseHash);
  });

  test('the bus filter is inside the hash — a filtered patch measures differently', () => {
    const preset = BEAT_PRESETS[0];
    if (!preset) throw new Error('Unreachable: BEAT_PRESETS is non-empty');
    const open = beatLoudnessHash(preset.id);
    const original = preset.patch.filter.cutoff;
    preset.patch.filter.cutoff = 400;
    try {
      expect(beatLoudnessHash(preset.id)).not.toBe(open);
    } finally {
      preset.patch.filter.cutoff = original;
    }
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

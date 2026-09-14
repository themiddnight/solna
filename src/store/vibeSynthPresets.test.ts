import { describe, expect, test } from 'bun:test';
import { resolveVibeSynthParams } from './vibes';
import { TRACK_SYNTH_DEFAULTS } from '@/store/initialState';
import { presetById } from '@/utils/synthPresets';

/**
 * A vibe voices a track by naming a library preset, and now that every entry
 * is a complete patch that is exactly what it installs — the preset's own
 * sound, on the bus the vibe asked for.
 *
 * The interim version of this resolver installed the TARGET's factory patch
 * and merely recorded the requested id as provenance, because the flat library
 * could not produce an `ActiveSynth` at all. The tests below are what make
 * that shortcut impossible to reintroduce: an id now has to change the sound.
 */
describe('resolveVibeSynthParams', () => {
  test('installs the named preset’s own complete patch', () => {
    const preset = presetById('factory-mellow-epiano')!;
    const resolved = resolveVibeSynthParams('factory-mellow-epiano', 'chord');
    expect(resolved.patch).toEqual(preset.patch);
    expect(resolved.engine).toBe(preset.engine);
  });

  test('the same id gives the same sound on every bus', () => {
    // The interim resolver answered per TARGET, so a bass id on the pad bus
    // produced the pad's default patch. A preset is a sound, not a role.
    const bass = resolveVibeSynthParams('bass-deep-sine', 'bass');
    const pad = resolveVibeSynthParams('bass-deep-sine', 'pad');
    expect(bass.patch).toEqual(pad.patch);
    expect(bass.patch).toEqual(presetById('bass-deep-sine')!.patch);
  });

  test('two different ids give two different sounds', () => {
    const lead = resolveVibeSynthParams('factory-hyper-saw-lead', 'synth');
    const keys = resolveVibeSynthParams('factory-glocken-bell', 'synth');
    expect(lead.patch).not.toEqual(keys.patch);
  });

  test('records the preset it resolved as display provenance', () => {
    expect(resolveVibeSynthParams('factory-mellow-epiano', 'chord').sourcePresetId)
      .toBe('factory-mellow-epiano');
    expect(resolveVibeSynthParams('bass-deep-sine', 'bass').sourcePresetId).toBe('bass-deep-sine');
  });

  test('returns an engine-tagged patch the voice manager can actually build', () => {
    const resolved = resolveVibeSynthParams('factory-hyper-saw-lead', 'synth');
    expect(resolved.engine).toBe('subtractive');
    expect(resolved.patch.synth.oscillators).toHaveLength(2);
  });

  test('hands back a copy, so applying a vibe can never edit the library', () => {
    const a = resolveVibeSynthParams('bass-deep-sine', 'bass');
    a.patch.synth.filter.cutoffHz = 9_999;
    expect(presetById('bass-deep-sine')!.patch.synth.filter.cutoffHz).not.toBe(9_999);
  });

  test('carries no Arp at all — a vibe states that separately', () => {
    // Not "arp is off" but "arp is unreachable from here": Arp lives beside
    // the patch, so a resolver that only produces a patch cannot arm it.
    for (const id of ['factory-dream-keys', 'factory-glocken-bell', 'factory-pluck', 'bass-warm-tri']) {
      const resolved = resolveVibeSynthParams(id, 'synth') as unknown as Record<string, unknown>;
      expect(`${id}:${'arpActive' in resolved}`).toBe(`${id}:false`);
      expect(`${id}:${'active' in (resolved.patch as Record<string, unknown>)}`).toBe(`${id}:false`);
    }
  });

  test('an id no preset carries falls back to the TARGET’s default, and does not throw', () => {
    // The design doc's rule: "Missing factory references fail data tests;
    // runtime resolution falls back to the relevant track default." The data
    // test in vibes.test.ts is what makes an authoring typo loud — at runtime
    // a vibe that half-applies because one id was wrong is worse than a vibe
    // that plays one track on its factory sound.
    const bass = resolveVibeSynthParams('factory-does-not-exist', 'bass');
    expect(bass.patch).toEqual(TRACK_SYNTH_DEFAULTS.bass.patch);
    const pad = resolveVibeSynthParams('factory-does-not-exist', 'pad');
    expect(pad.patch).toEqual(TRACK_SYNTH_DEFAULTS.pad.patch);
    // Provenance names the sound that is actually playing, never the id that
    // failed to resolve.
    expect(bass.sourcePresetId).toBe(TRACK_SYNTH_DEFAULTS.bass.sourcePresetId);
  });
});

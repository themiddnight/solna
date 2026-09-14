import { describe, expect, test } from 'bun:test';
import {
  SYNTH_CATEGORIES,
  SYNTH_PRESETS,
  SYNTH_TAGS,
  type SynthPreset,
  type SynthPresetCategory,
} from './synthPresets';
import { sanitizeActiveSynth } from '@/store/sanitizeSynth';
import { TRACK_SYNTH_PRESET_IDS } from '@/store/initialState';
import { presetById, SUBTRACTIVE_INIT, SUBTRACTIVE_INIT_PRESET_ID } from '@/utils/synthPresets';

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

/**
 * The four FX techniques the design doc lists as required fixtures, by id.
 * They are acceptance cases, not extras — Task 4's DSP tests and Task 12's
 * calibration both name the down-sweep's shape.
 */
const REQUIRED_FX_PRESET_IDS = {
  downSweep: 'factory-fx-down-sweep',
  upSweep: 'factory-fx-up-sweep',
  noiseRiser: 'factory-noise-riser-fx',
  zap: 'factory-laser-fx',
} as const;

/** Every category a FACTORY preset may claim: 'User' is the custom-save bucket. */
const FACTORY_CATEGORIES: SynthPresetCategory[] = SYNTH_CATEGORIES.map((c) => c.id).filter(
  (id) => id !== 'User',
);

function requirePreset(id: string): SynthPreset<'subtractive'> {
  const preset = SYNTH_PRESETS.find((p) => p.id === id);
  expect(preset, id).toBeDefined();
  return preset!;
}

describe('factory preset completeness', () => {
  test('every factory preset is a complete, in-range subtractive patch', () => {
    // The whole-patch validator is the contract: a preset that needs clamping
    // or falls back is not authored data, it is a guess the engine repaired.
    const offenders: string[] = [];
    for (const preset of SYNTH_PRESETS) {
      const { issues } = sanitizeActiveSynth(
        { engine: preset.engine, patch: preset.patch, sourcePresetId: preset.id },
        SUBTRACTIVE_INIT,
      );
      for (const issue of issues) offenders.push(`${preset.id}: ${issue.path} ${issue.message}`);
    }
    expect(offenders).toEqual([]);
  });

  test('a sanitized factory preset round-trips to the same patch', () => {
    for (const preset of SYNTH_PRESETS) {
      const { value } = sanitizeActiveSynth(
        { engine: preset.engine, patch: preset.patch, sourcePresetId: preset.id },
        SUBTRACTIVE_INIT,
      );
      expect(value.patch, preset.id).toEqual(preset.patch);
      expect(value.engine, preset.id).toBe(preset.engine);
    }
  });

  test('every entry declares the subtractive engine beside a subtractive patch', () => {
    for (const preset of SYNTH_PRESETS) {
      expect(preset.engine, preset.id).toBe('subtractive');
      // The discriminator is what makes the patch readable; a patch whose
      // oscillator tuple is missing would sanitize to the fallback above, but
      // a wrong discriminator would make the WHOLE entry unreadable.
      expect(preset.patch.synth.oscillators.length, preset.id).toBe(2);
    }
  });

  test('every entry carries a non-empty description and is marked factory', () => {
    for (const preset of SYNTH_PRESETS) {
      expect(preset.description.trim().length > 0, preset.id).toBe(true);
      expect(preset.isFactory, preset.id).toBe(true);
    }
  });

  test('ids and names are unique across the whole factory library', () => {
    const ids = SYNTH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // resolveVibeSynthParams records the resolved preset's id, but the picker
    // still lists presets by NAME: a duplicate name makes two cards
    // indistinguishable in the browser.
    const names = SYNTH_PRESETS.map((p) => p.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  test('no factory patch carries Arp or effect-chain state', () => {
    // Arp is performance state and effects are the master rack: a preset
    // carrying either would arpeggiate — or re-verb — every role it is reused
    // for. `patch` is `{ common, synth }` and nothing else.
    const FORBIDDEN = ['arpActive', 'arpMode', 'arpRate', 'arpOctaves', 'arp', 'effects', 'effectChainId'];
    const offenders: string[] = [];
    for (const preset of SYNTH_PRESETS) {
      expect(Object.keys(preset.patch).sort(), preset.id).toEqual(['common', 'synth']);
      for (const field of FORBIDDEN) {
        if (Object.prototype.hasOwnProperty.call(preset.patch.common, field)) {
          offenders.push(`${preset.id}.common.${field}`);
        }
        if (Object.prototype.hasOwnProperty.call(preset.patch.synth, field)) {
          offenders.push(`${preset.id}.synth.${field}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no factory preset claims the User category, and every other category is populated', () => {
    for (const preset of SYNTH_PRESETS) {
      expect(preset.category, preset.id).not.toBe('User');
    }
    for (const category of FACTORY_CATEGORIES) {
      expect(
        `${category}=${SYNTH_PRESETS.some((p) => p.category === category)}`,
      ).toBe(`${category}=true`);
    }
  });
});

describe('controlled tags', () => {
  test('every preset carries at least one tag and repeats none', () => {
    for (const preset of SYNTH_PRESETS) {
      expect(preset.tags.length > 0, preset.id).toBe(true);
      expect(new Set(preset.tags).size, preset.id).toBe(preset.tags.length);
      for (const tag of preset.tags) {
        expect(`${preset.id}:${tag}:${SYNTH_TAGS.includes(tag)}`).toBe(`${preset.id}:${tag}:true`);
      }
    }
  });

  test('no tag in the controlled set is dead', () => {
    // A vocabulary nobody uses is a vocabulary nobody maintains: the browser's
    // tag filter would offer a chip that selects nothing.
    const used = new Set(SYNTH_PRESETS.flatMap((p) => p.tags));
    expect(SYNTH_TAGS.filter((tag) => !used.has(tag))).toEqual([]);
  });

  test('voice, sub and noise tags agree with the patch they label', () => {
    // Tags are a filter over the library, so one that disagrees with the patch
    // is worse than one that is missing: it returns the wrong presets.
    const offenders: string[] = [];
    for (const p of SYNTH_PRESETS) {
      const mono = p.tags.includes('mono');
      const poly = p.tags.includes('poly');
      if (mono === poly) offenders.push(`${p.id}: exactly one of mono/poly`);
      if (mono && p.patch.common.voiceMode !== 'mono') offenders.push(`${p.id}: mono tag, poly patch`);
      if (poly && p.patch.common.voiceMode !== 'poly') offenders.push(`${p.id}: poly tag, mono patch`);
      if (p.tags.includes('unison') !== p.patch.common.unisonVoices > 1) {
        offenders.push(`${p.id}: unison tag disagrees with unisonVoices`);
      }
      if (p.tags.includes('sub-osc') !== p.patch.synth.utility.subEnabled) {
        offenders.push(`${p.id}: sub-osc tag disagrees with utility.subEnabled`);
      }
      if (p.tags.includes('noise') !== p.patch.synth.utility.noiseEnabled) {
        offenders.push(`${p.id}: noise tag disagrees with utility.noiseEnabled`);
      }
      const lfoReachesNothing = p.patch.synth.lfo.depth === 0 || p.patch.synth.lfo.route === null;
      if (p.tags.includes('static') !== lfoReachesNothing) {
        offenders.push(`${p.id}: static tag disagrees with the LFO depth/route`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the entries other code names by id', () => {
  test('the neutral init preset exists, is discoverable, and is the store-wide fallback', () => {
    const init = requirePreset(SUBTRACTIVE_INIT_PRESET_ID);
    // Discoverable through All/Search, deliberately without an Init category
    // tab of its own (design doc, "Presets, defaults, and Vibes").
    expect(FACTORY_CATEGORIES).toContain(init.category);
    expect(SUBTRACTIVE_INIT.patch).toEqual(init.patch);
    expect(SUBTRACTIVE_INIT.engine).toBe(init.engine);
    expect(SUBTRACTIVE_INIT.sourcePresetId).toBe(init.id);
  });

  test('every track default names a preset that resolves, in a fitting category', () => {
    const expected: Record<string, SynthPresetCategory[]> = {
      synth: ['Lead'],
      fx: ['FX'],
      chord: ['Keys', 'Pad', 'Pluck', 'Brass'],
      bass: ['Bass'],
      pad: ['Pad'],
    };
    for (const [target, id] of Object.entries(TRACK_SYNTH_PRESET_IDS)) {
      const preset = requirePreset(id);
      expect(expected[target], `${target} -> ${id}`).toContain(preset.category);
    }
  });

  test('the five historical bass patches are still Bass-category', () => {
    // VibeSpec.bassPresetId is documented as having to resolve to category
    // 'Bass'; a mis-categorised preset makes a vibe load a lead patch onto the
    // bass bus.
    for (const id of BASS_PRESET_IDS) {
      expect(requirePreset(id).category, id).toBe('Bass');
    }
    expect(BASS_PRESET_IDS.length).toBe(5);
  });

  test('every id is resolvable through presetById', () => {
    for (const preset of SYNTH_PRESETS) {
      expect(presetById(preset.id)?.id, preset.id).toBe(preset.id);
    }
  });
});

describe('the four required FX fixtures', () => {
  test('all four exist and are FX-category one-shots', () => {
    for (const id of Object.values(REQUIRED_FX_PRESET_IDS)) {
      const p = requirePreset(id);
      expect(p.category, id).toBe('FX');
      // A one-shot: ENV1 must not sustain, or the sweep parks at its
      // destination and never ends.
      expect(p.patch.synth.ampEnvelope.sustain, id).toBe(0);
    }
  });

  test('the down-sweep is the shape the design doc pins', () => {
    // Sine oscillator, ENV2 -> pitch-all at +48 semitones, zero attack, timed
    // decay, zero sustain, ENV1 for amplitude. Tasks 4 and 12 both assert this.
    const p = requirePreset(REQUIRED_FX_PRESET_IDS.downSweep);
    expect(p.patch.synth.oscillators[0].enabled).toBe(true);
    expect(p.patch.synth.oscillators[0].waveform).toBe('sine');
    expect(p.patch.synth.env2Routes).toEqual([
      { target: 'pitch-all', unit: 'semitones', amount: 48 },
    ]);
    expect(p.patch.synth.modEnvelope.attack).toBe(0);
    expect(p.patch.synth.modEnvelope.decay > 0).toBe(true);
    expect(p.patch.synth.modEnvelope.sustain).toBe(0);
    expect(p.patch.synth.ampEnvelope.sustain).toBe(0);
  });

  test('the up-sweep is the down-sweep mirrored, not a second down-sweep', () => {
    // ENV2 jumps the pitch DOWN at note-on and the decay walks it back up, so
    // the amount is negative. Copying the down-sweep and renaming it is the
    // failure this pins.
    const up = requirePreset(REQUIRED_FX_PRESET_IDS.upSweep);
    const pitch = up.patch.synth.env2Routes.find((r) => r.target === 'pitch-all');
    expect(pitch).toBeDefined();
    expect(pitch!.amount < 0).toBe(true);
    expect(up.patch.synth.modEnvelope.sustain).toBe(0);
  });

  test('the noise riser is carried by noise, and the zap is carried by pitch', () => {
    const riser = requirePreset(REQUIRED_FX_PRESET_IDS.noiseRiser);
    expect(riser.patch.synth.utility.noiseEnabled).toBe(true);
    // It rises by opening a filter, not by transposing: a pitch sweep on noise
    // is inaudible.
    expect(riser.patch.synth.env2Routes.some((r) => r.target === 'filter-cutoff')).toBe(true);

    const zap = requirePreset(REQUIRED_FX_PRESET_IDS.zap);
    expect(zap.patch.synth.env2Routes.some((r) => r.target === 'pitch-all')).toBe(true);
    // A zap is short: the whole gesture has to be over inside a 16th at any
    // sane tempo, which is what separates it from the down-sweep.
    expect(zap.patch.synth.ampEnvelope.decay <= 0.2).toBe(true);
  });
});

describe('the library reads as distinct instruments', () => {
  test('no two presets share the same patch body', () => {
    // Mechanical padding — copying one entry and changing its name — is the
    // failure mode the re-authoring rule exists to prevent.
    const seen = new Map<string, string>();
    const offenders: string[] = [];
    for (const p of SYNTH_PRESETS) {
      const key = JSON.stringify(p.patch);
      const prior = seen.get(key);
      if (prior) offenders.push(`${p.id} duplicates ${prior}`);
      else seen.set(key, p.id);
    }
    expect(offenders).toEqual([]);
  });

  test('the second oscillator is authored, not left at a default', () => {
    // Every entry that enables OSC 2 must give it something of its own —
    // a different waveform, a tuning offset or its own level. Two identical
    // stacked oscillators are one oscillator at +6 dB.
    const offenders: string[] = [];
    for (const p of SYNTH_PRESETS) {
      const [a, b] = p.patch.synth.oscillators;
      if (!b.enabled) continue;
      const distinct =
        a.waveform !== b.waveform ||
        a.octave !== b.octave ||
        a.semitone !== b.semitone ||
        a.fineCents !== b.fineCents ||
        a.levelDb !== b.levelDb;
      if (!distinct) offenders.push(p.id);
    }
    expect(offenders).toEqual([]);
  });

  test('every preset states its own output calibration', () => {
    // outputGainDb moved out of the preset-ID trim table and into the patch
    // (design doc, "Domain model"). Every value here is now MEASURED — see the
    // header of synthPresets.ts — so this asserts the shape of a calibration,
    // not a taste.
    //
    // It used to assert `<= 0`, on the reasoning that a patch is voiced hot and
    // trimmed down. The measurement refuted that for six patches: a sparse or
    // slow one (Cyber Drone +9, Vocal Lead +8, Noise Riser +5, Laser FX +3,
    // Trance Pluck +2) is genuinely quieter than -18 LUFS at unity, and
    // normalising it to the target is a BOOST. Refusing one would mean
    // shipping a patch that check:levels fails.
    //
    // What is still worth guarding is the magnitude: `TARGET_DBFS - measured`
    // past +/-24 dB is a patch voiced four bits away from everything else in
    // the library, which is a voicing problem to fix rather than a gain to
    // apply. The widest today is -14 (Down Sweep), so the bound has room and
    // is not fitted to the current numbers.
    for (const p of SYNTH_PRESETS) {
      expect(Number.isFinite(p.patch.common.outputGainDb), p.id).toBe(true);
      expect(Math.abs(p.patch.common.outputGainDb) <= 24, p.id).toBe(true);
    }
    // …and not all at one value, which would be the trim table by another name.
    expect(new Set(SYNTH_PRESETS.map((p) => p.patch.common.outputGainDb)).size > 3).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import type { ArpSettings } from '@/types/synth';
import type { SynthPreset } from '@/data/synthPresets';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import {
  applySynthPreset,
  findPresetByName,
  getAllSynthPresets,
  groupPresets,
  presetById,
  SUBTRACTIVE_INIT,
} from './synthPresets';
import { TRACK_SYNTH_PRESET_IDS } from '@/store/initialState';

const ARP: ArpSettings = { active: true, mode: 'updown', rate: '8n', octaves: 3 };

function customPreset(id: string, name: string): SynthPreset<'subtractive'> {
  return {
    id,
    name,
    category: 'User',
    engine: 'subtractive',
    patch: structuredClone(SUBTRACTIVE_INIT.patch),
    tags: ['poly'],
    description: 'Custom user preset',
    isFactory: false,
  };
}

describe('applySynthPreset', () => {
  const bass = presetById(TRACK_SYNTH_PRESET_IDS.bass)!;

  test('installs the preset engine and the complete patch, not a merge over the current one', () => {
    const { activeSynth } = applySynthPreset(ARP, bass);
    expect(activeSynth.engine).toBe(bass.engine);
    expect(activeSynth.patch).toEqual(bass.patch);
  });

  test('replaces every field of the previous patch', () => {
    // The old flat library merged a Partial over the current params, so a
    // preset that did not state a field inherited whatever the last one set.
    // A complete patch cannot do that — pin it by comparing against a patch
    // that differs in every branch of the tree.
    const lead = presetById(TRACK_SYNTH_PRESET_IDS.synth)!;
    const { activeSynth } = applySynthPreset(ARP, bass);
    expect(activeSynth.patch.synth.oscillators).not.toEqual(lead.patch.synth.oscillators);
    expect(activeSynth.patch.common.voiceMode).toBe(bass.patch.common.voiceMode);
    expect(activeSynth.patch.synth.filter).toEqual(bass.patch.synth.filter);
    expect(activeSynth.patch.synth.lfo).toEqual(bass.patch.synth.lfo);
    expect(activeSynth.patch.synth.env2Routes).toEqual(bass.patch.synth.env2Routes);
  });

  test('records the preset id as provenance', () => {
    expect(applySynthPreset(ARP, bass).activeSynth.sourcePresetId).toBe(bass.id);
  });

  test('preserves the Arp object it was handed', () => {
    // Arp is performance state: loading a sound must never re-arm, re-rate or
    // disarm the arpeggiator. Identity, not just equality — nothing here has
    // any reason to copy it.
    expect(applySynthPreset(ARP, bass).arpSettings).toBe(ARP);
  });

  test('hands back a patch no later edit can write back into the library', () => {
    const first = applySynthPreset(ARP, bass).activeSynth;
    first.patch.synth.env2Routes.push({ target: 'pan', unit: 'pan', amount: 1 });
    first.patch.synth.oscillators[0].levelDb = -42;
    expect(presetById(bass.id)!.patch.synth.env2Routes).toEqual(bass.patch.synth.env2Routes);
    expect(applySynthPreset(ARP, presetById(bass.id)!).activeSynth.patch.synth.oscillators[0].levelDb)
      .not.toBe(-42);
  });
});

describe('presetById', () => {
  test('resolves a factory id and refuses a missing or empty one', () => {
    expect(presetById(TRACK_SYNTH_PRESET_IDS.pad)?.id).toBe(TRACK_SYNTH_PRESET_IDS.pad);
    expect(presetById('not-a-real-preset')).toBeUndefined();
    expect(presetById('')).toBeUndefined();
  });
});

describe('getAllSynthPresets', () => {
  test('puts custom presets ahead of the factory library', () => {
    const custom = [customPreset('user-1', 'Mine')];
    const all = getAllSynthPresets(custom);
    expect(all[0]!.id).toBe('user-1');
    expect(all.length).toBe(SYNTH_PRESETS.length + 1);
  });
});

describe('findPresetByName', () => {
  test('matches on name and refuses an empty query', () => {
    const all = getAllSynthPresets([]);
    const first = SYNTH_PRESETS[0]!;
    expect(findPresetByName(first.name, all)?.id).toBe(first.id);
    expect(findPresetByName('', all)).toBeUndefined();
  });
});

describe('groupPresets', () => {
  test('emits only populated categories, in library order, User last', () => {
    const groups = groupPresets(getAllSynthPresets([customPreset('user-1', 'Mine')]));
    expect(groups.length > 1).toBe(true);
    expect(groups[groups.length - 1]!.category).toBe('User');
    for (const group of groups) expect(group.presets.length > 0).toBe(true);
  });

  test('a custom preset lands in User whatever category it was saved under', () => {
    const saved = { ...customPreset('user-2', 'Saved As Lead'), category: 'Lead' as const };
    const groups = groupPresets(getAllSynthPresets([saved]));
    const user = groups.find((g) => g.category === 'User')!;
    expect(user.presets.map((p) => p.id)).toContain('user-2');
    const lead = groups.find((g) => g.category === 'Lead')!;
    expect(lead.presets.map((p) => p.id)).not.toContain('user-2');
  });
});

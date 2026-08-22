import { describe, expect, test } from 'bun:test';
import { FACTORY_BASS_PRESETS } from './bassPresets';
import {
  FACTORY_PRESETS,
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
  SYNTH_CATEGORIES,
} from './synthPresets';
import type { SynthPresetItem } from './synthPresets';

const custom: SynthPresetItem = {
  id: 'custom-1',
  name: 'My Patch',
  category: 'User',
  params: {},
};

describe('getAllSynthPresets', () => {
  test('includes dedicated bass presets alongside factory presets', () => {
    const all = getAllSynthPresets([]);
    const names = all.map((p) => p.name);
    expect(names).toContain('Cosmic Lead');
    expect(names).toContain('Deep Sine Sub');
    expect(names).toContain('Saw Growl');
  });

  test('lists custom presets before factory presets', () => {
    const all = getAllSynthPresets([custom]);
    expect(all[0]).toBe(custom);
    expect(all).toContain(FACTORY_PRESETS[0]);
    expect(all).toContain(FACTORY_BASS_PRESETS[0]);
  });
});

describe('findPresetByName', () => {
  test('resolves a preset name to the matching preset item', () => {
    expect(findPresetByName('Round Pluck', FACTORY_BASS_PRESETS)?.id).toBe('bass-round-pluck');
  });

  test('returns undefined when no preset has that name', () => {
    expect(findPresetByName('Not A Preset', FACTORY_BASS_PRESETS)).toBe(undefined);
  });

  test('returns undefined for an empty name', () => {
    expect(findPresetByName('', FACTORY_BASS_PRESETS)).toBe(undefined);
  });
});

describe('getPresetsGroupedByCategory', () => {
  test('organizes presets into distinct categories including Bass, Lead, Pad, and Keys', () => {
    const all = getAllSynthPresets([custom]);
    const groups = getPresetsGroupedByCategory(all);
    const categoryIds = groups.map((g) => g.category);

    expect(categoryIds).toContain('Bass');
    expect(categoryIds).toContain('Lead');
    expect(categoryIds).toContain('Pad');
    expect(categoryIds).toContain('Keys');
    expect(categoryIds).toContain('User');

    const bassGroup = groups.find((g) => g.category === 'Bass');
    expect(bassGroup?.presets.some((p) => p.name === '808 Deep Bass' || p.name === 'Deep Sine Sub')).toBe(true);

    const leadGroup = groups.find((g) => g.category === 'Lead');
    expect(leadGroup?.presets.some((p) => p.name === 'Cosmic Lead')).toBe(true);

    const padGroup = groups.find((g) => g.category === 'Pad');
    expect(padGroup?.presets.some((p) => p.name === 'Warm PolyPad')).toBe(true);

    const keysGroup = groups.find((g) => g.category === 'Keys');
    expect(keysGroup?.presets.some((p) => p.name === 'Dream Keys')).toBe(true);
  });
});

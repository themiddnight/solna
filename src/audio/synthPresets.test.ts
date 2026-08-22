import { describe, expect, test } from 'bun:test';
import { FACTORY_BASS_PRESETS } from './bassPresets';
import { FACTORY_PRESETS, getAllSynthPresets, findPresetByName } from './synthPresets';
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

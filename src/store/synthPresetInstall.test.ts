import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { SYNTH_ARP_FIELD, SYNTH_PARAM_FIELD } from './sourceBuses';
import {
  adoptSavedSynthPreset,
  loadSynthPreset,
  PRESET_INSTALL_RELEASE,
} from './synthPresetInstall';
import { useAppStore } from './store';

const presetById = (id: string) => {
  const preset = SYNTH_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`no factory preset ${id}`);
  return preset;
};

const COSMIC = presetById('factory-cosmic-lead');
const ACID = presetById('factory-acid-synth');

// These write the shared singleton store's five patches, and bun runs every
// test file in one process with no isolation — so restore the baseline before
// AND after each test, or a sibling file inherits whichever preset ran last.
const PATCH_FIELDS = Object.values(SYNTH_PARAM_FIELD);
let baseline: Record<string, unknown>;
beforeEach(() => {
  const state = useAppStore.getState();
  baseline = Object.fromEntries(PATCH_FIELDS.map((field) => [field, state[field]]));
});
afterEach(() => {
  useAppStore.setState(baseline);
});

/**
 * These two entry points differ by ONE thing — whether the bus is stopped — and
 * that difference is the whole reason they are separate functions. The voice
 * manager cannot derive it: every edit path preserves `sourcePresetId`, so a
 * knob move and a re-pick of the preset being edited are indistinguishable by
 * the time a patch reaches it (`voiceManager.test.ts` pins that from the other
 * side).
 */
describe('loadSynthPreset', () => {
  test('stops the bus it is loading onto, then writes the patch', () => {
    const stopSource = spyOn(audioEngine, 'stopSource');
    try {
      loadSynthPreset('chord', COSMIC);

      expect(stopSource).toHaveBeenCalledWith('chord', PRESET_INSTALL_RELEASE);
      expect(useAppStore.getState()[SYNTH_PARAM_FIELD.chord].sourcePresetId).toBe(COSMIC.id);
    } finally {
      stopSource.mockRestore();
    }
  });

  test('reaches one bus, not every synth bus', () => {
    const stopSource = spyOn(audioEngine, 'stopSource');
    try {
      loadSynthPreset('bass', ACID);

      expect(stopSource).toHaveBeenCalledTimes(1);
      expect(stopSource).toHaveBeenCalledWith('bass', PRESET_INSTALL_RELEASE);
    } finally {
      stopSource.mockRestore();
    }
  });

  // The defect this closes: re-picking a preset you have already edited used to
  // compare equal on `sourcePresetId` and live-morph instead of reloading, so
  // the edited envelope timing, ENV2 route amounts and output gain survived
  // underneath the library patch's oscillators and filter.
  test('re-picking the preset already loaded still stops the bus', () => {
    const stopSource = spyOn(audioEngine, 'stopSource');
    try {
      loadSynthPreset('pad', COSMIC);
      stopSource.mockClear();
      loadSynthPreset('pad', COSMIC);

      expect(stopSource).toHaveBeenCalledWith('pad', PRESET_INSTALL_RELEASE);
    } finally {
      stopSource.mockRestore();
    }
  });

  test('leaves the track Arp alone — a sound is not a performance setting', () => {
    const before = useAppStore.getState()[SYNTH_ARP_FIELD.chord];
    loadSynthPreset('chord', ACID);

    expect(useAppStore.getState()[SYNTH_ARP_FIELD.chord]).toEqual(before);
  });
});

describe('adoptSavedSynthPreset', () => {
  // Saving the sound you are playing must not silence it: the patch being
  // installed IS the patch already sounding, so a stop here would cut a held
  // key and every scheduled hit to swap a sound for itself.
  test('records the new provenance without stopping the bus', () => {
    const stopSource = spyOn(audioEngine, 'stopSource');
    try {
      adoptSavedSynthPreset('synth', COSMIC);

      expect(stopSource).not.toHaveBeenCalled();
      expect(useAppStore.getState()[SYNTH_PARAM_FIELD.synth].sourcePresetId).toBe(COSMIC.id);
    } finally {
      stopSource.mockRestore();
    }
  });
});

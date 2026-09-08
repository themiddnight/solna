import { describe, expect, test } from 'bun:test';
import { focusSynthTarget, resolveSynthControlChannel, SYNTH_TARGET_STYLES } from './synthControl';
import type { SynthControlTarget, SynthParamChannel } from './synthControl';
import type { SynthParams, ViewMode } from '../types';

const baseParams: SynthParams = {
  oscType: 'sine',
  subOscVolume: 0,
  noiseVolume: 0,
  detune: 0,
  filterType: 'lowpass',
  filterCutoff: 500,
  filterResonance: 1,
  filterEnvAmount: 0,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.8,
  release: 0.3,
  filterAttack: 0.01,
  filterDecay: 0.2,
  filterSustain: 1,
  filterRelease: 0.3,
  lfoRate: 0,
  lfoDepth: 0,
  lfoTarget: 'volume',
  octave: 0,
  arpActive: false,
  arpMode: 'up',
  arpRate: '16n',
  arpOctaves: 1,
  preset: '',
};

function channel(name: string): SynthParamChannel {
  return {
    params: { ...baseParams, preset: name },
    setParams: () => {},
  };
}

describe('resolveSynthControlChannel', () => {
  const channels = {
    synth: channel('synth-patch'),
    chord: channel('chord-patch'),
    bass: channel('bass-patch'),
    pad: channel('pad-patch'),
  };

  test('routes each control target to its own param channel', () => {
    expect(resolveSynthControlChannel('synth', channels)).toBe(channels.synth);
    expect(resolveSynthControlChannel('chord', channels)).toBe(channels.chord);
    expect(resolveSynthControlChannel('bass', channels)).toBe(channels.bass);
    expect(resolveSynthControlChannel('pad', channels)).toBe(channels.pad);
  });

  test('falls back to the synth channel for unknown targets', () => {
    expect(
      resolveSynthControlChannel('unknown-target' as unknown as SynthControlTarget, channels)
    ).toBe(channels.synth);
  });
});

describe('focusSynthTarget', () => {
  function recorder() {
    const calls: Array<[string, string]> = [];
    return {
      calls,
      setControlTarget: (target: SynthControlTarget) => calls.push(['target', target]),
      setActiveTab: (tab: ViewMode) => calls.push(['tab', tab]),
    };
  }

  test('selects the requested target and opens the synth view', () => {
    const nav = recorder();
    focusSynthTarget('chord', nav);
    expect(nav.calls).toEqual([
      ['target', 'chord'],
      ['tab', 'sound'],
    ]);
  });

  test('carries each target through unchanged', () => {
    for (const target of ['synth', 'chord', 'bass'] as SynthControlTarget[]) {
      const nav = recorder();
      focusSynthTarget(target, nav);
      expect(nav.calls[0]).toEqual(['target', target]);
    }
  });

  test('sets the target before switching tabs so the synth view renders on the right channel', () => {
    const nav = recorder();
    focusSynthTarget('bass', nav);
    expect(nav.calls.map(([kind]) => kind)).toEqual(['target', 'tab']);
  });
});

test('the pad target carries its own module styling', () => {
  const style = SYNTH_TARGET_STYLES.pad;
  expect(style.label).toBe('Pad');
  expect(style.tint).toBe('tint-pad');
  expect(style.ring).toContain('module-pad');
  expect(style.activeBtn).toContain('--color-module-pad');
  expect(style.badge).toContain('--color-module-pad');
});

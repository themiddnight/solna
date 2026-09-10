import { describe, expect, test } from 'bun:test';
import { focusSynthTarget, resolveSynthControlChannel, SYNTH_TARGET_STYLES } from './synthControl';
import type { SynthControlTarget, SynthParamChannel } from './synthControl';
import type { SynthParams, ViewMode } from '../types';
import type { MixLayerId } from '../store/focusTrack';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import { soloTrackForFocus } from '../store/trackAudibility';

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
    fx: channel('fx-patch'),
  };

  test('routes each control target to its own param channel', () => {
    expect(resolveSynthControlChannel('synth', channels)).toBe(channels.synth);
    expect(resolveSynthControlChannel('chord', channels)).toBe(channels.chord);
    expect(resolveSynthControlChannel('bass', channels)).toBe(channels.bass);
    expect(resolveSynthControlChannel('pad', channels)).toBe(channels.pad);
    expect(resolveSynthControlChannel('fx', channels)).toBe(channels.fx);
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
      setFocusTrack: (focus: MixLayerId) => calls.push(['target', focus]),
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

describe('the fx control target', () => {
  test('SYNTH_TARGET_STYLES has a complete row for fx', () => {
    expect(SYNTH_TARGET_STYLES.fx).toEqual({
      label: 'FX',
      tint: 'tint-fx',
      ring: 'ring-1 ring-module-fx/40',
      activeBtn: '[--btn-color:var(--color-module-fx)] [--btn-fg:var(--color-module-fx-content)]',
      softBtn: 'btn-soft [--btn-color:var(--color-module-fx)] [--btn-fg:var(--color-module-fx-content)]',
      badge: '[--badge-color:var(--color-module-fx)]',
      border: 'border-module-fx',
      slider: 'range range-xs text-module-fx [--range-thumb:var(--color-module-fx-content)]',
      accent: 'text-module-fx',
    });
  });

  /**
   * Every string in that record must stay a LITERAL. Tailwind v4 scans source
   * statically, so a class assembled from `--color-module-${target}` at runtime
   * is never emitted — the chip would render with no colour and nothing would
   * fail. Asserted by shape: no value may contain a template placeholder.
   */
  test('no style string is assembled at runtime', () => {
    for (const style of Object.values(SYNTH_TARGET_STYLES)) {
      for (const value of Object.values(style)) {
        expect(value).not.toContain('${');
      }
    }
  });

  test('resolveSynthControlChannel routes fx to the fx channel', () => {
    const A: SynthParams = { ...INITIAL_SYNTH_PARAMS, preset: 'a' };
    const B: SynthParams = { ...INITIAL_SYNTH_PARAMS, preset: 'b' };
    const channels = {
      synth: { params: A, setParams: () => {} },
      chord: { params: A, setParams: () => {} },
      bass: { params: A, setParams: () => {} },
      pad: { params: A, setParams: () => {} },
      fx: { params: B, setParams: () => {} },
    };
    expect(resolveSynthControlChannel('fx', channels).params).toBe(B);
  });

  /**
   * soloTrackForFocus keeps its two irregularities ('synth' -> 'lead',
   * 'drum' -> 'drums'). The fx focus is called `fx` and the fx solo track is
   * called `fx`, so it passes through the identity branch. Do NOT regularise
   * the lead or drum cases: those two mappings are the entire reason the
   * function exists, and a third special case is where it stops being
   * readable.
   */
  test('fx passes through soloTrackForFocus unchanged', () => {
    expect(soloTrackForFocus('fx')).toBe('fx');
    expect(soloTrackForFocus('synth')).toBe('lead');
  });
});

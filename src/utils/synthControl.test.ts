import { describe, expect, test } from 'bun:test';
import { resolveSynthControlChannel, SYNTH_TARGET_STYLES } from './synthControl';
import type { SynthChannel, SynthControlTarget } from './synthControl';
import type { ActiveSynth } from '../types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { soloTrackForFocus } from '../store/trackAudibility';

/**
 * A channel whose patch is identifiable by its `sourcePresetId`. Provenance
 * is display-only and never a DSP input, which makes it the right field for a
 * test that only needs to tell five channels apart.
 */
function channel(name: string): SynthChannel {
  const activeSynth: ActiveSynth = { ...SUBTRACTIVE_INIT, sourcePresetId: name };
  return {
    activeSynth,
    arpSettings: { active: false, mode: 'up', rate: '16n', octaves: 1 },
    setActiveSynth: () => {},
    setArpSettings: () => {},
  };
}

test('the pad target carries its own module styling', () => {
  const style = SYNTH_TARGET_STYLES.pad;
  expect(style.label).toBe('Pad');
  expect(style.tint).toBe('tint-pad');
  expect(style.ring).toContain('module-pad');
  expect(style.activeBtn).toContain('--color-module-pad');
  expect(style.badge).toContain('--color-module-pad');
});

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
    const a = channel('a');
    const b = channel('b');
    const channels = { synth: a, chord: a, bass: a, pad: a, fx: b };
    expect(resolveSynthControlChannel('fx', channels).activeSynth).toBe(b.activeSynth);
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

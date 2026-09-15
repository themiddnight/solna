import { describe, expect, test } from 'bun:test';
import { SOURCE_BUSES, sourceBus } from './sourceBuses';
import { SOLO_TRACKS, SOLO_TRACK_LABELS, isTrackAudible } from './trackAudibility';
import { MIX_GROUP_IDS, MIX_GROUP_LABELS, MIX_LAYERS, MIX_LAYER_IDS } from '@/components/mixLayers';

describe('SOURCE_BUSES — the fx row', () => {
  test('reads the fx store fields and names its own engine source and solo track', () => {
    const row = sourceBus('fx');
    expect(row.source).toBe('fx');
    expect(row.solo).toBe('fx');
    // The readers are functions now — the five melodic buses are flat and the
    // Beat bus is nested — so what is asserted is what they READ, not a field
    // name a row happens to spell.
    const state = { fxVolume: -7, fxMuted: true } as Parameters<typeof row.selectLevelDb>[0];
    expect(row.selectLevelDb(state)).toBe(-7);
    expect(row.selectMuted(state)).toBe(true);
  });

  test('the Beat bus reads the nested beatMix, which is the whole reason the columns are functions', () => {
    const row = sourceBus('sequencer');
    const state = {
      beatMix: { levelDb: -3, muted: true, voices: {} },
    } as unknown as Parameters<typeof row.selectLevelDb>[0];
    expect(row.selectLevelDb(state)).toBe(-3);
    expect(row.selectMuted(state)).toBe(true);
  });

  test('is the six buses, fx beside the other melodic ones', () => {
    expect(SOURCE_BUSES.map((b) => b.source)).toEqual([
      'synth',
      'chord',
      'bass',
      'pad',
      'fx',
      'sequencer',
    ]);
  });
});

describe('solo — fx', () => {
  test('SOLO_TRACKS is the six targets, in chip order', () => {
    expect([...SOLO_TRACKS]).toEqual(['lead', 'fx', 'chord', 'bass', 'pad', 'drums']);
  });

  test('every track has a label', () => {
    expect(SOLO_TRACK_LABELS.fx).toBe('FX');
  });

  /**
   * isTrackAudible is generic over the track id and does not change. What is
   * asserted here is that the new id behaves like every other one: solo beats
   * mute, and a solo set that does not name fx silences it.
   */
  test('solo beats mute, and a set that omits fx silences it', () => {
    expect(isTrackAudible('fx', ['fx'], true)).toBe(true);
    expect(isTrackAudible('fx', ['lead'], false)).toBe(false);
    expect(isTrackAudible('fx', [], false)).toBe(true);
    expect(isTrackAudible('fx', [], true)).toBe(false);
  });

  test('lead and fx solo together — the set is additive, not a radio', () => {
    const solo = ['lead', 'fx'] as const;
    expect(isTrackAudible('lead', solo, false)).toBe(true);
    expect(isTrackAudible('fx', solo, false)).toBe(true);
    expect(isTrackAudible('chord', solo, false)).toBe(false);
  });
});

describe('the mixer — fx', () => {
  test('MIX_LAYER_IDS gains fx', () => {
    expect([...MIX_LAYER_IDS]).toEqual(['synth', 'fx', 'chord', 'bass', 'pad', 'drum']);
  });

  /**
   * FX sits under Lead's divider, not its own — the two are independent
   * tracks with independent faders (a mute or a fader drag on one never
   * touches the other), but they are both melody tracks and the mixer's
   * groups say so the same way the Sound view's target row already does:
   * Lead and FX render as bare chips beside each other, never inside a
   * framed group.
   */
  test('fx has no mixer group of its own — it sits under Lead', () => {
    expect([...MIX_GROUP_IDS]).toEqual(['lead', 'accompaniment', 'beat']);
    expect('fx' in MIX_GROUP_LABELS).toBe(false);
  });

  test('the fx row names the fx store keys, the fx bus, the fx colour, and the lead group', () => {
    const row = MIX_LAYERS.find((l) => l.idPrefix === 'fx')!;
    // The four accessors are functions, so the row's own two store fields are
    // asserted through them rather than as key names: hand the row a mix in
    // which every fader and every mute is distinguishable, and it must read
    // back FX's pair and patch FX's pair.
    const mix = { fxVolume: -13, fxMuted: true, synthVolume: 1, synthMuted: false } as never;
    expect(row.readLevelDb(mix)).toBe(-13);
    expect(row.readMuted(mix)).toBe(true);
    expect(row.levelPatch(-4, mix)).toEqual({ fxVolume: -4 });
    expect(row.mutePatch(false, mix)).toEqual({ fxMuted: false });
    // The four accessors are compared above, by behaviour; what is left must
    // be exactly this and nothing more, so a column added to the row without a
    // decision about FX's value for it fails here.
    const rest = Object.fromEntries(
      Object.entries(row).filter(([, value]) => typeof value !== 'function'),
    );
    expect(rest).toEqual({
      idPrefix: 'fx',
      label: 'FX',
      engineSource: 'fx',
      tone: 'module-fx',
      accentClass: 'text-module-fx',
      group: 'lead',
    });
  });
});

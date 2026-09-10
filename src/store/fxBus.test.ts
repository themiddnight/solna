import { describe, expect, test } from 'bun:test';
import { SOURCE_BUSES, sourceBus } from './sourceBuses';
import { SOLO_TRACKS, SOLO_TRACK_LABELS, isTrackAudible } from './trackAudibility';
import { MIX_GROUP_IDS, MIX_GROUP_LABELS, MIX_LAYERS, MIX_LAYER_IDS } from '@/components/mixLayers';

describe('SOURCE_BUSES — the fx row', () => {
  test('names the fx store fields and its own engine source', () => {
    expect(sourceBus('fx')).toEqual({
      source: 'fx',
      volume: 'fxVolume',
      muted: 'fxMuted',
      solo: 'fx',
    });
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
    const row = MIX_LAYERS.find((l) => l.idPrefix === 'fx');
    expect(row).toEqual({
      idPrefix: 'fx',
      label: 'FX',
      volumeKey: 'fxVolume',
      muteKey: 'fxMuted',
      engineSource: 'fx',
      tone: 'module-fx',
      accentClass: 'text-module-fx',
      group: 'lead',
    });
  });
});

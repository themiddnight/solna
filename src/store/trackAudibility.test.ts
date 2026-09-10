import { describe, expect, test } from 'bun:test';
import {
  isTrackAudible,
  soloChipLabel,
  soloTrackForFocus,
  SOLO_TRACKS,
  SOLO_TRACK_LABELS,
  toggleSolo,
  type SoloTrack,
} from './trackAudibility';
import { MIX_LAYER_IDS } from './focusTrack';

/**
 * The two drum mute LAYERS, composed the way the running app composes them:
 * layer 1 is the drums BUS, which engineSync pushes through isTrackAudible;
 * layer 2 is the per-voice `muted` flag, which useSequencerPlayback applies as
 * a `continue` before it triggers the voice. This helper lives in the test and
 * not in production on purpose — nothing in the app needs the composed value,
 * because the bus gain already silences a soloed-away kit whatever the voice
 * flags say. It exists so the spec's "a drum voice needs both its track
 * audible and its own mute off" is asserted rather than assumed.
 */
function drumVoiceSounds(
  soloTracks: readonly SoloTrack[],
  drumsMuted: boolean,
  voiceMuted: boolean,
): boolean {
  return isTrackAudible('drums', soloTracks, drumsMuted) && !voiceMuted;
}

describe('SOLO_TRACKS', () => {
  test('is exactly the six targets, in canonical order', () => {
    expect([...SOLO_TRACKS]).toEqual(['lead', 'fx', 'chord', 'bass', 'pad', 'drums']);
  });

  test('every track has a label', () => {
    expect(SOLO_TRACK_LABELS).toEqual({
      lead: 'Lead',
      fx: 'FX',
      chord: 'Chord',
      bass: 'Bass',
      pad: 'Pad',
      drums: 'Drums',
    });
  });
});

describe('isTrackAudible', () => {
  test('with no solo latched, audibility is just "not muted"', () => {
    expect(isTrackAudible('lead', [], false)).toBe(true);
    expect(isTrackAudible('lead', [], true)).toBe(false);
  });

  test('solo beats mute: a muted track sounds when it is soloed', () => {
    expect(isTrackAudible('drums', ['drums'], true)).toBe(true);
  });

  test('solo silences every track it does not name, muted or not', () => {
    expect(isTrackAudible('chord', ['drums'], false)).toBe(false);
    expect(isTrackAudible('bass', ['drums'], true)).toBe(false);
  });

  test('solo is additive, not a radio: drums + lead sound together', () => {
    const solo: SoloTrack[] = ['lead', 'drums'];
    expect(isTrackAudible('lead', solo, false)).toBe(true);
    expect(isTrackAudible('drums', solo, false)).toBe(true);
    expect(isTrackAudible('chord', solo, false)).toBe(false);
    expect(isTrackAudible('bass', solo, false)).toBe(false);
    expect(isTrackAudible('pad', solo, false)).toBe(false);
  });

  test('scope is the whole loop: one solo set covers all five targets', () => {
    const audible = SOLO_TRACKS.filter((t) => isTrackAudible(t, ['pad'], false));
    expect(audible).toEqual(['pad']);
  });
});

describe('a drum voice needs both layers', () => {
  test('the voice sounds only when the bus is audible AND its own mute is off', () => {
    expect(drumVoiceSounds([], false, false)).toBe(true);
    expect(drumVoiceSounds([], false, true)).toBe(false);
    expect(drumVoiceSounds([], true, false)).toBe(false);
    expect(drumVoiceSounds(['drums'], true, false)).toBe(true);
    expect(drumVoiceSounds(['drums'], true, true)).toBe(false);
    expect(drumVoiceSounds(['lead'], false, false)).toBe(false);
  });
});

describe('toggleSolo', () => {
  test('adds a track, and keeps the result in canonical order', () => {
    expect(toggleSolo(['drums'], 'lead')).toEqual(['lead', 'drums']);
  });

  test('removes a track that is already soloed', () => {
    expect(toggleSolo(['lead', 'drums'], 'lead')).toEqual(['drums']);
  });

  test('toggling the only soloed track empties the set', () => {
    expect(toggleSolo(['drums'], 'drums')).toEqual([]);
  });
});

describe('soloTrackForFocus', () => {
  test('maps every focus onto a real solo track', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, soloTrackForFocus(id)]));
    expect(actual).toEqual({
      synth: 'lead',
      fx: 'fx',
      chord: 'chord',
      bass: 'bass',
      pad: 'pad',
      drum: 'drums',
    });
  });
});

describe('soloChipLabel', () => {
  test('is null when nothing is soloed, so the chip renders nothing', () => {
    expect(soloChipLabel([])).toBeNull();
  });

  test('names one track', () => {
    expect(soloChipLabel(['drums'])).toBe('SOLO · Drums');
  });

  test('joins several with a plus, in canonical order', () => {
    expect(soloChipLabel(['lead', 'drums'])).toBe('SOLO · Lead + Drums');
  });
});

import { describe, expect, test } from 'bun:test';
import { MELODY_TRACKS, melodyTrack, type MelodyTrackId } from './melodyTracks';
import { LOOP_FLAT_KEYS } from './loop';

describe('MELODY_TRACKS', () => {
  test('is exactly the two melody tracks, lead first', () => {
    expect(MELODY_TRACKS.map((t) => t.id)).toEqual(['lead', 'fx']);
  });

  test('melodyTrack narrows an id to its row', () => {
    expect(melodyTrack('fx').steps).toBe('fxMelodySteps');
    expect(melodyTrack('lead').steps).toBe('leadMelodySteps');
  });

  /**
   * The whole reason the field names are table DATA and not a `${id}MelodySteps`
   * template: four of lead's columns do not follow the convention at all
   * (`synthParams`, `synthVolume`, `synthMuted`, engine source `'synth'`), so a
   * template would need a per-column exception for one of the two rows. This is
   * the SOURCE_BUSES precedent, asserted rather than described.
   */
  test('the lead row is irregular in exactly the four columns the fx row is regular in', () => {
    const lead = melodyTrack('lead');
    expect([lead.synthParams, lead.volume, lead.muted, lead.engineSource]).toEqual([
      'synthParams',
      'synthVolume',
      'synthMuted',
      'synth',
    ]);
    const fx = melodyTrack('fx');
    expect([fx.synthParams, fx.volume, fx.muted, fx.engineSource]).toEqual([
      'fxSynthParams',
      'fxVolume',
      'fxMuted',
      'fx',
    ]);
  });

  /**
   * Every per-loop field a track names must actually BE a per-loop field. A row
   * naming a key LOOP_FLAT_KEYS does not carry is a value that would not travel
   * with its loop — visible only as a melody that survives a loop switch.
   */
  test('every per-loop column names a LOOP_FLAT_KEYS member', () => {
    const flat = new Set<string>(LOOP_FLAT_KEYS);
    for (const track of MELODY_TRACKS) {
      for (const key of [
        track.steps,
        track.loopLength,
        track.stepResolution,
        track.view,
        track.octave,
        track.gate,
        track.synthParams,
        track.volume,
        track.muted,
      ]) {
        expect({ track: track.id, key, inFlatKeys: flat.has(key) }).toEqual({
          track: track.id,
          key,
          inFlatKeys: true,
        });
      }
    }
  });

  test('no two rows share a store field, a player or an engine source', () => {
    const columns = [
      'steps', 'loopLength', 'stepResolution', 'view', 'octave',
      'gate', 'synthParams', 'volume', 'muted', 'player',
      'cursor', 'clipboard', 'engineSource', 'stepPlayer',
    ] as const;
    for (const column of columns) {
      const values = MELODY_TRACKS.map((track) => track[column]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  test('MelodyTrackId is the id union', () => {
    const ids: MelodyTrackId[] = ['lead', 'fx'];
    expect(ids.every((id) => melodyTrack(id).id === id)).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import {
  MIX_LAYER_IDS,
  controlTargetForFocus,
  focusForSegment,
  isMelodicFocus,
  isMixLayerId,
  melodyTrackForFocus,
  segmentForFocus,
  type MelodicFocus,
  type MixLayerId,
} from './focusTrack';
import { MELODY_TRACKS } from './melodyTracks';
import { PATTERN_SEGMENT_IDS } from '@/types';

describe('MIX_LAYER_IDS', () => {
  // Exhaustive, not a subset check: this roster is now the FOCUS roster as
  // well as the mixer's, so a layer added without a projection row below is a
  // chip that lights up and a surface that does nothing.
  test('is the six layers in canonical order', () => {
    expect([...MIX_LAYER_IDS]).toEqual(['synth', 'fx', 'chord', 'bass', 'pad', 'drum']);
  });
});

describe('isMixLayerId', () => {
  test('accepts every roster member', () => {
    for (const id of MIX_LAYER_IDS) expect(isMixLayerId(id)).toBe(true);
  });

  // The three shapes a persisted payload can actually carry. `'lead'` is the
  // one that looks plausible: it is the mixer's LABEL for 'synth' and the
  // melody track's id, and it is not a focus id.
  test('rejects a non-member, a non-string and a missing value', () => {
    expect(isMixLayerId('lead')).toBe(false);
    expect(isMixLayerId(7)).toBe(false);
    expect(isMixLayerId(undefined)).toBe(false);
    expect(isMixLayerId(null)).toBe(false);
  });
});

describe('segmentForFocus', () => {
  // Asserted against a literal expected map rather than by re-deriving: a
  // `for` loop that recomputes the mapping proves only that the function
  // equals itself (the DRUM_ALIASES `toEqual` discipline).
  test('maps every focus onto its Pattern segment', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, segmentForFocus(id)]));
    expect(actual).toEqual({
      synth: 'lead',
      fx: 'fx',
      chord: 'accompaniment',
      bass: 'accompaniment',
      pad: 'accompaniment',
      drum: 'beat',
    });
  });

  test('every result is a real PATTERN_SEGMENT_IDS member', () => {
    for (const id of MIX_LAYER_IDS) {
      expect([...PATTERN_SEGMENT_IDS]).toContain(segmentForFocus(id));
    }
  });
});

describe('focusForSegment', () => {
  // Accompaniment sends `chord`, unconditionally and with no memory of which
  // of the three was last used — see the spec's rejected alternative.
  test('maps every segment onto the focus its button sets', () => {
    const actual = Object.fromEntries(
      PATTERN_SEGMENT_IDS.map((id) => [id, focusForSegment(id)]),
    );
    expect(actual).toEqual({
      lead: 'synth',
      fx: 'fx',
      accompaniment: 'chord',
      beat: 'drum',
    });
  });

  // Round-trip: pressing a segment button must light that same button up.
  test('every segment round-trips through segmentForFocus', () => {
    for (const segment of PATTERN_SEGMENT_IDS) {
      expect(segmentForFocus(focusForSegment(segment))).toBe(segment);
    }
  });
});

describe('isMelodicFocus', () => {
  test('is true for exactly MIX_LAYER_IDS minus drum', () => {
    expect(MIX_LAYER_IDS.filter(isMelodicFocus)).toEqual(['synth', 'fx', 'chord', 'bass', 'pad']);
    expect(isMelodicFocus('drum')).toBe(false);
  });
});

describe('controlTargetForFocus', () => {
  test('maps every melodic focus onto its synth channel', () => {
    const melodic = MIX_LAYER_IDS.filter(isMelodicFocus);
    const actual = Object.fromEntries(melodic.map((id) => [id, controlTargetForFocus(id)]));
    expect(actual).toEqual({
      synth: 'synth',
      fx: 'fx',
      chord: 'chord',
      bass: 'bass',
      pad: 'pad',
    });
  });

  /**
   * The `'drum'` case is a COMPILE-TIME assertion, not a runtime one. A total
   * function returning `'synth'` for `'drum'` is the trap the spec names: it
   * would make the drum focus edit the Lead patch through every knob on the
   * Sound page, consistently and invisibly, because
   * `resolveSynthControlChannel` ends in `?? channels.synth` and swallows it.
   *
   * `Assert<T extends true>` is what makes this real — the melodyTracks.ts
   * pattern. A bare `X extends Y ? true : never` alias resolves to `never`
   * with nothing consuming it and no error at all.
   */
  test('refuses a drum focus by type', () => {
    type Assert<T extends true> = T;
    /* eslint-disable @typescript-eslint/no-unused-vars -- these two aliases ARE
       the assertion; consuming them at runtime would defeat the point. */
    type _DrumIsNotMelodic = Assert<'drum' extends MelodicFocus ? false : true>;
    type _MelodicIsEveryOtherLayer = Assert<
      Exclude<MixLayerId, 'drum'> extends MelodicFocus ? true : false
    >;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    // The types above are the assertion; this keeps the test body non-empty
    // and the two aliases referenced so no-unused-vars stays quiet.
    const witness: MelodicFocus[] = ['synth', 'fx', 'chord', 'bass', 'pad'];
    expect(witness).toHaveLength(MIX_LAYER_IDS.length - 1);
  });
});

describe('melodyTrackForFocus', () => {
  test('maps the two melody focuses onto track ids and the rest onto null', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, melodyTrackForFocus(id)]));
    expect(actual).toEqual({
      synth: 'lead',
      fx: 'fx',
      chord: null,
      bass: null,
      pad: null,
      drum: null,
    });
  });

  // Cross-checked against MELODY_TRACKS so a renamed track fails HERE rather
  // than leaving a projection pointing at an id no table has.
  test('every non-null result names a real MELODY_TRACKS row', () => {
    const ids = MELODY_TRACKS.map((t) => t.id);
    for (const focus of MIX_LAYER_IDS) {
      const track = melodyTrackForFocus(focus);
      if (track !== null) expect(ids).toContain(track);
    }
  });
});

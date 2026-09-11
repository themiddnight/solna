import type { Loop, LoopStatePatch } from './types';

/** The five mixer tracks a group can name, plus `loop` for the two loop-wide groups. */
export type LoopCopyTrack = 'lead' | 'fx' | 'chord' | 'bass' | 'pad' | 'drums' | 'loop';

/**
 * The boundary a group draws: `sound` changes the voice, `pattern` the notes
 * or comping rhythm, `progression` the chord progression alone. `whole` is
 * the two loop-wide groups, which are none of the three.
 */
export type LoopCopyAspect = 'sound' | 'pattern' | 'progression' | 'whole';

export type LoopCopyGroupId =
  | 'lead-sound'
  | 'lead-pattern'
  | 'fx-sound'
  | 'fx-pattern'
  | 'chord-sound'
  | 'chord-progression'
  | 'chord-pattern'
  | 'bass-sound'
  | 'bass-pattern'
  | 'pad-sound'
  | 'pad-pattern'
  | 'drums-sound'
  | 'drums-pattern'
  | 'key'
  | 'mix';

export interface LoopCopyGroup {
  id: LoopCopyGroupId;
  track: LoopCopyTrack;
  aspect: LoopCopyAspect;
  label: string;
  keys: readonly (keyof LoopStatePatch)[];
}

/**
 * A five-track matrix — two aspects per track, three on the chord track — plus two loop-wide groups, and **the only
 * place the grouping is written** — the dialog lays its matrix out from
 * `track`/`aspect`, `buildLoopCopyPatch` reads `keys`, and loopCopy.test.ts
 * asserts the union of every `keys` equals LOOP_FLAT_KEYS exactly.
 *
 * Neither label field appears here and neither can: `name` and `tempName` are
 * loop-slot identity, so `LoopStatePatch` (Omit<Loop, 'id' | 'name' |
 * 'repeatCount' | 'tempName'>) does not carry them and `keyof LoopStatePatch`
 * cannot name one. `repeatCount` is out for the same structural reason — it is
 * arrangement data, not loop content.
 *
 * padVolume/padMuted reach a Loop through PadState rather than through the
 * other ten mixer fields' path; they still belong to `mix`, because the
 * group is the mixer strip a user sees, not the interface a field is
 * declared in.
 */
export const LOOP_COPY_GROUPS: readonly LoopCopyGroup[] = [
  { id: 'lead-sound', track: 'lead', aspect: 'sound', label: 'Lead sound', keys: ['synthParams'] },
  {
    id: 'lead-pattern',
    track: 'lead',
    aspect: 'pattern',
    label: 'Lead pattern',
    keys: [
      'leadMelodySteps',
      'leadLoopLength',
      'leadStepResolution',
      'leadMelodyView',
      'leadMelodyOctave',
      'leadGate',
    ],
  },
  { id: 'fx-sound', track: 'fx', aspect: 'sound', label: 'FX sound', keys: ['fxSynthParams'] },
  {
    id: 'fx-pattern',
    track: 'fx',
    aspect: 'pattern',
    label: 'FX pattern',
    keys: [
      'fxMelodySteps',
      'fxLoopLength',
      'fxStepResolution',
      'fxMelodyView',
      'fxMelodyOctave',
      'fxGate',
    ],
  },
  { id: 'chord-sound', track: 'chord', aspect: 'sound', label: 'Chords sound', keys: ['chordSynthParams'] },
  {
    id: 'chord-progression',
    track: 'chord',
    aspect: 'progression',
    label: 'Chord progression',
    keys: ['chords'],
  },
  {
    id: 'chord-pattern',
    track: 'chord',
    aspect: 'pattern',
    label: 'Chords rhythm',
    keys: ['chordRhythmId', 'chordRhythmMode', 'customChordRhythm', 'chordFeel', 'chordOctave'],
  },
  { id: 'bass-sound', track: 'bass', aspect: 'sound', label: 'Bass sound', keys: ['bassSynthParams'] },
  {
    id: 'bass-pattern',
    track: 'bass',
    aspect: 'pattern',
    label: 'Bass pattern',
    keys: ['bassPatternId', 'bassPatternMode', 'customBassPattern', 'bassFeel', 'bassOctave'],
  },
  { id: 'pad-sound', track: 'pad', aspect: 'sound', label: 'Pad sound', keys: ['padSynthParams'] },
  {
    id: 'pad-pattern',
    track: 'pad',
    aspect: 'pattern',
    label: 'Pad pattern',
    keys: ['padMode', 'padOctave', 'padVoicing', 'padDroneDegree', 'padDroneIntervals'],
  },
  {
    id: 'drums-sound',
    track: 'drums',
    aspect: 'sound',
    label: 'Drums sound',
    keys: ['soundKit', 'drumFilterCutoff', 'drumFilterResonance', 'drumFilterType'],
  },
  { id: 'drums-pattern', track: 'drums', aspect: 'pattern', label: 'Drums pattern', keys: ['sequencerTracks'] },
  { id: 'key', track: 'loop', aspect: 'whole', label: 'Key / Scale', keys: ['scaleRoot', 'scaleType'] },
  {
    id: 'mix',
    track: 'loop',
    aspect: 'whole',
    label: 'Mix',
    keys: [
      'synthVolume',
      'synthMuted',
      'chordVolume',
      'chordMuted',
      'bassVolume',
      'bassMuted',
      'padVolume',
      'padMuted',
      'fxVolume',
      'fxMuted',
      'masterSequencerVolume',
      'drumMuted',
    ],
  },
];

/**
 * Exactly the selected groups' keys, off `source`. Unselected keys are
 * absent, not undefined, so a caller can spread the patch straight over the
 * target loop.
 *
 * `target` exists for one field alone: `sequencerTracks`. Bass and pad each
 * had their per-voice volume/mute pulled out into `mix`, but a
 * `SequencerTrack` bundles a drum voice's `steps` together with its OWN
 * `volume`/`muted` — the fields TrackRow's per-instrument faders own — and no
 * group here names them separately, so a plain copy of the key would drag a
 * mix the user never ticked along with the pattern. 'drums-pattern' copies
 * `steps` only; volume/muted always stay whatever the target track already
 * had.
 */
export function buildLoopCopyPatch(
  source: Loop,
  target: Loop,
  selected: readonly LoopCopyGroupId[],
): Partial<LoopStatePatch> {
  const wanted = new Set<LoopCopyGroupId>(selected);
  const src = source as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const group of LOOP_COPY_GROUPS) {
    if (!wanted.has(group.id)) continue;
    for (const key of group.keys) patch[key] = src[key];
  }
  if (patch.sequencerTracks) {
    const sourceTracks = patch.sequencerTracks as Loop['sequencerTracks'];
    // Walked off the TARGET's roster, not the source's: sanitizeSequencerTracks
    // accepts a short per-loop drum roster as a normal outcome (a loop loaded
    // from an older or hand-edited .solna file may only carry 8 of the 11
    // voices), so a source shorter than target must leave the target's own
    // tracks for the voices it doesn't name untouched rather than deleting
    // them — mapping off `sourceTracks` did exactly that, silently shrinking
    // the target's roster to the source's. Matched by `id`, which is a fixed
    // per-voice constant (`track-kick`, …) every loop's sequencerTracks
    // shares — never by array position, which would silently misalign the
    // moment the roster's order changes.
    patch.sequencerTracks = target.sequencerTracks.map((targetTrack) => {
      const sourceTrack = sourceTracks.find((t) => t.id === targetTrack.id);
      return sourceTrack
        ? { ...sourceTrack, volume: targetTrack.volume, muted: targetTrack.muted }
        : targetTrack;
    });
  }
  // Deep-clone the whole assembled patch, the same way cloneLoop deep-clones
  // a duplicated loop and for the same reason: sequencerTracks,
  // leadMelodySteps, chords, customChordRhythm, customBassPattern and
  // padDroneIntervals are mutable substructure the target must own outright.
  return structuredClone(patch) as Partial<LoopStatePatch>;
}

/**
 * The Chords-implies-Key rule as a predicate, so the coupling is testable
 * without a DOM.
 *
 * `chords` is already-derived, ROOTS-spelled note content; scaleRoot/scaleType
 * is the metadata the key badge renders and every later generation resolves
 * against. Copying a progression into a loop in a different key and leaving
 * the key behind makes the badge lie. It is only ever a DEFAULT the dialog
 * ticks — copying a progression into a different key on purpose is a real
 * musical move, so the user may untick it. It says nothing when the keys
 * already match: a notice that fires every time is a notice nobody reads.
 */
export function impliesKeyCopy(
  source: Loop,
  target: Loop,
  selected: readonly LoopCopyGroupId[],
): boolean {
  if (!selected.includes('chord-progression')) return false;
  return source.scaleRoot !== target.scaleRoot || source.scaleType !== target.scaleType;
}

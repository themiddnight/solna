import type { LoopContent } from './loop';
import type { Loop } from './types';

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
  | 'beat-sound'
  | 'beat-pattern'
  | 'key'
  | 'mix';

export interface LoopCopyGroup {
  id: LoopCopyGroupId;
  track: LoopCopyTrack;
  aspect: LoopCopyAspect;
  label: string;
  keys: readonly (keyof LoopContent)[];
}

/**
 * A five-track matrix — two aspects per track, three on the chord track — plus two loop-wide groups, and **the only
 * place the grouping is written** — the dialog lays its matrix out from
 * `track`/`aspect`, `buildLoopCopyPatch` reads `keys`, and loopCopy.test.ts
 * asserts the union of every `keys` equals LOOP_FLAT_KEYS exactly.
 *
 * Neither label field appears here and neither can: `name` and `tempName` are
 * loop-slot identity, so `LoopContent` (Pick<Loop, LoopFlatKey>) does not
 * carry them and `keyof LoopContent` cannot name one. `repeatCount` is out
 * for the same structural reason — it is arrangement data, not loop content.
 *
 * padVolume/padMuted reach a Loop through PadState rather than through the
 * other ten mixer fields' path; they still belong to `mix`, because the
 * group is the mixer strip a user sees, not the interface a field is
 * declared in.
 */
export const LOOP_COPY_GROUPS: readonly LoopCopyGroup[] = [
  { id: 'lead-sound', track: 'lead', aspect: 'sound', label: 'Lead sound', keys: ['synthParams', 'synthArpSettings'] },
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
  { id: 'fx-sound', track: 'fx', aspect: 'sound', label: 'FX sound', keys: ['fxSynthParams', 'fxArpSettings'] },
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
  { id: 'chord-sound', track: 'chord', aspect: 'sound', label: 'Chords sound', keys: ['chordSynthParams', 'chordArpSettings'] },
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
    keys: [
      'chordRhythmId',
      'chordRhythmMode',
      'customChordRhythm',
      'customChordLoopLength',
      'customChordHoldSteps',
      'chordFeel',
      'chordOctave',
    ],
  },
  { id: 'bass-sound', track: 'bass', aspect: 'sound', label: 'Bass sound', keys: ['bassSynthParams', 'bassArpSettings'] },
  {
    id: 'bass-pattern',
    track: 'bass',
    aspect: 'pattern',
    label: 'Bass pattern',
    keys: [
      'bassPatternId',
      'bassPatternMode',
      'customBassPattern',
      'customBassLoopLength',
      'customBassHoldSteps',
      'bassFeel',
      'bassOctave',
    ],
  },
  { id: 'pad-sound', track: 'pad', aspect: 'sound', label: 'Pad sound', keys: ['padSynthParams', 'padArpSettings'] },
  {
    id: 'pad-pattern',
    track: 'pad',
    aspect: 'pattern',
    label: 'Pad pattern',
    keys: ['padMode', 'padOctave', 'padVoicing', 'padDroneDegree', 'padDroneIntervals'],
  },
  {
    id: 'beat-sound',
    track: 'drums',
    aspect: 'sound',
    label: 'Beat sound',
    // `beatParams` is the WHOLE of the drums' sound — the patch, its output
    // trim and the bus filter all sit inside it — so this group is one key.
    keys: ['beatParams'],
  },
  { id: 'beat-pattern', track: 'drums', aspect: 'pattern', label: 'Beat pattern', keys: ['beatPattern'] },
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
      'beatMix',
      'trackSends',
    ],
  },
];

/**
 * Exactly the selected groups' keys, off `source`. Unselected keys are
 * absent, not undefined, so a caller can spread the patch straight over the
 * target loop.
 *
 * A group's `keys` are the WHOLE of what it copies, for every group. That is
 * what splitting the Beat instrument into three sibling fields bought:
 * `beatParams` holds the sound, `beatPattern` holds the rows and `beatMix`
 * holds the faders and mutes, each complete and each voice-keyed, so no group
 * needs the target loop to work out what a copy means.
 *
 * There is therefore no `target` parameter any more. It existed for one
 * special case — the drum roster used to be an ARRAY a loop could legitimately
 * carry a short version of, so copying it whole would delete the voices the
 * source never named, and the walk had to be off the target's rows matched by
 * id. A voice-keyed record cannot be short: every loop has all eleven, so a
 * copy is a copy.
 */
export function buildLoopCopyPatch(
  source: Loop,
  selected: readonly LoopCopyGroupId[],
): Partial<LoopContent> {
  const wanted = new Set<LoopCopyGroupId>(selected);
  const src = source as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const group of LOOP_COPY_GROUPS) {
    if (!wanted.has(group.id)) continue;
    for (const key of group.keys) patch[key] = src[key];
  }
  // Deep-clone the whole assembled patch, the same way cloneLoop deep-clones
  // a duplicated loop and for the same reason: beatPattern, beatParams,
  // beatMix, leadMelodySteps, chords, customChordRhythm, customChordHoldSteps,
  // customBassPattern, customBassHoldSteps and padDroneIntervals are mutable
  // substructure the target must own outright.
  return structuredClone(patch) as Partial<LoopContent>;
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

import type { ChordItem } from '../types';
import { snapProgressionToScale, transposeProgression } from '../utils/musicTheory';
import { remapLeadMelodyByScale, transposeLeadMelodyByRoot } from '../audio/playback/leadMelody';
import type { LoopContent } from './loop';
import { MELODY_TRACKS } from './melodyTracks';

/** The fields a key change reads. The flat AppStore and every Loop satisfy it. */
export type KeyChangeSource = Pick<
  LoopContent,
  'scaleRoot' | 'scaleType' | 'chords' | 'leadMelodySteps' | 'fxMelodySteps'
>;
export interface KeyChangeTarget {
  root?: string;
  scaleType?: string;
}
export interface KeyChangeOptions {
  /** Transpose-then-snap the progression. Off for content already built in the new key (a vibe). */
  harmonizeChords: boolean;
}

/**
 * The chord half of a key change. Transpose-then-snap is the only correct order
 * for a combined change: snapping first would measure the chords against a root
 * they are not yet in. Neither step changes a chord's `bars`, so the custom
 * lanes' boundaries do not move and need no re-clamp. Null when nothing changes.
 */
export function harmonizeChordsToKey(
  chords: ChordItem[],
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
): ChordItem[] | null {
  if (chords.length === 0) return null;
  const rootChanged = from.root !== to.root;
  const scaleChanged = from.scaleType !== to.scaleType;
  if (!rootChanged && !scaleChanged) return null;
  let next = chords;
  if (rootChanged) next = transposeProgression(next, from.root, to.root);
  if (scaleChanged) next = snapProgressionToScale(next, to.root, to.scaleType);
  return next;
}

/**
 * The whole write a key change makes to one loop's content, pure, so the active
 * loop (setScaleRoot/setScaleType, a vibe) and any loop in loops[] (batch key
 * change) share it. Melodies: every MELODY_TRACKS row transposed by root under
 * the OLD type, then remapped by scale under the NEW root. Chords: harmonized
 * only when asked. Bass (chord-relative tokens), the pad drone (a scale
 * degree), drums and mix hold no absolute pitch and are never in the result.
 */
export function changeKey(
  content: KeyChangeSource,
  target: KeyChangeTarget,
  opts: KeyChangeOptions,
): Partial<LoopContent> {
  const root = target.root ?? content.scaleRoot;
  const type = target.scaleType ?? content.scaleType;
  const patch: Partial<LoopContent> = {};
  if (target.root !== undefined) patch.scaleRoot = root;
  if (target.scaleType !== undefined) patch.scaleType = type;
  for (const track of MELODY_TRACKS) {
    let steps = content[track.steps];
    if (root !== content.scaleRoot) steps = transposeLeadMelodyByRoot(steps, content.scaleRoot, root);
    if (type !== content.scaleType) steps = remapLeadMelodyByScale(steps, root, content.scaleType, type);
    patch[track.steps] = steps;
  }
  if (opts.harmonizeChords) {
    const chords = harmonizeChordsToKey(
      content.chords,
      { root: content.scaleRoot, scaleType: content.scaleType },
      { root, scaleType: type },
    );
    if (chords) patch.chords = chords;
  }
  return patch;
}

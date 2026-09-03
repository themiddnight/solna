import type { Loop, LoopStatePatch } from './types';

/** Every per-loop persisted field, in one source of truth. */
export const LOOP_FLAT_KEYS = [
  'scaleRoot',
  'scaleType',
  'synthParams',
  'chordSynthParams',
  'bassSynthParams',
  'chords',
  'chordRhythmId',
  'chordRhythmMode',
  'customChordRhythm',
  'chordFeel',
  'chordOctave',
  'bassPatternId',
  'bassPatternMode',
  'customBassPattern',
  'bassFeel',
  'bassOctave',
  'leadMelodySteps',
  'leadLoopLength',
  'leadMelodyView',
  'leadMelodyOctave',
  'sequencerTracks',
  'soundKit',
  'drumFilterCutoff',
  'drumFilterResonance',
  'drumFilterType',
  'synthVolume',
  'synthMuted',
  'chordVolume',
  'chordMuted',
  'bassVolume',
  'bassMuted',
  'masterSequencerVolume',
  'drumMuted',
] as const;

/**
 * A loop's length in bars — the same total the chord player already
 * advances through (`chord.bars × stepsPerBar` per chord), so the loop
 * boundary is exactly where the progression wraps.
 */
export function loopBars(chords: readonly { bars?: number }[]): number {
  return chords.reduce((sum, c) => sum + (c.bars || 1), 0);
}

/** Loop ids are new and unique per project (same style as presetsSlice). */
export function newLoopId(): string {
  return `loop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Auto-name "Loop N", where N is one above the highest existing `Loop N`
 * suffix, so a fresh add never collides with a name still in the list. Custom
 * names ("Intro", "Drop") do not consume numbers.
 */
export function nextLoopName(loops: readonly Loop[]): string {
  let max = 0;
  for (const r of loops) {
    const m = /^Loop (\d+)$/.exec(r.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Loop ${max + 1}`;
}

/** The id to make active after deleting `deletedId`: next neighbour, else previous, else first. */
export function fallbackActiveLoopId(loops: readonly Loop[], deletedId: string): string | null {
  const index = loops.findIndex((r) => r.id === deletedId);
  if (index === -1) return null;
  const next = loops[index + 1] ?? loops[index - 1] ?? loops[0];
  return next ? next.id : null;
}

/** Deep clone so a duplicated/added loop can never share mutable substructure with its source. */
export function cloneLoop(loop: Loop): Loop {
  return structuredClone(loop);
}

/**
 * Picks the per-loop fields off any object that carries them — a `Loop`
 * (for `loadLoop`) or the flat `AppStore` (for the sync-back subscription).
 */
export function loopStatePatch(source: object): LoopStatePatch {
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (const key of LOOP_FLAT_KEYS) {
    out[key] = src[key];
  }
  return out as LoopStatePatch;
}

/**
 * The loop the flat slices should show: `activeId` when it names a loop, else
 * the first one. This is the resolution persist `merge` uses on rehydrate and
 * the resolution project Open uses — one function so the two can never drift.
 */
export function resolveActiveLoop(loops: readonly Loop[], activeId: string | null | undefined): Loop {
  return loops.find((l) => l.id === activeId) ?? loops[0];
}

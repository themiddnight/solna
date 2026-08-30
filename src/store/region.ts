import type { Region, RegionStatePatch } from './types';

/** The 31 per-region persisted fields, in one source of truth. */
export const REGION_FLAT_KEYS = [
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
 * A region's length in bars — the same total the chord player already
 * advances through (`chord.bars × stepsPerBar` per chord), so the region
 * boundary is exactly where the progression wraps.
 */
export function regionBars(chords: readonly { bars?: number }[]): number {
  return chords.reduce((sum, c) => sum + (c.bars || 1), 0);
}

/** Region ids are new and unique per project (same style as presetsSlice). */
export function newRegionId(): string {
  return `region-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Auto-name "Region N", where N is one above the highest existing `Region N`
 * suffix, so a fresh add never collides with a name still in the list. Custom
 * names ("Intro", "Drop") do not consume numbers.
 */
export function nextRegionName(regions: readonly Region[]): string {
  let max = 0;
  for (const r of regions) {
    const m = /^Region (\d+)$/.exec(r.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Region ${max + 1}`;
}

/** The id to make active after deleting `deletedId`: next neighbour, else previous, else first. */
export function fallbackActiveId(regions: readonly Region[], deletedId: string): string | null {
  const index = regions.findIndex((r) => r.id === deletedId);
  if (index === -1) return null;
  const next = regions[index + 1] ?? regions[index - 1] ?? regions[0];
  return next ? next.id : null;
}

/** Deep clone so a duplicated/added region can never share mutable substructure with its source. */
export function cloneRegion(region: Region): Region {
  return structuredClone(region);
}

/**
 * Picks the 31 per-region fields off any object that carries them — a `Region`
 * (for `loadRegion`) or the flat `AppStore` (for the sync-back subscription).
 */
export function regionStatePatch(source: object): RegionStatePatch {
  const out: Record<string, unknown> = {};
  const src = source as Record<string, unknown>;
  for (const key of REGION_FLAT_KEYS) {
    out[key] = src[key];
  }
  return out as RegionStatePatch;
}

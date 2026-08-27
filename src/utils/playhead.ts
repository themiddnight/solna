import type { ChordItem } from '../types';
import { getMeter } from './meter';

/**
 * Beats in a 4/4 bar. Only a DEFAULT — the live count is the active meter's
 * `accentGroups.length`, which is what `beatsPerBarFor` returns.
 */
export const BEATS_PER_BAR = 4;

/** Beats per bar for a meter id. 3/4 -> 3, 6/8 -> 2, 7/8 -> 3. */
export function beatsPerBarFor(meterId: string): number {
  return getMeter(meterId).accentGroups.length;
}

export interface NowNextChords {
  now: ChordItem | null;
  next: ChordItem | null;
}

export interface BeatCounterInput {
  /** Absolute beat index since the transport started; null while stopped. */
  playheadBeat: number | null;
  /** Absolute beat index the current chord was triggered on. */
  chordStartBeat: number;
  /** Bars the current chord spans. */
  bars: number;
  /** Beats in one bar; defaults to the 4/4 count. */
  beatsPerBar?: number;
}

export interface BeatCounter {
  totalBeats: number;
  /** Beat currently sounding, 0-based within the counter; null while idle. */
  activeBeat: number | null;
}

export function getNextChordIndex(index: number, length: number): number | null {
  if (length <= 0) return null;
  return (index + 1) % length;
}

/**
 * The chord pair shown in the header. While stopped there is no playing chord,
 * so the head of the progression stands in as a preview of what Play will do.
 */
export function resolveNowNext(chords: ChordItem[], chordIndex: number | null): NowNextChords {
  if (chords.length === 0) return { now: null, next: null };

  const index =
    chordIndex !== null && chordIndex >= 0 && chordIndex < chords.length ? chordIndex : 0;
  const nextIndex = getNextChordIndex(index, chords.length);

  return {
    now: chords[index],
    next: nextIndex === null || nextIndex === index ? null : chords[nextIndex],
  };
}

export function resolveBeatCounter({
  playheadBeat,
  chordStartBeat,
  bars,
  beatsPerBar = BEATS_PER_BAR,
}: BeatCounterInput): BeatCounter {
  const totalBeats = Math.max(1, bars || 1) * beatsPerBar;
  if (playheadBeat === null) return { totalBeats, activeBeat: null };

  const elapsed = playheadBeat - chordStartBeat;
  // A negative elapsed count means the chord has not been triggered yet on this
  // pass (the header can render a beat ahead of the chord scheduler).
  if (elapsed < 0) return { totalBeats, activeBeat: null };

  return { totalBeats, activeBeat: elapsed % totalBeats };
}

/** Splits a beat counter into bars so the view can draw a bar-line divider. */
export function groupBeats(totalBeats: number, barLength = BEATS_PER_BAR): number[][] {
  const groups: number[][] = [];
  for (let start = 0; start < totalBeats; start += barLength) {
    const group: number[] = [];
    for (let beat = start; beat < Math.min(start + barLength, totalBeats); beat++) {
      group.push(beat);
    }
    groups.push(group);
  }
  return groups;
}

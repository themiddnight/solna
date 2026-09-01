import { Note, transpose } from 'tonal';
import type { ArpMode } from '../types';

/**
 * Expand the currently held notes into the note order the arpeggiator plays.
 *
 * Held notes are sorted by pitch, stacked across `octaves`, then arranged by
 * `mode`. Returns an empty array only when nothing playable is held, so the
 * clock subscriber can treat "empty" as "nothing to do".
 */
export function buildArpSequenceUncached(
  heldNotes: Iterable<string>,
  mode: ArpMode,
  octaves: number,
): string[] {
  const notesArray = Array.from(heldNotes).sort((a, b) => {
    const midiA = Note.midi(a) ?? 0;
    const midiB = Note.midi(b) ?? 0;
    return midiA - midiB;
  });

  // `octaves` is a required number (SynthParams.arpOctaves); only the clamp is
  // load-bearing — a 0 or negative value would produce an empty sequence.
  const octCount = Math.max(1, octaves);
  const expanded: string[] = [];
  for (let oct = 0; oct < octCount; oct++) {
    // tonal takes interval notation, not "N oct": one octave up is a perfect
    // 8th, two is a perfect 15th, so octave N is a perfect (7N + 1)th.
    const interval = `${7 * oct + 1}P`;
    for (const noteStr of notesArray) {
      const transposed = transpose(noteStr, interval);
      if (transposed) expanded.push(transposed);
    }
  }
  if (expanded.length === 0) return [];

  if (mode === 'down') return [...expanded].reverse();

  if (mode === 'updown') {
    const rev = [...expanded].reverse();
    if (expanded.length > 2) {
      rev.shift();
      rev.pop();
    }
    return [...expanded, ...rev];
  }

  if (mode === 'random') return [...expanded].sort(() => Math.random() - 0.5);

  return [...expanded];
}

/**
 * How many distinct (heldNotes, mode, octaves) triples stay cached.
 *
 * Eight, not one: the chord arp, the bass arp, the lead arp and the keyboard
 * arp all call buildArpSequence from the SAME clock tick with different held
 * sets, so a one-entry cache would evict on every call and never hit.
 */
export const ARP_SEQUENCE_CACHE_MAX = 8;

const sequenceCache = new Map<string, string[]>();
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Held notes in ITERATION order, not sorted: sorting is the expensive half of
 * the build and doing it to compute a key would defeat the cache. The Set the
 * callers pass keeps insertion order stable for a given press sequence, so the
 * steady-state case (same held notes across many ticks) hits.
 */
function cacheKey(heldNotes: Iterable<string>, mode: ArpMode, octaves: number): string {
  let notes = '';
  for (const note of heldNotes) notes += `${note},`;
  return `${mode}|${octaves}|${notes}`;
}

/** Test-only: hit/miss counters for the memo, so a test can prove N ticks build once. */
export function arpCacheStats(): { hits: number; misses: number } {
  return { hits: cacheHits, misses: cacheMisses };
}

/** Test-only: drops every cached sequence and zeroes the counters. */
export function resetArpSequenceCache(): void {
  sequenceCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Memoized `buildArpSequenceUncached`.
 *
 * This runs inside the lookahead clock callback on every 16th step, for every
 * active arp source, and the uncached build is an Array.from + a sort whose
 * comparator calls Note.midi twice per comparison + one `transpose` per note
 * per octave + up to three more array spreads. Its inputs only change when the
 * held set or the Mode/Octaves knobs change, so all of that was steady-state
 * garbage generated in exactly the callback where a GC pause becomes a
 * scheduling stall.
 *
 * `random` is deliberately NOT cached: it reshuffles on every call today, and
 * that per-step reshuffle is audible behaviour, not an implementation detail.
 *
 * The returned array is SHARED with every other caller holding the same key —
 * callers must treat it as read-only. All three call sites only index it and
 * read `.length`.
 */
export function buildArpSequence(
  heldNotes: Iterable<string>,
  mode: ArpMode,
  octaves: number,
): string[] {
  if (mode === 'random') return buildArpSequenceUncached(heldNotes, mode, octaves);

  const key = cacheKey(heldNotes, mode, octaves);
  const cached = sequenceCache.get(key);
  if (cached) {
    cacheHits++;
    return cached;
  }
  cacheMisses++;
  const built = buildArpSequenceUncached(heldNotes, mode, octaves);
  sequenceCache.set(key, built);
  if (sequenceCache.size > ARP_SEQUENCE_CACHE_MAX) {
    const oldest = sequenceCache.keys().next().value;
    if (oldest !== undefined) sequenceCache.delete(oldest);
  }
  return built;
}


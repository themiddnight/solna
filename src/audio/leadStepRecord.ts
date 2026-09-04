/**
 * Step entry: the decisions behind writing a performed note into the melody
 * grid while the transport is stopped.
 *
 * Pure and separate from the store for the reason every gesture module here
 * is: there is no DOM in this suite to press a key against, so anything left
 * inside an event handler cannot be tested at all.
 */

/** Number of octaves the melody grid's window shows. Fixed at 2 (spec default). */
export const LEAD_WINDOW_OCTAVES = 2;

export interface StepRecordOn {
  held: Set<string>;
  /** False when the key was already down — a key repeat is not a second note. */
  write: boolean;
}

export interface StepRecordOff {
  held: Set<string>;
  /** True only as the LAST held key comes up. See the note below. */
  advance: boolean;
}

/**
 * The cursor advances when the last key is RELEASED, not when a key is
 * pressed. That single choice is what makes chords work: hold C, E and G,
 * let go, and all three land in one column before the cursor moves on.
 * Advancing per press would spread them across three columns and there would
 * be no way to enter a chord at all.
 */
export function stepRecordOn(held: ReadonlySet<string>, note: string): StepRecordOn {
  const next = new Set(held);
  const write = !next.has(note);
  next.add(note);
  return { held: next, write };
}

export function stepRecordOff(held: ReadonlySet<string>, note: string): StepRecordOff {
  const next = new Set(held);
  // A release for a note we never saw pressed must not advance anything: it
  // arrives whenever recording is armed mid-hold, and moving the cursor for
  // a key the recorder never captured would silently skip a column.
  const wasHeld = next.delete(note);
  return { held: next, advance: wasHeld && next.size === 0 };
}

/** The trailing digits of a note name, e.g. 'F#4' -> 4. Null if there are none. */
export function noteOctave(note: string): number | null {
  const match = /(-?\d+)$/.exec(note);
  return match ? Number(match[1]) : null;
}

/**
 * The grid's lowest octave, moved if it has to be, so that `note` falls inside
 * the visible window.
 *
 * The keyboard carries its own octave shift, independent of the grid's, so a
 * recorded note landing outside the window is the normal case rather than the
 * edge case. Storing it anyway would mean invisible data: a note that plays
 * back but that the user cannot see or erase. Following the window instead
 * keeps the promise that everything recorded is on screen the moment it is.
 *
 * Returns null when no legal window can contain the note — the caller must
 * then decline the write rather than record something unreachable.
 */
export function leadRecordOctave(
  note: string,
  lowestOctave: number,
  windowOctaves: number,
  minOctave: number,
  maxOctave: number,
): number | null {
  const oct = noteOctave(note);
  if (oct === null) return null;

  const fits = (lowest: number): boolean => oct >= lowest && oct < lowest + windowOctaves;
  if (fits(lowestOctave)) return lowestOctave;

  // Below the window: put the note on the bottom row. Above it: the top row.
  // Either way the window moves the shortest distance that reveals the note.
  const wanted = oct < lowestOctave ? oct : oct - windowOctaves + 1;
  const clamped = Math.min(maxOctave, Math.max(minOctave, wanted));
  return fits(clamped) ? clamped : null;
}

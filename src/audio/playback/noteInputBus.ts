/**
 * The note-input bus: what a *human* played, announced once, for anything
 * that wants to watch without being in the audio path.
 *
 * Modelled on murva's NoteDispatch. The rule it exists to enforce: recording
 * is a parallel OBSERVER of a played note, never logic embedded in whatever
 * made the sound. Without it, every feature that wants performed notes has to
 * be soldered onto each input source in turn — and solna has three of them
 * (computer keyboard, on-screen keyboard, MIDI), which is three places for the
 * same rule to drift apart.
 *
 * What reaches the bus is exactly what a person played. Sequenced notes do
 * not: playback goes through playbackEngine, not through here.
 */
export type NoteInputKind = 'on' | 'off';

export interface NoteInputEvent {
  kind: NoteInputKind;
  note: string;
  /** 0..1. Always 0 for an 'off'. */
  velocity: number;
  /** The AudioContext time the source scheduled against, if it named one. */
  time?: number;
}

export type NoteInputListener = (event: NoteInputEvent) => void;

const listeners = new Set<NoteInputListener>();

export function subscribeNoteInput(listener: NoteInputListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Callers emit AFTER the sound is already scheduled, never before: a listener
 * that throws must not be able to swallow a note the user played. Listeners
 * are copied before the walk so one that unsubscribes itself mid-emit cannot
 * derail delivery to the rest.
 *
 * Ordering alone is not enough, which is why each call is also isolated. The
 * emit sits in the MIDDLE of its caller — synthPlaybackNoteOff is followed by
 * the polyphony re-scale and the held-note bookkeeping in useInputDeck — so a
 * subscriber that threw would leave the key stuck on screen and every
 * remaining voice at the wrong level, and would rob the other subscribers of
 * the event as well. A bus exists so one observer cannot break another.
 */
export function emitNoteInput(event: NoteInputEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // An observer's failure is not the performer's problem.
    }
  }
}

/** Test-only: drop every listener, so one test's subscriber cannot leak into the next. */
export function resetNoteInputListeners(): void {
  listeners.clear();
}

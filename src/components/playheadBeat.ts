import { useSyncExternalStore } from 'react';

/**
 * The shared clock's beat position, published OUTSIDE the store.
 *
 * The always-mounted rule (docs/decisions/0001-always-mounted-views.md): every tab view and Pattern segment stays mounted, so
 * high-frequency state (the current playback step, a knob mid-drag) must stay
 * local to the subtree that shows it, never in a slice — a slice write
 * re-renders every mounted subscriber and re-runs every store listener.
 * `playbackStep.ts` is the precedent for the 16th step; this is the same
 * shape for the beat. Only the components that call `usePlayheadBeat()` (the
 * header readout and the chord view) re-render when it moves.
 */
export interface PlayheadBeatPublisher {
  get(): number | null;
  /** Records `beat` and notifies — a no-op, with no notify, when unchanged. */
  set(beat: number | null): void;
  subscribe(listener: (beat: number | null) => void): () => void;
}

export function createPlayheadBeatPublisher(): PlayheadBeatPublisher {
  let current: number | null = null;
  const listeners = new Set<(beat: number | null) => void>();
  return {
    get: () => current,
    set(beat) {
      if (Object.is(current, beat)) return;
      current = beat;
      for (const listener of [...listeners]) listener(beat);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The app's one playhead beat, written by `usePlayheadSync`. */
export const playheadBeat: PlayheadBeatPublisher = createPlayheadBeatPublisher();

const subscribeAdapter = (onChange: () => void) => playheadBeat.subscribe(() => onChange());

/**
 * The live beat. `getServerSnapshot` serves the same live value, so a
 * `renderToString` test sees what was published rather than a creation-time copy.
 */
export function usePlayheadBeat(): number | null {
  return useSyncExternalStore(subscribeAdapter, playheadBeat.get, playheadBeat.get);
}

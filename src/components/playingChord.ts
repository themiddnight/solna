import { useSyncExternalStore } from 'react';

/**
 * The chord the Chords player is sounding, published OUTSIDE the store
 * (DEV-422, R313).
 *
 * Written by the chord clock controller in `PlaybackHost`, read by the
 * progression cards — two areas, so it lives here beside `playbackStep.ts` and
 * `playheadBeat.ts`, the same shape as the latter. Never a slice: it changes
 * on every chord, and a slice write re-renders every mounted view (R016).
 */
interface PlayingChord {
  index: number;
  chordId: string;
}

export interface PlayingChordPublisher {
  get(): PlayingChord | null;
  /**
   * Records `value` and notifies. A chord with the same index and id as the
   * current one is a no-op with no notify; `null` (a clear) always notifies,
   * because the chord view resets its held-card highlight on every notify.
   */
  set(value: PlayingChord | null): void;
  subscribe(listener: (value: PlayingChord | null) => void): () => void;
}

export function createPlayingChordPublisher(): PlayingChordPublisher {
  let current: PlayingChord | null = null;
  const listeners = new Set<(value: PlayingChord | null) => void>();
  return {
    get: () => current,
    set(value) {
      if (
        value !== null && current !== null
        && value.index === current.index && value.chordId === current.chordId
      ) return;
      current = value;
      for (const listener of [...listeners]) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The app's one playing chord, written by `useChordClockPlayback`. */
export const playingChord: PlayingChordPublisher = createPlayingChordPublisher();

const subscribeAdapter = (onChange: () => void) => playingChord.subscribe(() => onChange());

/**
 * The live playing chord. `getServerSnapshot` serves the same live value, so a
 * `renderToString` test sees what was published rather than a creation-time copy.
 */
export function usePlayingChord(): PlayingChord | null {
  return useSyncExternalStore(subscribeAdapter, playingChord.get, playingChord.get);
}

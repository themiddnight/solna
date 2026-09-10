import { useEffect } from 'react';
import { useAppStore } from '../store/store';
import { aggregatePlayerState, allPlayerStates } from '../store/transportSlice';
import type { PlayerState } from '../store/types';
import { subscribePlaybackClock } from '../audio/playback/playbackEngine';

/**
 * Pure decision, exported so it is testable without a DOM: the playhead runs
 * whenever ANY registered transport player is active. Kept variadic (rather
 * than taking `AppStore` itself) so the existing per-player unit tests keep
 * working unchanged; the hook below is what feeds it every player, table-
 * driven off `allPlayerStates` so a new player module reaches the playhead
 * for free instead of needing a hand-added argument here.
 */
export function shouldRunPlayheadSync(...players: PlayerState[]): boolean {
  return aggregatePlayerState(...players) !== 'stopped';
}

/**
 * Publishes the shared clock's beat position into the store so any view can
 * show it. Mounted once (App), not per view: the clock keeps running while a
 * subscriber exists, so a per-view subscription would keep the timer alive for
 * whichever tab happened to be rendered.
 *
 * Writes once per beat rather than once per 16th step — the readouts count
 * beats, and a store write every step would notify subscribers four times as
 * often for the same rendered output.
 */
export function usePlayheadSync(): void {
  const isRunning = useAppStore((s) => shouldRunPlayheadSync(...allPlayerStates(s)));

  useEffect(() => {
    const { setPlayheadBeat, setPlayheadChord } = useAppStore.getState();

    if (!isRunning) {
      setPlayheadBeat(null);
      setPlayheadChord(null);
      return;
    }

    let lastBeat = -1;
    return subscribePlaybackClock((_step, beat) => {
      if (beat === lastBeat) return;
      lastBeat = beat;
      useAppStore.getState().setPlayheadBeat(beat);
    });
  }, [isRunning]);
}

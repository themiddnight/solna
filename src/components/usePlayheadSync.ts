import { useEffect } from 'react';
import { useAppStore } from '../store/store';
import { aggregatePlayerState } from '../store/transportSlice';
import type { PlayerState } from '../store/types';
import { subscribePlaybackClock } from '../audio/playback/playbackEngine';

/**
 * Pure decision, exported so it is testable without a DOM: the playhead runs
 * whenever ANY of the three transport players is active. A two-player
 * derivation here would silently drop the lead player from the playhead.
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
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const leadPlayer = useAppStore((s) => s.leadPlayer);
  const isRunning = shouldRunPlayheadSync(sequencerPlayer, chordsPlayer, leadPlayer);

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

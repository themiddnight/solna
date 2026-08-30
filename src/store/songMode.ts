import React from 'react';
import { subscribePlaybackClock } from '../audio/playback/playbackEngine';
import type { ViewMode } from '../types';
import { getMeter } from '../utils/meter';
import { loadRegion } from './loadRegion';
import { regionBars } from './region';
import { useAppStore } from './store';
import type { Region } from './types';

/** Play mode is coupled to the active tab: Arrange = song, every other tab = loop. */
export function isSongTab(tab: ViewMode): boolean {
  return tab === 'arrange';
}

/** The detach rule: leaving the Arrange tab drops the song position. */
export function detachSongPosition(tab: ViewMode, index: number | null): number | null {
  return isSongTab(tab) ? index : null;
}

/** A region's length in steps = Σ chord.bars × stepsPerBar. */
export function regionLengthSteps(chords: readonly { bars?: number }[], stepsPerBar: number): number {
  return regionBars(chords) * stepsPerBar;
}

/** Advance one slot in the arrangement, wrapping to the top (the song loops). */
export function nextRegionIndex(regions: readonly { id: string }[], current: number): number {
  return (current + 1) % regions.length;
}

/** Where the song starts: the active region's list index, else the top. */
export function enterSongIndex(regions: readonly { id: string }[], activeRegionId: string): number {
  const index = regions.findIndex((r) => r.id === activeRegionId);
  return index === -1 ? 0 : index;
}

/**
 * The region id to load when the current region's bars complete on this clock
 * step. `step` is measured from the shared clock's reset origin — after every
 * advance loadRegion hard-stops and restarts, which resets the clock, so each
 * region's boundary is `regionLength` steps from 0 (the same alignment the
 * Instant Vibe swap relies on). Non-boundary steps and loop mode return null.
 */
export function songAdvanceTarget(
  regions: readonly Region[],
  songRegionIndex: number | null,
  step: number,
  stepsPerBar: number,
): string | null {
  if (songRegionIndex === null) return null;
  const region = regions[songRegionIndex];
  if (!region) return null;
  const length = regionLengthSteps(region.chords, stepsPerBar);
  // A region with no chords is a silent bar, not a dead end: dwell it for one
  // bar so the song keeps flowing instead of freezing (a 0 length can never
  // hit the `step % length === 0` boundary).
  const effectiveLength = Math.max(length, stepsPerBar);
  if (step <= 0 || step % effectiveLength !== 0) return null;
  const target = regions[nextRegionIndex(regions, songRegionIndex)]?.id ?? null;
  // A single-region arrangement wraps onto itself: reloading the region we are
  // already in would hard-stop the players and reset the shared clock on every
  // loop. Loop it in place instead, exactly like loop mode.
  return target === region.id ? null : target;
}

export interface SongModeDeps {
  /** Injectable clock subscriber for tests (defaults to the real shared clock). */
  subscribeClock?: (cb: (step: number, beat: number, time: number) => void) => () => void;
}

/**
 * Store-level song-mode coordinator (not a component — mirrors engineSync's
 * shape). Derives song mode from {activeTab, playing}: on the Arrange tab with
 * any player active, entering song mode loads regions[0] (the song restarts
 * from the top) and subscribes to the shared clock; on every region boundary
 * it calls loadRegion(next). Leaving the Arrange tab (or stopping) detaches:
 * the cursor drops to null and the clock subscription is removed — audio never
 * stops, only the advance cursor does, so loop mode keeps looping what was
 * playing (the flat slices already hold the last-sounded region).
 */
export function startSongModeSync(deps: SongModeDeps = {}): () => void {
  const subscribeClock = deps.subscribeClock ?? subscribePlaybackClock;
  let unsubClock: (() => void) | null = null;

  const stopClock = () => {
    if (unsubClock) {
      unsubClock();
      unsubClock = null;
    }
  };

  const reconcile = () => {
    const s = useAppStore.getState();
    const playing =
      s.sequencerPlayer !== 'stopped' || s.chordsPlayer !== 'stopped' || s.leadPlayer !== 'stopped';
    if (isSongTab(s.activeTab) && playing) {
      if (s.songRegionIndex === null) {
        // Enter song mode: establish the cursor BEFORE loadRegion so its
        // transient hardStop→restart (players flip 'stopped' then 'playing')
        // neither re-triggers entry nor reads as a detach.
        useAppStore.setState({ songRegionIndex: 0 });
        loadRegion(s.regions[0]?.id ?? s.activeRegionId);
      } else if (!unsubClock) {
        unsubClock = subscribeClock((step) => {
          const current = useAppStore.getState();
          if (current.songRegionIndex === null) return;
          // Advance only while a player is genuinely playing. A soft-stopping
          // player is releasing on the next bar line, so the boundary that bar
          // line reaches must complete the stop, not jump the song — the old
          // `!== 'stopped'` check treated 'stopping' as playing and cancelled
          // a Stop pressed in the last bar of a region.
          const playingNow =
            current.sequencerPlayer === 'playing' ||
            current.chordsPlayer === 'playing' ||
            current.leadPlayer === 'playing';
          if (!playingNow) return;
          const target = songAdvanceTarget(
            current.regions,
            current.songRegionIndex,
            step,
            getMeter(current.meterId).stepsPerBar,
          );
          if (target === null) return;
          // Defer the swap out of the in-flight dispatch. loadRegion
          // hard-stops and resets the shared clock (engineSync), and doing that
          // mid-dispatch makes the stale boundary step AND the post-reset
          // step 0 both reach the playback hooks, so the incoming region's
          // first chord/notes fire twice (~one step apart). Running the swap
          // after the current turn drains leaves the boundary step with the old
          // region and starts the new one cleanly at step 0.
          queueMicrotask(() => loadRegion(target));
        });
      }
    } else if (!isSongTab(s.activeTab) && s.songRegionIndex !== null) {
      // Detach on leaving the Arrange tab (the spec's detach rule). Stopping
      // while still on Arrange pauses; the clock guard above stops the advance.
      s.setSongRegionIndex(null);
      stopClock();
    }
  };

  reconcile();
  const unsubStore = useAppStore.subscribe(
    (state) => ({
      tab: state.activeTab,
      seq: state.sequencerPlayer,
      chords: state.chordsPlayer,
      lead: state.leadPlayer,
    }),
    reconcile,
    {
      equalityFn: (a, b) =>
        a.tab === b.tab && a.seq === b.seq && a.chords === b.chords && a.lead === b.lead,
    }
  );
  return () => {
    unsubStore();
    stopClock();
  };
}

/** React binding, mounted once at the app root (App.tsx). */
export function useSongModeSync(): void {
  React.useEffect(() => startSongModeSync(), []);
}

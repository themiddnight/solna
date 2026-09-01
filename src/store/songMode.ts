import React from 'react';
import { subscribePlaybackClock } from '../audio/playback/playbackEngine';
import { layerForTab } from '../types';
import type { Layer } from '../types';
import { getMeter } from '../utils/meter';
import { loadLoop } from './loadLoop';
import { loopBars } from './loop';
import { useAppStore } from './store';
import { aggregatePlayerState } from './transportSlice';
import type { Loop } from './types';

/** A loop's length in steps = Σ chord.bars × stepsPerBar. */
export function loopLengthSteps(chords: readonly { bars?: number }[], stepsPerBar: number): number {
  return loopBars(chords) * stepsPerBar;
}

/** Advance one slot in the arrangement, wrapping to the top (the song loops). */
export function nextLoopIndex(loops: readonly { id: string }[], current: number): number {
  return (current + 1) % loops.length;
}

/** Where the song starts: the active loop's list index, else the top. */
export function enterSongIndex(loops: readonly { id: string }[], activeLoopId: string): number {
  const index = loops.findIndex((r) => r.id === activeLoopId);
  return index === -1 ? 0 : index;
}

/**
 * The loop id to load when the current loop's bars complete on this clock
 * step. `step` is measured from the shared clock's reset origin — after every
 * advance loadLoop hard-stops and restarts, which resets the clock, so each
 * loop's boundary is `loopLength` steps from 0 (the same alignment the
 * Instant Vibe swap relies on). Non-boundary steps and loop mode return null.
 */
export function songAdvanceTarget(
  loops: readonly Loop[],
  songLoopIndex: number | null,
  step: number,
  stepsPerBar: number,
): string | null {
  if (songLoopIndex === null) return null;
  const loop = loops[songLoopIndex];
  if (!loop) return null;
  const length = loopLengthSteps(loop.chords, stepsPerBar);
  // A loop with no chords is a silent bar, not a dead end: dwell it for one
  // bar so the song keeps flowing instead of freezing (a 0 length can never
  // hit the `step % length === 0` boundary).
  const effectiveLength = Math.max(length, stepsPerBar);
  const repeats = Math.max(1, loop.repeatCount ?? 1);
  const totalSteps = effectiveLength * repeats;
  if (step <= 0 || step % totalSteps !== 0) return null;
  const target = loops[nextLoopIndex(loops, songLoopIndex)]?.id ?? null;
  // A single-loop arrangement wraps onto itself: reloading the loop we are
  // already in would hard-stop the players and reset the shared clock on every
  // loop. Loop it in place instead, exactly like loop mode.
  return target === loop.id ? null : target;
}

export interface SongModeDeps {
  /** Injectable clock subscriber for tests (defaults to the real shared clock). */
  subscribeClock?: (cb: (step: number, beat: number, time: number) => void) => () => void;
}

/**
 * Store-level song-mode coordinator (not a component — mirrors engineSync's
 * shape). Play mode is keyed on the LAYER, not the tab: the song layer is
 * {arrange, effects} (see `isSongLayer` in ../types), everything else is loop
 * mode. Crossing the loop/song boundary is a HARD STOP — all players are
 * silenced and the song cursor is dropped; the layer never "detaches but keeps
 * looping" the way SP3's Arrange-only rule did. Entering the song layer never
 * auto-starts a song: song mode is entered only when a player is already
 * `playing`, and the cursor is established from the active loop's index
 * (`enterSongIndex`) rather than restarting from the top.
 */
export function startSongModeSync(deps: SongModeDeps = {}): () => void {
  const subscribeClock = deps.subscribeClock ?? subscribePlaybackClock;
  let prevLayer: Layer | null = null;
  let unsubClock: (() => void) | null = null;

  const stopClock = () => {
    if (unsubClock) {
      unsubClock();
      unsubClock = null;
    }
  };

  const reconcile = () => {
    const s = useAppStore.getState();
    const layer = layerForTab(s.activeTab);
    if (prevLayer !== null && prevLayer !== layer) {
      s.hardStopAll();
      s.setSongLoopIndex(null);
      // hardStopAll dispatches 'stop-all', which resets the scope to 'none' —
      // the reducer's layer-change rows are the same transition, so crossing a
      // layer boundary can never preserve a solo.
      stopClock();
      unsubClock = null;
    }
    prevLayer = layer;

    const playing =
      aggregatePlayerState(s.sequencerPlayer, s.chordsPlayer, s.leadPlayer) === 'playing';
    if (layer === 'song' && playing && s.playbackScope.kind !== 'solo') {
      if (s.songLoopIndex === null) {
        useAppStore.setState({ songLoopIndex: enterSongIndex(s.loops, s.activeLoopId) });
      }
      if (!unsubClock) {
        unsubClock = subscribeClock((step) => {
          const cur = useAppStore.getState();
          if (cur.songLoopIndex === null || cur.playbackScope.kind === 'solo') return;
          if (aggregatePlayerState(cur.sequencerPlayer, cur.chordsPlayer, cur.leadPlayer) !== 'playing')
            return;
          const target = songAdvanceTarget(
            cur.loops,
            cur.songLoopIndex,
            step,
            getMeter(cur.meterId).stepsPerBar,
          );
          if (target === null) return;
          // Defer: loadLoop hard-stops and restarts, which resets the shared
          // clock (via engineSync's transport subscription). Running that reset
          // synchronously here mutates clockStepIndex mid-dispatch — this
          // callback is one of clockTick's listeners — so the boundary step's
          // own dispatch and the reset's step-0 re-dispatch collide and the new
          // loop's first chord/drum fires twice. A microtask runs before the
          // next 25 ms clock tick, so the reset lands cleanly on the following
          // tick with every playback hook re-armed.
          queueMicrotask(() => loadLoop(target, { preserveScope: true }));
        });
      }
    } else if (layer !== 'song' || s.playbackScope.kind === 'solo') {
      // soloLoop nulls songLoopIndex in the same set() that flips the scope,
      // so by the time this runs it is often already null — guard the write,
      // not the unsubscribe: the clock must still be torn down here rather
      // than left for the callback's own kind==='solo' early-return to no-op
      // tick after tick.
      if (s.songLoopIndex !== null) s.setSongLoopIndex(null);
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
      scope: state.playbackScope,
    }),
    reconcile,
    {
      equalityFn: (a, b) =>
        a.tab === b.tab &&
        a.seq === b.seq &&
        a.chords === b.chords &&
        a.lead === b.lead &&
        a.scope === b.scope,
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

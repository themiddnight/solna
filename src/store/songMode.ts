import React from 'react';
import { subscribePlaybackClock } from '../audio/playback/playbackEngine';
import { layerForTab } from '../types';
import type { Layer } from '../types';
import { getMeter } from '../utils/meter';
import { loadLoop } from './loadLoop';
import { loopBars } from './loop';
import { playbackScopeReducer } from './playbackScope';
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
 * {arrange, master} (see `isSongLayer` in ../types), everything else is loop
 * mode.
 *
 * Crossing the boundary is NO LONGER an unconditional hard stop. Playback
 * survives a navigation if and only if what sounds afterwards is exactly the
 * loop now in focus — so entering the SONG layer never stops anything (a
 * solo loop is simply carried in and rendered as that card's Stop), and
 * arriving at the LOOP layer stops only when the focus-loop transition lands
 * on SCOPE_NONE with players playing. See the comment inside reconcile for
 * what that reverses and why the old stop must not be restored.
 *
 * Entering the song layer never auto-starts a song: song mode is entered only
 * when a player is already `playing`, and the cursor is established from the
 * active loop's index (`enterSongIndex`) rather than restarting from the top.
 */
export function startSongModeSync(deps: SongModeDeps = {}): () => void {
  const subscribeClock = deps.subscribeClock ?? subscribePlaybackClock;
  let prevLayer: Layer | null = null;
  let prevLoopId: string | null = null;
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
    // The Loop layer's focus changed: either we just arrived on it, or the
    // active loop moved while we were already there. Entering the SONG layer
    // is deliberately not a focus change — see the invariant below.
    const focusChanged =
      layer === 'loop' && (prevLayer !== layer || prevLoopId !== s.activeLoopId);

    // Update both cursors BEFORE any side effect. hardStopAll below notifies
    // subscribers synchronously and re-enters this function; a re-entrant
    // pass that still saw the old cursors would run the same transition a
    // second time.
    prevLayer = layer;
    prevLoopId = s.activeLoopId;

    if (focusChanged) {
      // INVARIANT: playback survives a navigation if and only if what sounds
      // afterwards is exactly the loop now in focus. The scope answers that
      // on its own, so the DECISION is the reducer's (focus-loop) and the
      // code here is only its execution.
      //
      // This REVERSES the rule that used to live here — "crossing a layer
      // boundary can never preserve a solo". That was never a UX decision:
      // per docs/superpowers/plans/2026-09-01-playback-scope-redesign.md the
      // layer-change clear was one of only two ways a stuck auditionLoopId
      // could ever be cleared, a cleanup mechanism from before this union
      // existed. The reducer now makes a stuck scope unreachable by
      // construction and every writer of activeLoopId carries the scope with
      // it (loadLoop, addLoop, duplicateLoop, deleteLoop), so the old
      // unconditional stop was redundant safety, not the safety itself.
      // Do not restore it as a fix: it deletes the Loop->Song carry-over
      // this whole phase exists to build.
      const next = playbackScopeReducer(s.playbackScope, {
        type: 'focus-loop',
        loopId: s.activeLoopId,
      });
      if (next !== s.playbackScope) {
        // SCOPE_NONE is the only non-identity result: what was sounding is
        // not the loop now in focus.
        const wasPlaying =
          aggregatePlayerState(s.sequencerPlayer, s.chordsPlayer, s.leadPlayer) === 'playing';
        if (wasPlaying) {
          // hardStopAll stops the players AND dispatches 'stop-all' — the
          // same SCOPE_NONE — in one set(), so the two are never observed
          // disagreeing.
          s.hardStopAll();
        } else {
          // The only scope write outside transportSlice/restartPlayersPatch,
          // and NOT a sanctioned pattern: it exists solely to clean up a scope
          // left claiming something with every player already stopped, which
          // "playing implies a scope" makes unreachable today. A scope that
          // accompanies a transport change belongs in that change's own set().
          useAppStore.setState({ playbackScope: next });
        }
        // songLoopIndex and the advance subscription are NOT dropped here:
        // the `layer !== 'song'` branch at the bottom of this function
        // already does both, and this path always has layer === 'loop'.
      }
    }

    const playing =
      aggregatePlayerState(s.sequencerPlayer, s.chordsPlayer, s.leadPlayer) === 'playing';
    // The arrangement advances only under the SONG scope. The test used to be
    // `kind !== 'loop'`, which also ran the song under `none` — a claim that
    // the arrangement may play while nothing owns the transport, which is the
    // opposite of what this phase establishes. It was breadth with nothing
    // behind it: playAll sets `song`, soloLoop sets `loop`, both internal
    // stop-and-restarts go through restartAfterStop, and play(module) — the
    // one starter that sets no scope — is allowlisted to transportSlice.ts by
    // playbackScope.test.ts's source scan. Left loose it also broke the row
    // above: focus-loop returns identity on `none`, so a song running under
    // `none` would cross to a loop tab with every player still going and the
    // cursor dropped.
    if (layer === 'song' && playing && s.playbackScope.kind === 'song') {
      if (s.songLoopIndex === null) {
        useAppStore.setState({ songLoopIndex: enterSongIndex(s.loops, s.activeLoopId) });
      }
      if (!unsubClock) {
        unsubClock = subscribeClock((step, _beat, time) => {
          const cur = useAppStore.getState();
          if (cur.songLoopIndex === null || cur.playbackScope.kind === 'loop') return;
          if (aggregatePlayerState(cur.sequencerPlayer, cur.chordsPlayer, cur.leadPlayer) !== 'playing')
            return;
          const target = songAdvanceTarget(
            cur.loops,
            cur.songLoopIndex,
            step,
            getMeter(cur.meterId).stepsPerBar,
          );
          if (target === null) return;
          // Defer: loadLoop re-anchors the shared grid, and running that
          // synchronously here mutates clockStepIndex mid-dispatch — this
          // callback is one of clockTick's own listeners — so the boundary
          // step's dispatch and the rewind's step-0 re-dispatch collide and the
          // new loop's first chord/drum fires twice. A microtask runs before
          // the next 25 ms tick, so the rewind lands cleanly on the following
          // one with every playback hook re-armed.
          //
          // `time` is the boundary step's own audio time. It selects loadLoop's
          // seamless path — no player ever stops, so nothing cuts the outgoing
          // loop's tails — and anchors the incoming loop's step 0 exactly there.
          queueMicrotask(() => loadLoop(target, { atBoundary: time }));
        });
      }
    } else if (layer !== 'song' || s.playbackScope.kind === 'loop') {
      // soloLoop nulls songLoopIndex in the same set() that flips the scope,
      // so by the time this runs it is often already null — guard the write,
      // not the unsubscribe: the clock must still be torn down here rather
      // than left for the callback's own kind==='loop' early-return to no-op
      // tick after tick.
      if (s.songLoopIndex !== null) s.setSongLoopIndex(null);
      stopClock();
    }
  };

  reconcile();
  const unsubStore = useAppStore.subscribe(
    (state) => ({
      tab: state.activeTab,
      // Watched because a cursor move on the Loop layer is a focus change:
      // reconcile must dispatch focus-loop for it, not only for a tab change.
      loop: state.activeLoopId,
      seq: state.sequencerPlayer,
      chords: state.chordsPlayer,
      lead: state.leadPlayer,
      scope: state.playbackScope,
    }),
    reconcile,
    {
      equalityFn: (a, b) =>
        a.tab === b.tab &&
        a.loop === b.loop &&
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

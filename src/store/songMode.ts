import React from 'react';
import {
  scheduleAfterPlaybackClockStep,
  subscribePlaybackClock,
} from '../audio/playback/playbackEngine';
import { layerForTab } from '../types';
import type { Layer } from '../types';
import { getMeter } from '../utils/meter';
import { stepDurationSec } from '../utils/musicTheory';
import { songAdvanceDecision } from '../utils/songStructure';
import { loadLoop } from './loadLoop';
import { playbackScopeReducer } from './playbackScope';
import { useAppStore } from './store';
import { aggregateAllPlayers, playerStatesKey } from './transportSlice';

/** Where the song starts: the active loop's list index, else the top. */
export function enterSongIndex(loops: readonly { id: string }[], activeLoopId: string): number {
  const index = loops.findIndex((r) => r.id === activeLoopId);
  return index === -1 ? 0 : index;
}

export interface SongModeDeps {
  /** Injectable clock subscriber for tests (defaults to the real shared clock). */
  subscribeClock?: (cb: (step: number, beat: number, time: number) => void) => () => void;
  /** Runs after the current step's listeners, before a batched next step. */
  scheduleAfterStep?: (task: () => void) => void;
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
  const scheduleAfterStep = deps.scheduleAfterStep ?? scheduleAfterPlaybackClockStep;
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
          aggregateAllPlayers(s) === 'playing';
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
      aggregateAllPlayers(s) === 'playing';
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
          if (aggregateAllPlayers(cur) !== 'playing') return;
          const stepsPerBar = getMeter(cur.meterId).stepsPerBar;
          const decision = songAdvanceDecision(
            cur.loops,
            cur.songLoopIndex,
            step,
            stepsPerBar,
          );
          if (decision.kind === 'end') {
            // The song has an ending. SOFT stop, not hard: each playback hook
            // sees 'stopping', reaches this same boundary step's bar line and
            // releases with its preset's own release time, so the last chord
            // rings out instead of being cut at HARD_STOP_RELEASE.
            //
            // Synchronous, deliberately — the opposite of the advance below.
            // The stop has to land before the playback hooks process this same
            // boundary step: each of them reads the player state LIVE from the
            // store and plays the step unless it already reads 'stopping'.
            // Deferring this to a microtask would put it after all three had
            // played the step, and the song would run past its own ending.
            //
            // KNOWN ISSUE, and the reason the paragraph above says "has to"
            // rather than "does". It lands first only while THIS listener was
            // registered before the hooks': subscribeClock keeps listeners in a
            // Set and dispatches in insertion order, songMode subscribes from
            // reconcile (a synchronous store subscriber on the set() that starts
            // the players) and each hook subscribes from a useEffect after React
            // commits. Two reachable paths lose that order, both pinned by
            // characterization tests in songMode.test.ts:
            //   1. Any mid-song loadLoop DEFAULT path — picking another loop
            //      card on Arrange, an Instant Vibe — makes three set()s in one
            //      tick (hardStopAll, content, restartPlayersPatch). The middle
            //      state is "song layer, not playing", which reaches the `else`
            //      at the bottom of reconcile and drops this subscription; the
            //      restart re-adds it at the END of the Set. The hooks do not
            //      move: their clock effects are keyed on isPlaying and the
            //      RENDERED state goes 'playing' -> 'playing', so React never
            //      re-runs them (loadLoop's own doc comment relies on that).
            //   2. The one-click takeover — audition a loop card on Arrange,
            //      then press the master Play — establishes the `song` scope
            //      with the players ALREADY playing, so songMode subscribes
            //      after the hooks did. That path predates this ending.
            // Symptom is NOT simply "one extra bar" for a multi-loop song. The
            // "back to the top" rewind below calls loadLoop with this same
            // boundary `time`, whose atBoundary branch calls
            // dropVoicesScheduledFrom for every LOOP_VOICE_SOURCES entry
            // (chord, bass, pad, synth) — which retroactively cancels whatever
            // the hooks already scheduled for the extra bar on those sources,
            // late listener or not. Drums are NOT in that list (fire-and-forget
            // one-shots; see the file-header comment on `atBoundary`), so a hit
            // already triggered plays regardless. A multi-loop song's overrun
            // is therefore one extra bar of drums ALONE (plus a chopped pad
            // tail where padMode was droning across the seam). Only a
            // single-loop song — firstId === activeLoopId below, so the rewind
            // is skipped and nothing gets retroactively cancelled — gets the
            // full-band extra bar, drums included.
            // The fix is to stop depending on listener order at all (decide the
            // ending one step early, or publish the ending step for the hooks'
            // own step actions to consult). Both change either this function's
            // contract or the three hooks, so they are a follow-up, not
            // something to smuggle into the branch that discovered it.
            //
            // softStopAll also dispatches 'stop-all', so the scope goes to
            // `none` in the same set(): a finished song leaves no `song` scope
            // behind for Phase 3's "the scope says what is sounding" to trip
            // over. That set() re-enters reconcile synchronously, which is what
            // drops the cursor and this very subscription (see the `else` at
            // the bottom of reconcile) — deleting a listener from a Set inside
            // its own forEach skips only that listener, so the remaining hooks
            // still get this step.
            cur.softStopAll();
            // Back to the top, so the next Play starts the song from loop 1:
            // reconcile derives its cursor from activeLoopId (enterSongIndex),
            // so the cursor only really moves when the CONTENT does, and
            // content only moves through loadLoop. The seamless path, because
            // the default one would hard-stop mid-release and cut every
            // accompaniment source at LOAD_LOOP_RELEASE — undoing the soft stop
            // one line above (loadLoop's wasPlaying counts a 'stopping' player
            // as active). Deferred because this branch is already ON the
            // boundary: re-anchoring during its listener pass would collide
            // with the step being dispatched.
            const firstId = cur.loops[0]?.id;
            if (firstId !== undefined && firstId !== cur.activeLoopId) {
              queueMicrotask(() => loadLoop(firstId, { atBoundary: time }));
            }
            return;
          }
          // Pre-arm the advance one step EARLY. The boundary decision is
          // deterministic, so at step N-1 we already know step N crosses.
          // Scheduling loadLoop from here (rather than reacting to the boundary
          // step) runs the resetClock re-anchor a full 16th earlier, so its
          // `atBoundary > currentTime` guard never trips the `now + 0.05`
          // fallback under clock-tick jitter — the gap the late boundary
          // dispatch used to open. The clock's post-step queue runs only after
          // every listener has consumed N-1, but before its synchronous
          // lookahead loop may dispatch N. That ordering keeps N-1 on the
          // outgoing content and step 0 on the incoming content even when both
          // fit in one clockTick; a microtask would run only after both.
          const nextDecision = songAdvanceDecision(
            cur.loops,
            cur.songLoopIndex,
            step + 1,
            stepsPerBar,
          );
          if (nextDecision.kind === 'advance') {
            scheduleAfterStep(() =>
              loadLoop(nextDecision.loopId, { atBoundary: time + stepDurationSec(cur.bpm) }),
            );
          }
        });
      }
    } else {
      // soloLoop nulls songLoopIndex in the same set() that flips the scope,
      // so by the time this runs it is often already null — guard the write,
      // not the unsubscribe: the clock must still be torn down here rather
      // than left for the callback's own kind==='loop' early-return to no-op
      // tick after tick.
      //
      // A plain `else`, not `layer !== 'song' || scope.kind === 'loop'`: that
      // condition missed the state a finished song lands in — song layer, not
      // playing, scope `none` — which matched NEITHER branch, so the advance
      // subscription survived with nothing playing. subscribeClock only stops
      // the timer when its LAST listener goes, so one retained listener keeps
      // the shared 16th clock running and blocks idle suspend, against
      // CLAUDE.md's "the clock runs if and only if a player holds a
      // subscription". The same gap swallowed a user-initiated Stop on the
      // Song layer. The only state this newly catches is "song layer, nothing
      // playing", which wants exactly this: no cursor, no advance listener.
      //
      // It is also what path 1 of the KNOWN ISSUE above trips over: loadLoop's
      // default path passes through "song layer, nothing playing" on its way
      // back to playing, so a mid-song loop switch tears this subscription down
      // and the restart re-registers it behind the playback hooks'. Narrowing
      // the condition back is not the answer — the state a finished song lands
      // in and the state that transient passes through are the same state, and
      // the old condition simply missed both.
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
      // Every registered player, table-driven — folded to one scalar so the
      // equalityFn below stays a plain `===` per field, and so this selector
      // allocates nothing on a store `set()` it does not care about. A
      // hand-listed `seq`/`chords`/`lead` trio here is exactly the bug this
      // closes: it watched three of four players, so an fx-only transition
      // never woke reconcile.
      players: playerStatesKey(state),
      scope: state.playbackScope,
    }),
    reconcile,
    {
      equalityFn: (a, b) =>
        a.tab === b.tab &&
        a.loop === b.loop &&
        a.players === b.players &&
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

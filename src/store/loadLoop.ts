import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import { padHoldsAcrossLoop } from '../audio/playback/padPlayback';
import { loopStatePatch } from './loop';
import { useAppStore } from './store';
import { commitRestartAfterStop } from './stopAndRestart';
import { withSourceTransitionTime } from './sourceTransition';
import { anyPlayerActive, captureActivePlayers } from './transportSlice';
import { MELODY_TRACKS } from './melodyTracks';
import { rescopeToLoop, scopedLoopId } from './playbackScope';
import type { AppStore, DeletedLoop } from './types';

/** Same instant-but-clickless release the vibe swap and hard stop use. */
export const LOAD_LOOP_RELEASE = 0.02;

/**
 * The four note buses a loop owns; drums are one-shots and hold no voices.
 * The accompaniment plus 'synth', which the loop's lead line and the keyboard
 * share — a loop switch drops the lead's queued notes, so this set is wider
 * than the one a stop silences.
 */
const LOOP_VOICE_SOURCES = [...ACCOMPANIMENT_SOURCES, 'synth'] as const;

/**
 * Atomic loop switch. Every switch (selector pick, Arrange click,
 * duplicate, delete-Undo, song advance) MUST pass through here, so the flat
 * slices and activeLoopId can never disagree with loops[]. The one exception is
 * deleting the active loop: `deleteLoop` writes the fallback's fields in its own
 * set(), because a deleted loop has no content left to keep sounding — and
 * `deleteLoopLive` below wraps that write in the same seam a song advance
 * crosses when the transport is running.
 *
 * Two paths, and the difference between them is the difference between a
 * switch the user asked for and a seam the arrangement crosses on its own.
 *
 * **Default — the user picked a different loop.** Reuses the
 * applyVibeToStore swap verbatim: capture who was active -> hardStopAll
 * -> cut the chord/bass sources -> load the loop's per-loop fields -> restart
 * whoever was playing. A state-only swap would leave the OLD loop's queued
 * chord/bass voices ringing over the new one — the exact React-18-batching
 * reason documented in vibes.ts (the rendered player state goes
 * 'playing' -> 'playing', so a React effect keyed on it never runs and the cut
 * must happen here, synchronously). Drums are fire-and-forget one-shots; one
 * already-scheduled hit can still land, which the spec accepts.
 *
 * **`atBoundary` — the arrangement advanced.** Only song mode passes it: the
 * audio time of the boundary step that triggered the switch. Crossing from one
 * loop to the next is not a Stop, and routing it through one cost four audible
 * things — both playback hooks read a stop as a user Stop and cut 'chord',
 * 'bass', 'synth' and 'pad' to HARD_STOP_RELEASE from "now", which truncated every
 * tail to 20 ms whatever the preset asked for, deleted the outgoing loop's
 * notes still queued inside the 0.1 s lookahead before they ever sounded,
 * killed any note held on the keyboard or MIDI (the same 'synth' bus), and took
 * the sequencer's pitched track with it.
 *
 * So the seamless path never touches player state. Nothing stops, so no hook
 * cuts anything, and the outgoing loop's voices ring across the seam with the
 * envelopes their presets asked for. Two things happen instead: the outgoing
 * loop's notes queued PAST the boundary are dropped (they would sound over the
 * incoming loop), and the shared grid is re-anchored so step 0 lands exactly on
 * the boundary instant rather than a fixed 50 ms ahead of wall-clock now, which
 * used to put the downbeat 25-42 ms EARLY. clock.test.ts measures both.
 *
 * Scope, on both paths. The seamless path never calls hardStopAll, so the
 * caller's scope simply survives it. The default path does call it, and
 * restartAfterStop then decides what comes back: on the LOOP layer the
 * switch is seamless and the scope re-points to the loop just loaded; on the
 * SONG layer picking a DIFFERENT loop while one is auditioning stops the
 * audition instead of moving it (spec §6 row 3); a song scope survives
 * either way; and a load with nothing playing leaves `none`.
 */
export function loadLoop(id: string, opts: { atBoundary?: number } = {}): void {
  const store = useAppStore.getState();
  const loop = store.loops.find((r) => r.id === id);
  if (!loop) return;

  // Song mode keeps the cursor on the loaded loop; loop mode stays null.
  const songLoopIndex =
    store.songLoopIndex !== null
      ? Math.max(0, store.loops.findIndex((r) => r.id === id))
      : null;

  if (opts.atBoundary !== undefined) {
    crossLoopSeam(
      store.padMode,
      () => useAppStore.setState({ ...loopStatePatch(loop), activeLoopId: id, songLoopIndex }),
      opts.atBoundary,
    );
    return;
  }

  // Captured BEFORE hardStopAll, which resets the scope to `none` and stops
  // every player.
  const scopeBefore = store.playbackScope;
  const wasActive = captureActivePlayers(store);
  store.hardStopAll();
  for (const source of ACCOMPANIMENT_SOURCES) {
    audioEngine.stopSource(source, LOAD_LOOP_RELEASE);
  }

  useAppStore.setState({
    ...loopStatePatch(loop),
    activeLoopId: id,
    songLoopIndex,
  });
  // Same rule as the boundary path above: vibeNav.ts's activeLoopId
  // subscription clears the chip here, and leaves it alone when this write
  // re-lands on the loop already active (an audition toggle, a re-select).

  // Restart what the decision allows, WITH the scope it should leave behind —
  // see commitRestartAfterStop for the rule and the no-op guard. The layer it
  // reads decides which user action this is: switching the loop being EDITED
  // (loop layer, seamless) or picking a different loop to work on from Arrange
  // while one is auditioning (song layer, stops).
  //
  // The playback hooks arm on the next bar line for the active meter, so a
  // restart lands on beat 1 with no alignment code (the same guarantee the
  // Instant Vibe swap relies on).
  //
  // It stays a SEPARATE set() from the content patch above, deliberately: the
  // content patch must reach engineSync's per-value subscriptions BEFORE the
  // transport's stopped->playing transition, which is what re-anchors the
  // clock. Folding the two together would leave that ordering to subscriber
  // registration order.
  commitRestartAfterStop(scopeBefore, id, wasActive);
}

/**
 * The seam a running transport crosses from one loop to another WITHOUT
 * stopping — the one implementation both kinds of seam go through.
 *
 * `atBoundary` given — the arrangement advanced (see `loadLoop`): the outgoing
 * loop's voices ring across the seam with their own envelopes, and only what
 * it queued PAST the boundary (plus a drone) is dropped.
 *
 * `atBoundary` omitted — the loop the transport is playing stops existing
 * MID-PASS (deleting it, or undoing that delete). There is no boundary to
 * ring across: a full-hold chord, bass or pad was booked to end at a chord
 * change that will now never come, so every accompaniment voice is cut now
 * at LOAD_LOOP_RELEASE, and the melody grids' own notes with it (their owner
 * only, so a key held on the same bus keeps sounding). The clock reset then
 * starts the incoming loop at step 0, exactly as a song advance does.
 *
 * `write` is the store write that installs the incoming loop; it runs between
 * the cut and the clock reset, which is what re-arms every scheduler.
 */
function crossLoopSeam(
  outgoingPadMode: AppStore['padMode'],
  write: () => void,
  atBoundary?: number,
): void {
  if (atBoundary === undefined) {
    for (const source of ACCOMPANIMENT_SOURCES) {
      audioEngine.stopSource(source, LOAD_LOOP_RELEASE);
    }
    for (const track of MELODY_TRACKS) {
      audioEngine.stopOwnedVoices(track.engineSource, 'sequencer', LOAD_LOOP_RELEASE);
    }
    write();
    audioEngine.resetClock();
    return;
  }
  for (const source of LOOP_VOICE_SOURCES) {
    audioEngine.dropVoicesScheduledFrom(source, atBoundary);
  }
  // A drone's startTime is the start of its pass, strictly BEFORE the
  // boundary, so dropVoicesScheduledFrom above never touches it even with
  // 'pad' in LOOP_VOICE_SOURCES — it holds until its own note-off at pass
  // end while resetClock rewinds the grid and the incoming loop's armPad
  // strikes a second drone on top: two drones, in two keys, for up to a
  // full pass. Cut it here, but ONLY when the OUTGOING loop (read from the
  // store snapshot `loadLoop` read, before it is replaced) was droning: this path's
  // whole premise is that a voice rings across the seam "with the envelope
  // its preset asked for", and a drone's length is set by the loop pass
  // rather than by that envelope, so a drone falls outside the premise. A
  // pad-mode tail does not, and cutting it too would make this path sound
  // worse than the hard-stop path for no reason.
  // Anchored at the boundary, not at `now`: the boundary sits up to one
  // scheduler lookahead (0.1 s) in the future, and releasing from `now`
  // would open an audible hole at the END of the outgoing pass — the exact
  // seam this path exists to keep closed.
  if (padHoldsAcrossLoop(outgoingPadMode)) {
    audioEngine.stopSource('pad', LOAD_LOOP_RELEASE, atBoundary);
  }
  withSourceTransitionTime(atBoundary, write);
  // The vibe chip highlight clears itself here: vibeNav.ts watches
  // activeLoopId and clears selectedVibeId on any change, including this
  // one, and leaves it alone when the id written above is the one already
  // active (a re-select, an audition toggle on the same card) — a bare
  // `Object.is` selector already IS that "did we actually leave" check, so
  // there is nothing left for this call site to gate.
  // Rewinding the grid is what re-arms every scheduler onto the new loop:
  // useChordClockPlayback's rewindChordOnClockReset sees the step go backwards and
  // restarts the progression at chord 0, while the lead and drum steppers arm
  // bar-relative and so enter on step 0. No player transition is involved.
  audioEngine.resetClock(atBoundary);
}

/**
 * Whether deleting (or restoring) `id` changes the loop a RUNNING transport
 * is playing without stopping it. A loop audition scoped to the deleted loop
 * is not such a case: `deleteLoop` stops it in its own write.
 */
function switchesRunningLoop(store: AppStore, id: string): boolean {
  return (
    id === store.activeLoopId &&
    anyPlayerActive(captureActivePlayers(store)) &&
    scopedLoopId(store.playbackScope) !== id
  );
}

/**
 * `deleteLoop` for the UI. Deleting the ACTIVE loop while the transport runs
 * never stops it: the fallback enters through `crossLoopSeam`'s mid-pass
 * branch — the deleted loop's voices are cut and the clock is reset, so the
 * fallback starts at step 0 and song advance counts a whole pass of it.
 * `deleteLoop`'s own single write is the `write` the seam wraps. Every other
 * delete (a non-active loop, nothing playing) is the plain state delete.
 */
export function deleteLoopLive(id: string): DeletedLoop | null {
  const store = useAppStore.getState();
  if (store.loops.length <= 1 || !switchesRunningLoop(store, id)) {
    return store.deleteLoop(id);
  }
  let deleted: DeletedLoop | null = null;
  crossLoopSeam(store.padMode, () => {
    deleted = store.deleteLoop(id);
  });
  return deleted;
}

/**
 * Undo for `deleteLoopLive`. Re-inserts the loop, and when it was the active
 * one, re-activates it: through the same mid-pass seam when the transport is
 * running (so Undo never stops it either), through `loadLoop`'s ordinary
 * switch when nothing plays.
 */
export function undoLoopDelete(deleted: DeletedLoop): void {
  const before = useAppStore.getState();
  before.restoreLoop(deleted);
  if (!deleted.wasActive) return;
  const store = useAppStore.getState();
  const loop = store.loops.find((r) => r.id === deleted.loop.id);
  if (!loop) return;
  if (!anyPlayerActive(captureActivePlayers(store))) {
    loadLoop(loop.id);
    return;
  }
  const songLoopIndex =
    store.songLoopIndex !== null ? Math.max(0, store.loops.indexOf(loop)) : null;
  // A loop audition started on the fallback after the delete follows the
  // cursor back, the way addLoop/duplicateLoop move it; a song scope stays.
  crossLoopSeam(store.padMode, () =>
    useAppStore.setState({
      ...loopStatePatch(loop),
      activeLoopId: loop.id,
      songLoopIndex,
      playbackScope: rescopeToLoop(store.playbackScope, loop.id),
    }),
  );
}

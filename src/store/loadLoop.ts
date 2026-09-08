import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import { padHoldsAcrossLoop } from '../audio/playback/padPlayback';
import { layerForTab } from '../types';
import { loopStatePatch } from './loop';
import { restartAfterStop } from './playbackScope';
import { useAppStore } from './store';
import { NO_PLAYERS_ACTIVE, restartPlayersPatch } from './transportSlice';

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
 * duplicate/delete fallback, song advance) MUST pass through here, so the flat
 * slices and activeLoopId can never disagree with loops[].
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
    for (const source of LOOP_VOICE_SOURCES) {
      audioEngine.dropVoicesScheduledFrom(source, opts.atBoundary);
    }
    // A drone's startTime is the start of its pass, strictly BEFORE the
    // boundary, so dropVoicesScheduledFrom above never touches it even with
    // 'pad' in LOOP_VOICE_SOURCES — it holds until its own note-off at pass
    // end while resetClock rewinds the grid and the incoming loop's armPad
    // strikes a second drone on top: two drones, in two keys, for up to a
    // full pass. Cut it here, but ONLY when the OUTGOING loop (read from the
    // store snapshot above, before it is replaced) was droning: this path's
    // whole premise is that a voice rings across the seam "with the envelope
    // its preset asked for", and a drone's length is set by the loop pass
    // rather than by that envelope, so a drone falls outside the premise. A
    // pad-mode tail does not, and cutting it too would make this path sound
    // worse than the hard-stop path for no reason.
    // Anchored at the boundary, not at `now`: the boundary sits up to one
    // scheduler lookahead (0.1 s) in the future, and releasing from `now`
    // would open an audible hole at the END of the outgoing pass — the exact
    // seam this path exists to keep closed.
    if (padHoldsAcrossLoop(store.padMode)) {
      audioEngine.stopSource('pad', LOAD_LOOP_RELEASE, opts.atBoundary);
    }
    useAppStore.setState({ ...loopStatePatch(loop), activeLoopId: id, songLoopIndex });
    // Rewinding the grid is what re-arms every scheduler onto the new loop:
    // useChordPlayback's rewindChordOnClockReset sees the step go backwards and
    // restarts the progression at chord 0, while the lead and drum steppers arm
    // bar-relative and so enter on step 0. No player transition is involved.
    audioEngine.resetClock(opts.atBoundary);
    return;
  }

  // Captured BEFORE hardStopAll, which resets the scope to `none`.
  const scopeBefore = store.playbackScope;
  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
  const wasPlaying = wasActive.sequencer || wasActive.chords || wasActive.lead;
  // The layer decides which user action this is: switching the loop being
  // EDITED (loop layer, seamless) or picking a different loop to work on from
  // Arrange while one is auditioning (song layer, stops). See restartAfterStop.
  const decision = restartAfterStop(scopeBefore, id, layerForTab(store.activeTab), wasPlaying);
  store.hardStopAll();
  for (const source of ACCOMPANIMENT_SOURCES) {
    audioEngine.stopSource(source, LOAD_LOOP_RELEASE);
  }

  useAppStore.setState({ ...loopStatePatch(loop), activeLoopId: id, songLoopIndex });

  // Restart what the decision allows, WITH the scope it should leave behind.
  // The playback hooks arm on the next bar line for the active meter, so a
  // restart lands on beat 1 with no alignment code (the same guarantee the
  // Instant Vibe swap relies on). Declining to restart needs no extra work:
  // hardStopAll above already silenced everything, so the patch just carries
  // SCOPE_NONE and the transport is genuinely stopped.
  //
  // One set(), not three play(module) calls: play(module) sets no scope, so
  // the old form left players 'playing' under the `none` scope hardStopAll
  // had just written — the hole Phase 1 documented at PlaybackScope and this
  // closes. It stays a SEPARATE set() from the content patch above, though,
  // and deliberately: the content patch must reach engineSync's per-value
  // subscriptions BEFORE the transport's stopped->playing transition, which
  // is what re-anchors the clock. Folding the two together would leave that
  // ordering to subscriber registration order.
  useAppStore.setState(
    restartPlayersPatch(decision.restart ? wasActive : NO_PLAYERS_ACTIVE, decision.scope),
  );
}

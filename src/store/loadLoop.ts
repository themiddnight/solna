import { audioEngine } from '../audio/engine';
import { loopStatePatch } from './loop';
import { useAppStore } from './store';

/** Same instant-but-clickless release the vibe swap and hard stop use. */
export const LOAD_LOOP_RELEASE = 0.02;

/** The three note buses a loop owns; drums are one-shots and hold no voices. */
const LOOP_VOICE_SOURCES = ['chord', 'bass', 'synth'] as const;

/**
 * Atomic loop switch. Every switch (selector pick, Arrange click,
 * duplicate/delete fallback, song advance) MUST pass through here, so the flat
 * slices and activeLoopId can never disagree with loops[].
 *
 * Two paths, and the difference between them is the difference between a
 * switch the user asked for and a seam the arrangement crosses on its own.
 *
 * **Default — the user picked a different loop.** Reuses the
 * applyInstantVibeToStore swap verbatim: capture who was active -> hardStopAll
 * -> cut the chord/bass sources -> load the loop's per-loop fields -> restart
 * whoever was playing. A state-only swap would leave the OLD loop's queued
 * chord/bass voices ringing over the new one — the exact React-18-batching
 * reason documented in instantVibes.ts (the rendered player state goes
 * 'playing' -> 'playing', so a React effect keyed on it never runs and the cut
 * must happen here, synchronously). Drums are fire-and-forget one-shots; one
 * already-scheduled hit can still land, which the spec accepts.
 *
 * **`atBoundary` — the arrangement advanced.** Only song mode passes it: the
 * audio time of the boundary step that triggered the switch. Crossing from one
 * loop to the next is not a Stop, and routing it through one cost four audible
 * things — both playback hooks read a stop as a user Stop and cut 'chord',
 * 'bass' and 'synth' to HARD_STOP_RELEASE from "now", which truncated every
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
 * The song scope needs no preserving on that path either: it only ever decayed
 * because hardStopAll dispatched 'stop-all', and nothing here calls it.
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
    useAppStore.setState({ ...loopStatePatch(loop), activeLoopId: id, songLoopIndex });
    // Rewinding the grid is what re-arms every scheduler onto the new loop:
    // useChordPlayback's rewindChordOnClockReset sees the step go backwards and
    // restarts the progression at chord 0, while the lead and drum steppers arm
    // bar-relative and so enter on step 0. No player transition is involved.
    audioEngine.resetClock(opts.atBoundary);
    return;
  }

  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
  store.hardStopAll();
  audioEngine.stopSource('chord', LOAD_LOOP_RELEASE);
  audioEngine.stopSource('bass', LOAD_LOOP_RELEASE);

  useAppStore.setState({ ...loopStatePatch(loop), activeLoopId: id, songLoopIndex });

  // Restart whatever was playing. The playback hooks arm on the next bar line
  // for the active meter, so the restart lands on beat 1 with no alignment
  // code (the same guarantee the Instant Vibe swap relies on).
  if (wasActive.sequencer) store.play('sequencer');
  if (wasActive.chords) store.play('chords');
  if (wasActive.lead) store.play('lead');
}

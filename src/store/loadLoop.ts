import { audioEngine } from '../audio/engine';
import { loopStatePatch } from './loop';
import { useAppStore } from './store';

/** Same instant-but-clickless release the vibe swap and hard stop use. */
export const LOAD_LOOP_RELEASE = 0.02;

/**
 * Atomic loop switch, reusing the applyInstantVibeToStore swap verbatim:
 * capture who was active -> hardStopAll -> cut the chord/bass sources -> load
 * the loop's 31 per-loop fields into the flat slices -> restart whoever
 * was playing. Every switch (selector pick, Arrange click, duplicate/delete
 * fallback, song advance) MUST pass through here, so the flat slices and
 * activeLoopId can never disagree with loops[].
 *
 * A state-only swap would leave the OLD loop's queued chord/bass voices
 * ringing over the new one — the exact React-18-batching reason documented in
 * instantVibes.ts (the rendered player state goes 'playing' -> 'playing', so a
 * React effect keyed on it never runs and the cut must happen here,
 * synchronously). Drums are fire-and-forget one-shots; one already-scheduled
 * hit can still land, which the spec accepts.
 */
export function loadLoop(id: string): void {
  const store = useAppStore.getState();
  const loop = store.loops.find((r) => r.id === id);
  if (!loop) return;

  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
  store.hardStopAll();
  audioEngine.stopSource('chord', LOAD_LOOP_RELEASE);
  audioEngine.stopSource('bass', LOAD_LOOP_RELEASE);

  useAppStore.setState({
    ...loopStatePatch(loop),
    activeLoopId: id,
    // Song mode keeps the cursor on the loaded loop; loop mode stays null.
    songLoopIndex:
      store.songLoopIndex !== null
        ? Math.max(0, store.loops.findIndex((r) => r.id === id))
        : null,
  });

  // Restart whatever was playing. The playback hooks arm on the next bar line
  // for the active meter, so the restart lands on beat 1 with no alignment
  // code (the same guarantee the Instant Vibe swap relies on).
  if (wasActive.sequencer) store.play('sequencer');
  if (wasActive.chords) store.play('chords');
  if (wasActive.lead) store.play('lead');
}

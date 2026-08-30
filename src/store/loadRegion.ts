import { audioEngine } from '../audio/engine';
import { regionStatePatch } from './region';
import { useAppStore } from './store';

/** Same instant-but-clickless release the vibe swap and hard stop use. */
export const LOAD_REGION_RELEASE = 0.02;

/**
 * Atomic region switch, reusing the applyInstantVibeToStore swap verbatim:
 * capture who was active -> hardStopAll -> cut the chord/bass sources -> load
 * the region's 31 per-region fields into the flat slices -> restart whoever
 * was playing. Every switch (selector pick, Arrange click, duplicate/delete
 * fallback, song advance) MUST pass through here, so the flat slices and
 * activeRegionId can never disagree with regions[].
 *
 * A state-only swap would leave the OLD region's queued chord/bass voices
 * ringing over the new one — the exact React-18-batching reason documented in
 * instantVibes.ts (the rendered player state goes 'playing' -> 'playing', so a
 * React effect keyed on it never runs and the cut must happen here,
 * synchronously). Drums are fire-and-forget one-shots; one already-scheduled
 * hit can still land, which the spec accepts.
 */
export function loadRegion(id: string): void {
  const store = useAppStore.getState();
  const region = store.regions.find((r) => r.id === id);
  if (!region) return;

  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
  store.hardStopAll();
  audioEngine.stopSource('chord', LOAD_REGION_RELEASE);
  audioEngine.stopSource('bass', LOAD_REGION_RELEASE);

  useAppStore.setState({
    ...regionStatePatch(region),
    activeRegionId: id,
    // Song mode keeps the cursor on the loaded region; loop mode stays null.
    songRegionIndex:
      store.songRegionIndex !== null
        ? Math.max(0, store.regions.findIndex((r) => r.id === id))
        : null,
  });

  // Restart whatever was playing. The playback hooks arm on the next bar line
  // for the active meter, so the restart lands on beat 1 with no alignment
  // code (the same guarantee the Instant Vibe swap relies on).
  if (wasActive.sequencer) store.play('sequencer');
  if (wasActive.chords) store.play('chords');
  if (wasActive.lead) store.play('lead');
}

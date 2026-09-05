import { useAppStore } from '@/store/store';
import { useCurrentStep } from '@/components/playbackStep';
import { leadMarkerColumn } from './melodyGrid';

/**
 * The marker's column, from whichever source is live. The two sources are
 * deliberately NOT merged into one stored value: stepPublisher stays outside
 * zustand so the re-render lands on the leaf that draws the marker, and
 * leadCursor stays in the store so a header click during playback still
 * takes effect the moment the transport stops.
 *
 * The marker follows the clock only while the lead player is running, because
 * useLeadPlayback is the only thing that publishes a lead step and it
 * subscribes to the clock only then. The recorder's own gate is wider —
 * leadClockActive, which counts the metronome and the other sections — so
 * with the lead stopped but something else playing, capture is in time while
 * the marker is not. Widening this predicate without also widening the
 * producer just freezes the marker at a stale zero, which is worse than
 * leaving it on the cursor. Closing the gap properly needs a lead-step
 * producer gated on leadClockActive; that is DEV-378.
 *
 * Note the renderToString trap: zustand serves the creation-time state as
 * the server snapshot, so a test that sets leadCursor and renders the grid
 * sees column 0. Marker geometry is tested through LeadMarker's own prop.
 */
export function useLeadMarkerColumn(columns: number): number {
  const currentStep = useCurrentStep('lead');
  const cursor = useAppStore((s) => s.leadCursor);
  const isPlaying = useAppStore((s) => s.leadPlayer !== 'stopped');
  return leadMarkerColumn(isPlaying, currentStep, cursor, columns);
}

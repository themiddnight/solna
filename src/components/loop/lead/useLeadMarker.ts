import { useAppStore } from '@/store/store';
import { leadClockActive } from '@/store/leadRecord';
import { useCurrentStep } from '@/components/playbackStep';
import { leadMarkerColumn } from './melodyGrid';

/**
 * The marker's column, from whichever source is live. The two sources are
 * deliberately NOT merged into one stored value: stepPublisher stays outside
 * zustand so the re-render lands on the leaf that draws the marker, and
 * leadCursor stays in the store so a header click during playback still
 * takes effect the moment the transport stops.
 *
 * The live source is leadClockActive — any section playing, or the metronome
 * alone — and NOT `leadPlayer !== 'stopped'`, because this column is also
 * where live capture writes and the recorder uses that same predicate
 * (store/leadRecord.ts). With the narrower one, playing along to the drums
 * with the lead stopped put every captured note in time while the marker sat
 * on the cursor, pointing at a column nothing was being written to.
 *
 * This predicate is only safe because useLeadStepPublisher produces on the
 * same gate. Widening it alone was tried during DEV-374 and reverted: with
 * the producer still gated on the lead player, the marker froze at a stale
 * zero — a position the user never chose — instead of on the cursor. If the
 * producer is ever narrowed, narrow this with it.
 *
 * Note the renderToString trap: zustand serves the creation-time state as
 * the server snapshot, so a test that sets leadCursor and renders the grid
 * sees column 0. Marker geometry is tested through LeadMarker's own prop.
 */
export function useLeadMarkerColumn(columns: number): number {
  const currentStep = useCurrentStep('lead');
  const cursor = useAppStore((s) => s.leadCursor);
  const clockActive = useAppStore(leadClockActive);
  return leadMarkerColumn(clockActive, currentStep, cursor, columns);
}

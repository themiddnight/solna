import { useAppStore } from '@/store/store';
import { leadMarkerFollowsClock } from '@/store/leadRecord';
import { useCurrentStep } from '@/components/playbackStep';
import { melodyTrack, type MelodyTrackId } from '@/store/melodyTracks';
import { leadMarkerColumn } from './melodyGrid';

/**
 * The marker's column, from whichever source is live. The two sources are
 * deliberately NOT merged into one stored value: stepPublisher stays outside
 * zustand so the re-render lands on the leaf that draws the marker, and the
 * track's cursor stays in the store so a header click during playback still
 * takes effect the moment the transport stops.
 *
 * The live source for LEAD is leadMarkerFollowsClock, not
 * `leadPlayer !== 'stopped'`: this column is also where live capture writes,
 * so it has to track the clock while Rec is armed and anything at all is
 * playing. With the narrower predicate, playing along to the drums with the
 * lead stopped put every captured note in time while the marker sat on the
 * cursor, pointing at a column nothing was being written to. FX has no
 * recorder, so its marker follows its own player state and nothing else.
 *
 * This predicate is only safe because useLeadStepPublisher produces on the
 * same gate, per track. Widening it alone was tried during DEV-374 and
 * reverted: with the producer still gated on the lead player, the marker
 * froze at a stale zero — a position the user never chose — instead of on
 * the cursor. If the producer is ever narrowed, narrow this with it.
 *
 * Note the renderToString trap: zustand serves the creation-time state as
 * the server snapshot, so a test that sets the track's cursor and renders
 * the grid sees column 0. Marker geometry is tested through LeadMarker's own
 * prop.
 */
export function useLeadMarkerColumn(trackId: MelodyTrackId, columns: number): number {
  const track = melodyTrack(trackId);
  const currentStep = useCurrentStep(track.stepPlayer);
  const cursor = useAppStore((s) => s[track.cursor]);
  const followsClock = useAppStore((s) =>
    trackId === 'lead' ? leadMarkerFollowsClock(s) : s[track.player] !== 'stopped',
  );
  return leadMarkerColumn(followsClock, currentStep, cursor, columns);
}

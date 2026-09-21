import { useAppStore } from '@/store/store';
import { leadMarkerFollowsClock } from '@/store/leadRecord';
import { useSegmentGatedStep } from '@/components/playbackStep';
import { melodyTrack, type MelodyTrackId } from '@/store/melodyTracks';
import type { PatternSegment } from '@/types';
import { leadMarkerColumn } from './melodyGrid';

/**
 * Lead and FX are different Pattern segments (ADR-0001: Pattern has four
 * segments — Lead, FX, Accompaniment, Beat), so the gate below needs a
 * per-track segment, not one hardcoded literal. `MELODY_TRACKS` carries no
 * `segment` column — its `id`s happen to spell the same two literals
 * (`'lead'`, `'fx'`) as their segments, but that is a coincidence of two
 * separate vocabularies (`MelodyTrackId` and `PatternSegment`), not a
 * guarantee, so the mapping is written out rather than relied on by string
 * identity.
 */
const SEGMENT_FOR_TRACK: Record<MelodyTrackId, PatternSegment> = {
  lead: 'lead',
  fx: 'fx',
};

/**
 * The marker's column, from whichever source is live. The two sources are
 * deliberately NOT merged into one stored value: stepPublisher stays outside
 * zustand so the re-render lands on the leaf that draws the marker, and the
 * track's cursor stays in the store so a header click during playback still
 * takes effect the moment the transport stops.
 *
 * The live source is leadMarkerFollowsClock for BOTH tracks, not
 * `player !== 'stopped'`: this column is also where live capture writes, so it
 * has to track the clock while Rec is armed on this track and anything at all
 * is playing. With the narrower predicate, playing along to the drums with the
 * track stopped put every captured note in time while the marker sat on the
 * cursor, pointing at a column nothing was being written to. The predicate
 * takes the track id, so one arm value cannot make the other grid's marker
 * sweep.
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
  const currentStep = useSegmentGatedStep(track.stepPlayer, SEGMENT_FOR_TRACK[trackId]);
  const cursor = useAppStore((s) => s[track.cursor]);
  const followsClock = useAppStore((s) => leadMarkerFollowsClock(s, trackId));
  return leadMarkerColumn(followsClock, currentStep, cursor, columns);
}

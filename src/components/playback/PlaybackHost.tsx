import React from 'react';
import { useLeadPlayback } from './useLeadPlayback';
import { useLeadStepPublisher } from './useLeadStepPublisher';
import { useChordClockPlayback } from './useChordClockPlayback';
import { useSequencerPlayback } from './useSequencerPlayback';

/**
 * The one mount of every transport-driven playback controller (DEV-422).
 *
 * A lane sounds because THIS component is mounted, never because its grid
 * is: the views stay mounted to keep their UI state, and audio no longer
 * depends on them. Rendered once, in `Workspace` (`App.tsx`), as JSX rather
 * than hook calls there, so hook order stays local and the element's tree
 * position fixes the clock-listener order.
 *
 * Hook order IS listener order. Every controller subscribes the shared clock
 * inside an effect gated on its player, so on Play the listeners register in
 * this order; `PlaybackHost.test.tsx` pins it. Never call one of these hooks
 * from a view — a second call is a second scheduler and every event fires
 * twice.
 *
 * `React.memo` so a `Workspace` re-render does not re-run the controllers'
 * selectors; each controller re-renders the host on its own store reads.
 */
export const PlaybackHost = React.memo(function PlaybackHost(): null {
  // Two hooks per melody track, two gates, on purpose: useLeadPlayback
  // schedules NOTES while the track's player plays; useLeadStepPublisher moves
  // the MARKER, which for a Rec-armed track also follows somebody else's clock.
  useLeadPlayback('lead');
  useLeadStepPublisher('lead');
  useLeadPlayback('fx');
  useLeadStepPublisher('fx');
  useChordClockPlayback();
  useSequencerPlayback();
  return null;
});

import React from 'react';
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
  useSequencerPlayback();
  return null;
});

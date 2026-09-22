import { useEffect } from 'react';
import { startArpClock, type ArpStateRef } from '@/audio/playback/arpPlayback';

/**
 * The arp's React half (DEV-422, R314): holds `startArpClock`'s subscription
 * while `active`. The body stays in `src/audio/` because it calls the engine
 * directly, which a component may not (R038).
 *
 * Mounted by the input deck, not by `PlaybackHost`: the arp follows held keys,
 * not the transport. `stateRef` is a stable ref; `startArpClock` reads it live
 * on every tick and again at cleanup.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean): void {
  useEffect(() => (active ? startArpClock(stateRef) : undefined), [active, stateRef]);
}

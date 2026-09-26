import { useCallback, useEffect, useRef } from 'react';
import { startArpClock, type ArpClock, type ArpStateRef } from '@/audio/playback/arpPlayback';

/**
 * The arp's React half (DEV-422, R314): holds `startArpClock`'s subscription
 * while `active`. The body stays in `src/audio/` because it calls the engine
 * directly, which a component may not (R038).
 *
 * Mounted by the input deck, not by `PlaybackHost`: the arp follows held keys,
 * not the transport. `stateRef` is a stable ref; `startArpClock` reads it live
 * on every tick and again at cleanup.
 *
 * Returns a stable `ensureArpClock` for the note path to call after it inits
 * the engine: the arp can be armed before any audio session exists (a vibe or
 * a reloaded project turns it on), and only a note-on is guaranteed to come
 * after one. A no-op while the arp is off.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean): () => void {
  const clockRef = useRef<ArpClock | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    const clock = startArpClock(stateRef);
    clockRef.current = clock;
    return () => {
      clockRef.current = null;
      clock.stop();
    };
  }, [active, stateRef]);
  return useCallback(() => clockRef.current?.ensureRunning(), []);
}

/**
 * When the AudioContext may be suspended, as a pure predicate.
 *
 * Nothing in this app ever suspended the context: init() created it on the
 * first user gesture and only ever resumed it, so the whole master chain (two
 * compressors, three biquads, a 4x-oversampled WaveShaper, a Convolver with up
 * to a 10 s impulse, a Delay with a feedback loop and an Analyser) was pulled
 * for the entire session. Blink short-circuits silent nodes, so this is
 * battery and thermal cost rather than a glitch risk — but the render thread
 * stays awake at the hardware callback rate for hours.
 *
 * Pure and separate from engine.ts so every "must never suspend during X" case
 * is provable without an AudioContext.
 */

/**
 * Idle time before the context is suspended.
 *
 * 30 s: long enough that it never fires between two takes or while the user is
 * reading the UI, short enough to stop draining a laptop left on a tab.
 */
export const IDLE_SUSPEND_MS = 30_000;

export interface IdleSnapshot {
  /** How many listeners hold the shared 16th clock. Any player running is >= 1. */
  clockListenerCount: number;
  metronomeEnabled: boolean;
  /** Every voice still live OR still releasing, across all sources. */
  liveVoiceCount: number;
  contextState: AudioContextState;
}

export function shouldSuspendWhenIdle(snapshot: IdleSnapshot): boolean {
  if (snapshot.contextState !== 'running') return false;
  if (snapshot.clockListenerCount > 0) return false;
  if (snapshot.metronomeEnabled) return false;
  // A held QWERTY note is a live voice with no clock listener and no player —
  // suspending here would cut a sustained note the user is still holding.
  if (snapshot.liveVoiceCount > 0) return false;
  return true;
}

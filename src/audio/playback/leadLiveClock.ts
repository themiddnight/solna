import { createLeadLiveClock, type LeadLiveClock } from '../leadLiveRecord';
import {
  playbackNowSec,
  playbackOutputLatencySec,
  subscribePlaybackClock,
} from './playbackEngine';

/**
 * The one place the pure live clock meets the real engine.
 *
 * Deliberately NOT the components-layer stepPublisher: that is a whole
 * number published for a highlight, store/ may not import it, and live
 * capture needs sub-step resolution. The anchors come straight from the
 * clock, and the position is derived here from ctx.currentTime.
 */
const clock: LeadLiveClock = createLeadLiveClock({
  now: playbackNowSec,
  outputLatency: playbackOutputLatencySec,
});

/** A subscribePlaybackClock-shaped function, injectable for testing. */
type ClockSubscribe = (listener: (step: number, beat: number, time: number) => void) => () => void;

// The one live subscription this module will ever hold. A second start
// while the first is still running would add a second listener to the
// shared clock and leak the first subscription forever — the guard below
// makes that impossible instead of merely undocumented.
let activeStop: (() => void) | null = null;

/**
 * Starts collecting anchors. Returns the stop function, which also clears
 * them — an anchor surviving a stop would let a press quantise against a
 * clock that is no longer running.
 *
 * Started and stopped with the transport rather than at boot: subscribing
 * the clock starts its 25 ms timer, so a permanent subscriber would keep
 * the shared clock alive for the life of the app.
 *
 * A second call while one is already live is a no-op that returns a
 * disposer which does nothing: there is only ever one subscription to leak,
 * and only the disposer returned by the call that actually subscribed may
 * tear it down.
 */
export function startLeadLiveClockWith(subscribe: ClockSubscribe): () => void {
  if (activeStop) return () => {};

  const unsubscribe = subscribe((step, _beat, time) => clock.anchor(step, time));
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    clock.reset();
    activeStop = null;
  };
  activeStop = stop;
  return stop;
}

/** The real live clock, wired to the engine's playback clock. */
export function startLeadLiveClock(): () => void {
  return startLeadLiveClockWith(subscribePlaybackClock);
}

/** The quantised clock step for an input observed now; null if no clock. */
export function leadLiveInputStep(): number | null {
  return clock.inputStep();
}

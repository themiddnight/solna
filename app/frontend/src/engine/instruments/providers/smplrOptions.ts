import { Scheduler, type StopTarget } from "smplr";

import type { InstrumentProviderLoadContext } from "./types";

/**
 * Builds the `scheduler` slice of a smplr instrument's options.
 *
 * smplr's default scheduler only dispatches an event synchronously if it falls within a 200ms
 * lookahead window; anything further out is queued and drained by a wall-clock `setInterval`.
 * That is exactly right in a live room, and useless inside an `OfflineAudioContext`, whose
 * render finishes long before any real timer fires and whose `currentTime` never advances while
 * events are being scheduled. Callers rendering offline pass a `schedulerLookaheadMs` wider than
 * the whole render so every event is dispatched immediately and carries its own audio-timeline
 * `time` down to the voice.
 *
 * Returns an empty object when no override is requested, so live callers keep smplr's defaults.
 */
export function smplrSchedulerOptions({
  audioContext,
  schedulerLookaheadMs,
}: InstrumentProviderLoadContext): { scheduler?: ReturnType<typeof Scheduler> } {
  if (schedulerLookaheadMs === undefined) return {};
  return { scheduler: Scheduler(audioContext, { lookaheadMs: schedulerLookaheadMs }) };
}

/**
 * Maps this repo's `InstrumentProvider.stop(note?, time?)` signature onto smplr's `StopTarget`
 * union, so an optional scheduled stop time is preserved instead of silently collapsing to
 * "stop now" (which, in an offline render, means "stop at t=0" — i.e. total silence).
 */
export function smplrStopTarget(
  note?: string | number,
  time?: number,
): StopTarget | undefined {
  if (time === undefined) return note;
  if (note === undefined) return { time };
  return { stopId: note, time };
}

/**
 * Audio time for source gain/mute writes made by the synchronous store update
 * inside a seamless song-loop advance. The loop's content must be installed
 * during the scheduler lookahead so its step 0 can be queued, but opening its
 * source buses at JavaScript `currentTime` exposes the outgoing loop's final
 * queued notes. EngineSync reads this boundary while Zustand dispatches that
 * one update and schedules only the source controls there.
 *
 * The previous value is restored for re-entrant updates. Zustand subscribers
 * run synchronously, so the time never escapes the callback or becomes ambient
 * state observed by a later user edit.
 */
let activeTime: number | undefined;

export function sourceTransitionTime(): number | undefined {
  return activeTime;
}

export function withSourceTransitionTime<T>(time: number, update: () => T): T {
  const previous = activeTime;
  activeTime = time;
  try {
    return update();
  } finally {
    activeTime = previous;
  }
}

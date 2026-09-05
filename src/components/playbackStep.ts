import { useCallback, useSyncExternalStore } from 'react';
import { playbackAudibleDelaySec } from '@/audio/playback/playbackEngine';

/** One id per clock-driven player that publishes a 16th-note step. */
export type StepPlayerId = 'chords' | 'lead' | 'sequencer';

const PLAYER_IDS: readonly StepPlayerId[] = ['chords', 'lead', 'sequencer'];

export interface StepPublisher {
  /** Records `step` for `player` and notifies its listeners — but only when
   *  the value actually changed, so a repeated step is a no-op. */
  publish(player: StepPlayerId, step: number): void;
  /**
   * Publishes after `delayMs`, so the value lands when the step is HEARD
   * rather than when the scheduler queued it. A delay of 0 or less publishes
   * synchronously, which keeps the no-AudioContext case and the tests on the
   * plain path.
   */
  publishAt(player: StepPlayerId, step: number, delayMs: number): void;
  /** The player's current step; 0 before anything was published. */
  getStep(player: StepPlayerId): number;
  /** Subscribes to one player. Returns the unsubscribe function. */
  subscribe(player: StepPlayerId, listener: () => void): () => void;
  /** Sets a player (or every player) back to 0, notifying on a real change. */
  reset(player?: StepPlayerId): void;
}

/**
 * A minimal external store for the transport's 16th-note position.
 *
 * Why it exists: the playback hooks own scheduling and must stay mounted
 * exactly once, high in the tree — but the step they produce is consumed by
 * LEAVES (a StepRow's highlight, the melody grid's playhead translateX, a
 * sequencer column). Holding it in React state at the hook's mount point
 * re-rendered whole 1200-1400 line views 8-16 times a second, including views
 * on hidden tabs (App.tsx keeps every tab mounted by design, and display:none
 * skips layout and paint but NOT reconciliation).
 *
 * Publishing here and reading it with useSyncExternalStore in the leaf moves
 * the re-render to where the value is actually rendered. The same
 * useSyncExternalStore pattern, with the same "serve the live value for both
 * snapshots" rule, is documented at ui/BottomInputDock.tsx:9-30.
 *
 * `publish` is identity-checked, so a repeated step (the clock re-dispatches
 * one whenever the stall detector re-anchors the grid) costs nothing.
 *
 * Publishing is DEFERRED to the moment the step sounds. The clock is a
 * lookahead scheduler, so publishing inline from its callback put every
 * playhead in the app ahead of its own audio — measured at ~116ms, which at
 * 120bpm is very nearly a whole column. Timer jitter of a few milliseconds is
 * meaningless against a column 125-180ms wide, so a timer is enough; what is
 * NOT optional is cancelling the pending ones on reset, or a step lands after
 * the transport has already stopped.
 */
export function createStepPublisher(): StepPublisher {
  const steps = new Map<StepPlayerId, number>();
  const listeners = new Map<StepPlayerId, Set<() => void>>();
  const pending = new Map<StepPlayerId, Set<ReturnType<typeof setTimeout>>>();

  const cancelPending = (player: StepPlayerId): void => {
    const timers = pending.get(player);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };

  const notify = (player: StepPlayerId): void => {
    const set = listeners.get(player);
    if (!set) return;
    // Snapshot: a listener may unsubscribe itself (or a sibling) while running.
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        // One failing subscriber must not silence the rest.
      }
    }
  };

  const set = (player: StepPlayerId, step: number): void => {
    if ((steps.get(player) ?? 0) === step) return;
    steps.set(player, step);
    notify(player);
  };

  const publishAt = (player: StepPlayerId, step: number, delayMs: number): void => {
    if (!(delayMs > 0)) {
      set(player, step);
      return;
    }
    let timers = pending.get(player);
    if (!timers) {
      timers = new Set();
      pending.set(player, timers);
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      set(player, step);
    }, delayMs);
    timers.add(timer);
  };

  return {
    publish: set,
    publishAt,
    getStep: (player) => steps.get(player) ?? 0,
    subscribe: (player, listener) => {
      let set = listeners.get(player);
      if (!set) {
        set = new Set();
        listeners.set(player, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    reset: (player) => {
      // Cancel BEFORE setting: a timer surviving a stop would publish a step
      // after the transport had already rewound, leaving a playhead parked
      // somewhere the user never played to.
      if (player) {
        cancelPending(player);
        set(player, 0);
        return;
      }
      for (const id of PLAYER_IDS) {
        cancelPending(id);
        set(id, 0);
      }
    },
  };
}

/** The app-wide singleton. One clock, one publisher. */
export const stepPublisher: StepPublisher = createStepPublisher();

/**
 * What clock callbacks should call. `audibleTime` is the AudioContext time the
 * step will sound at — the third argument the clock hands every listener.
 */
export function publishStepAt(
  player: StepPlayerId,
  step: number,
  audibleTime: number,
): void {
  stepPublisher.publishAt(player, step, playbackAudibleDelaySec(audibleTime) * 1000);
}

/** Convenience wrapper for the stop/rewind paths. */
export function resetStep(player: StepPlayerId): void {
  stepPublisher.reset(player);
}

/**
 * Subscribes the CALLING component — and only it — to one player's step.
 * `getSnapshot` is served for the server snapshot too: the value is a number,
 * so React's Object.is check suppresses a render when it has not moved, and
 * renderToString then reflects whatever was last published rather than a
 * frozen 0 (same reasoning as ui/BottomInputDock.tsx's useLiveStore).
 */
export function useCurrentStep(player: StepPlayerId): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => stepPublisher.subscribe(player, onStoreChange),
    [player],
  );
  const getSnapshot = useCallback(() => stepPublisher.getStep(player), [player]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

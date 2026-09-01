import { useCallback, useSyncExternalStore } from 'react';

/** One id per clock-driven player that publishes a 16th-note step. */
export type StepPlayerId = 'chords' | 'lead' | 'sequencer';

const PLAYER_IDS: readonly StepPlayerId[] = ['chords', 'lead', 'sequencer'];

export interface StepPublisher {
  /** Records `step` for `player` and notifies its listeners — but only when
   *  the value actually changed, so a repeated step is a no-op. */
  publish(player: StepPlayerId, step: number): void;
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
 * LEAVES (a StepRow's highlight, a piano-roll playhead's translateX, a
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
 */
export function createStepPublisher(): StepPublisher {
  const steps = new Map<StepPlayerId, number>();
  const listeners = new Map<StepPlayerId, Set<() => void>>();

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

  return {
    publish: set,
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
      if (player) {
        set(player, 0);
        return;
      }
      for (const id of PLAYER_IDS) set(id, 0);
    },
  };
}

/** The app-wide singleton. One clock, one publisher. */
export const stepPublisher: StepPublisher = createStepPublisher();

/** Convenience wrapper for clock callbacks. */
export function publishStep(player: StepPlayerId, step: number): void {
  stepPublisher.publish(player, step);
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

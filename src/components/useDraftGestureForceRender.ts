import { useEffect, useReducer } from 'react';

/**
 * Shared React glue behind the draft-then-commit gesture hooks
 * (`useBeatParamDraft`, `useSynthPatchDraft`, `useEffectsDraft`): a
 * `useReducer` force-render (each hook renders off its own machine's mutable
 * state, not React state) plus the one effect every one of them needs — an
 * UNMOUNT-ONLY teardown that cancels a gesture still open when its own
 * subtree goes away, so a dragged-then-abandoned knob doesn't leave the
 * engine playing an uncommitted preview forever. `useEffect` never runs
 * under `renderToString`, which is exactly right: a DOM-less render has no
 * gesture to abandon.
 *
 * The machines themselves stay separate hooks/files on purpose — each keys
 * its identity differently (Beat on a loop id, Synth on a `source` bus,
 * Effects on nothing) — this factors out only the identical React wiring
 * around them.
 */
export function useDraftGestureForceRender(machine: { cancelIfDragging: () => void }): () => void {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => () => machine.cancelIfDragging(), [machine]);
  return forceRender;
}

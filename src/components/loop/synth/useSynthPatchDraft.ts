import { useCallback, useRef } from 'react';
import { previewSynthPatch } from '@/store/synthPatchPreview';
import { useDraftGestureForceRender } from '@/components/useDraftGestureForceRender';
import type { SynthChannel, SynthControlTarget } from '@/utils/synthControl';
import type { ActiveSynth } from '@/types/synth';
import type { SubtractivePatch } from './proControls';

export interface SynthPatchDraft {
  /** The patch to render: the live drag preview while a gesture is open, the
   *  committed patch otherwise. */
  patch: SubtractivePatch;
  /** Replaces the draft with `next` and previews it straight to the engine —
   *  no store write. */
  onPatch: (next: SubtractivePatch) => void;
  /** Ends the gesture by writing the draft through `channel.setActiveSynth`. */
  onCommit: () => void;
  /** Ends the gesture by discarding the draft and restoring the engine to
   *  the committed sound. */
  onCancel: () => void;
}

interface DraftState {
  draft: ActiveSynth;
  /**
   * The `ActiveSynth` last actually pushed to the engine — what `onPatch`'s
   * next call hands `previewSynthPatch` as `previous`.
   *
   * This is NOT `committed` and must not be simplified to it: a sounding
   * voice's continuous controls (`updateOscillators`/`updateFilter`/…, in
   * `subtractiveVoice.ts`) skip the `AudioParam` write whenever
   * `before.<field> === after.<field>`, a plain VALUE check, not a
   * drag-in-progress check. If `previous` stayed pinned to the patch from
   * before the whole gesture, dragging a value back through its own starting
   * point mid-gesture would compare the new position against the ORIGINAL
   * value, see "unchanged" on the very step that should have pulled the
   * engine back, and leave the sounding voice stuck at the last dragged
   * value instead of returning to where the pointer is. Tracking the last
   * PUSHED patch (updated every `onPatch`, mirroring what `store/midiInput.ts`'s
   * `writeLeadSynth` does per CC message when every message writes the store)
   * keeps every step's diff a genuine step-to-step comparison, exactly as if
   * this hook still wrote the store on every `pointermove`.
   */
  lastPushed: ActiveSynth;
  committed: ActiveSynth;
  /** Whether an uncommitted preview is in flight. */
  dragging: boolean;
}

/**
 * The pure state machine behind `useSynthPatchDraft`, isolated from React —
 * same split as `createBeatParamDraftMachine`/`useBeatParamDraft`, for the
 * same reason: `renderToString` cannot carry hook state across two separate
 * calls, so the commit-exactly-once and no-drag-no-replace rules are tested
 * directly against these functions rather than through a rendered hook.
 *
 * `source` names which of the five melodic buses (`SynthControlTarget`) this
 * machine's drags preview onto — `SubtractiveProPanel` is the SAME component
 * for Lead, Chord, Bass, Pad and FX, so a machine with no bus of its own
 * would preview every edit onto whichever bus a caller forgot to pass. It is
 * fixed for the machine's lifetime: a caller that changes `source` should
 * mount a fresh machine (`useSynthPatchDraft` keys its instance on the
 * channel identity the same way `useBeatParamDraft` keys on a loop id).
 */
export function createSynthPatchDraftMachine(committedSynth: ActiveSynth, source: SynthControlTarget) {
  const state: DraftState = {
    draft: committedSynth,
    lastPushed: committedSynth,
    committed: committedSynth,
    dragging: false,
  };

  /** Called once per render with the latest committed `ActiveSynth`. */
  function sync(nextCommitted: ActiveSynth): void {
    state.committed = nextCommitted;
    if (!state.dragging) {
      state.draft = nextCommitted;
      state.lastPushed = nextCommitted;
    }
  }

  function onPatch(nextPatch: SubtractivePatch): void {
    state.dragging = true;
    const previous = state.lastPushed;
    const next: ActiveSynth = { ...state.draft, patch: nextPatch };
    state.draft = next;
    state.lastPushed = next;
    previewSynthPatch(previous, next, source);
  }

  /** `setActiveSynth` is passed in at call time so the hook can always supply
   *  the latest closure without recreating this machine. */
  function commit(setActiveSynth: (synth: ActiveSynth) => void): void {
    state.dragging = false;
    state.committed = state.draft;
    setActiveSynth(state.draft);
  }

  function cancel(): void {
    state.dragging = false;
    const previous = state.lastPushed;
    state.draft = state.committed;
    state.lastPushed = state.committed;
    // Pull the engine back off the abandoned draft — without this the voice
    // stays on the last dragged value until some other write reaches it.
    previewSynthPatch(previous, state.committed, source);
  }

  /** Unmount teardown: only a gesture still open has anything to undo. */
  function cancelIfDragging(): void {
    if (state.dragging) cancel();
  }

  return {
    sync,
    onPatch,
    commit,
    cancel,
    cancelIfDragging,
    getDraft: (): SubtractivePatch => state.draft.patch,
  };
}

/**
 * Transient Pro-synth patch editing for one `SynthChannel`: previews straight
 * to the engine on every `onPatch`, writes `channel.setActiveSynth` exactly
 * once on `onCommit`, and never touches the store in between — modeled on
 * `useBeatParamDraft`'s skeleton, not its code (Beat's machine is keyed to a
 * single `BeatParams` object and a loop id; a synth channel's identity is not
 * tracked the same way here because, unlike a loop switch, a mid-drag
 * `SynthControlTarget` change would require releasing the physical pointer
 * capture on the dragging knob first, which ends the gesture before a new
 * channel's props can reach this hook).
 *
 * `source` is required, not optional or defaulted — see
 * `createSynthPatchDraftMachine`'s note. If `source` itself changes across
 * renders (the caller re-pointed this hook at a different bus, which
 * `SubtractiveProPanel`'s own instance never does — it always names the
 * bus its `channel` prop already carries) a NEW machine is intentionally
 * built for it: reusing the old one would keep previewing onto the bus it
 * was first constructed with.
 */
export function useSynthPatchDraft(channel: SynthChannel, source: SynthControlTarget): SynthPatchDraft {
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const machineRef = useRef<{
    source: SynthControlTarget;
    machine: ReturnType<typeof createSynthPatchDraftMachine>;
  } | null>(null);
  if (!machineRef.current || machineRef.current.source !== source) {
    machineRef.current = { source, machine: createSynthPatchDraftMachine(channel.activeSynth, source) };
  }
  const machine = machineRef.current.machine;
  machine.sync(channel.activeSynth);

  // A knob can be dragging when its own subtree goes away (e.g. a Pro/Simple
  // depth switch) — `useDraftGestureForceRender`'s unmount teardown is what
  // restores the engine to the committed patch when that happens.
  const forceRender = useDraftGestureForceRender(machine);

  const onPatch = useCallback(
    (next: SubtractivePatch) => {
      machine.onPatch(next);
      forceRender();
    },
    [machine],
  );
  const onCommit = useCallback(() => {
    machine.commit((synth) => channelRef.current.setActiveSynth(synth));
    forceRender();
  }, [machine]);
  const onCancel = useCallback(() => {
    machine.cancel();
    forceRender();
  }, [machine]);

  return {
    patch: machine.getDraft(),
    onPatch,
    onCommit,
    onCancel,
  };
}

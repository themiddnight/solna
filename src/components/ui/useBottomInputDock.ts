import { useLiveStore } from './useLiveStore';
import { inputTargetOf, isMelodicFocus, type MixLayerId } from '@/store/focusTrack';

/** Which body the dock shows. Derived from the input target, never stored (R341). */
export type DockPanel = 'keyboard' | 'drums';

/** The drum target plays the pads; every other track plays the keyboard. */
export function panelForTarget(target: MixLayerId): DockPanel {
  return isMelodicFocus(target) ? 'keyboard' : 'drums';
}

/** The two setters a chip pick can reach. Injected so the rule is testable as pure logic. */
export interface InputTargetActions {
  setFocusTrack: (id: MixLayerId) => void;
  setInputTargetPin: (pin: MixLayerId | null) => void;
}

/**
 * A pick from the target chip. Linked, the chip is a way to select a track, so
 * it moves focus (and the page follows, as it always has). Pinned, it changes
 * only which track the keys stay on and never navigates.
 */
export function pickInputTarget(id: MixLayerId, pinned: boolean, actions: InputTargetActions): void {
  if (pinned) actions.setInputTargetPin(id);
  else actions.setFocusTrack(id);
}

/**
 * The link toggle. Unlinking pins whatever the keys play right now, so the
 * press itself never changes the target; re-linking clears the pin and the
 * target snaps back to the selection.
 */
export function nextInputTargetPin(pin: MixLayerId | null, target: MixLayerId): MixLayerId | null {
  return pin === null ? target : null;
}

export interface UseBottomInputDock {
  isOpen: boolean;
  toggleOpen: () => void;
  /** The track the keys play: `inputTargetOf`, never `focusTrack` directly. */
  target: MixLayerId;
  isPinned: boolean;
  /** A track is armed: the target and its link are locked to the selection (R341). */
  isLocked: boolean;
  panel: DockPanel;
  onPickTarget: (id: MixLayerId) => void;
  onToggleLink: () => void;
}

/**
 * The dock's store reads and handlers. Every read goes through `useLiveStore`,
 * so a test's `setState` before `renderToString` shows up in the markup (R257).
 */
export function useBottomInputDock(): UseBottomInputDock {
  const isOpen = useLiveStore((s) => s.isInputPanelOpen);
  const setIsOpen = useLiveStore((s) => s.setIsInputPanelOpen);
  const target = useLiveStore(inputTargetOf);
  const pin = useLiveStore((s) => s.inputTargetPin);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);
  const setInputTargetPin = useLiveStore((s) => s.setInputTargetPin);
  const isPinned = pin !== null;
  const isLocked = useLiveStore((s) => s.recordingTrack !== null);

  return {
    isOpen,
    toggleOpen: () => setIsOpen(!isOpen),
    target,
    isPinned,
    isLocked,
    panel: panelForTarget(target),
    onPickTarget: (id) => pickInputTarget(id, isPinned, { setFocusTrack, setInputTargetPin }),
    onToggleLink: () => setInputTargetPin(nextInputTargetPin(pin, target)),
  };
}

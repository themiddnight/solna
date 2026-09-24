import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from '@/components/ui/Keyboard';
import type { ShellProps } from './shellProps';

const noop = () => {};

/** Inert shell props for renderToString tests. */
export const SHELL_PROPS: ShellProps = {
  keyboardProps: {
    keyboardMode: 'scale-locked', setKeyboardMode: noop,
    keyboardOctave: 0, setKeyboardOctave: noop,
    activeNotes: new Set<string>(), scaleRoot: 'C', scaleType: 'Major',
    scaleLockedRows: getScaleLockedKeyboardNotes('C', 'Major', 0),
    chordKeyboardRows: getChordKeyboardRows('C', 'Major', 0),
    handleNoteOn: noop, handleNoteOff: noop,
  },
  drumProps: { pads: [], activePadId: null, onTriggerPad: noop },
  updateReady: false,
  onApplyUpdate: noop,
  onDismissUpdate: noop,
};

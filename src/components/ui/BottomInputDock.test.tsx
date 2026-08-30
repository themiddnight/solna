import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BottomInputDock } from './BottomInputDock';
import { useAppStore } from '../../store/store';
import { DEFAULT_PADS } from './DrumPadGrid';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from './Keyboard';

const keyboardProps = {
  keyboardMode: 'scale-locked' as const,
  setKeyboardMode: () => {},
  keyboardOctave: 0,
  setKeyboardOctave: () => {},
  activeNotes: new Set<string>(),
  scaleRoot: 'C',
  scaleType: 'Major',
  scaleLockedRows: getScaleLockedKeyboardNotes('C', 'Major', 0),
  chordKeyboardRows: getChordKeyboardRows('C', 'Major', 0),
  handleNoteOn: () => {},
  handleNoteOff: () => {},
};

const drumProps = {
  pads: DEFAULT_PADS,
  activePadId: null,
  onTriggerPad: () => {},
  onPadVolumeChange: () => {},
};

beforeEach(() => {
  useAppStore.setState({ isInputPanelOpen: false, inputPanelMode: 'keyboard' });
});

describe('BottomInputDock', () => {
  test('toggle button is always visible; body is collapsed when closed', () => {
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(html).toContain('btn-toggle-input-deck');
    expect(html).not.toContain('C Major');
    expect(html).not.toContain('btn-pad-kick');
  });

  test('keyboard tab renders the scale badge, octave controls and mode radio group', () => {
    useAppStore.setState({ isInputPanelOpen: true, inputPanelMode: 'keyboard' });
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(html).toContain('C Major');
    expect(html).toContain('btn-keyboard-octave-down');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Keyboard input mode"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
  });

  test('drums tab renders the shared pad grid', () => {
    useAppStore.setState({ isInputPanelOpen: true, inputPanelMode: 'drums' });
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(html).toContain('btn-toggle-input-deck');
    expect(html).toContain('btn-pad-kick');
    expect(html).toContain('Kick Drum');
  });

  test('keyboard | drums switch announces as a radio group', () => {
    useAppStore.setState({ isInputPanelOpen: true, inputPanelMode: 'drums' });
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(html).toContain('aria-label="Input deck panel"');
    expect(html).toContain('input-tab-drums');
    expect(html).toContain('input-tab-keyboard');
  });
});

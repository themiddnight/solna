import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BottomInputDock } from './BottomInputDock';
import { MIX_LAYER_IDS } from '@/store/focusTrack';
import { useAppStore } from '@/store/store';
import { DEFAULT_PADS } from './DrumPadGrid';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from './Keyboard';

// Same helper as Header.test.tsx / SoundMixer.test.tsx: ties an attribute
// assertion to ONE element's opening tag rather than to a substring whose
// pass/fail would depend on the order the JSX happens to list its props.
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
}

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

  test('collapsed header states the active panel and keyboard mode', () => {
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(html).toContain('input-deck-collapsed-summary');
    expect(html).toContain('Keyboard');
    expect(html).toContain('Scale');
    expect(html).toContain('Current input: Keyboard');
  });

  test('collapsed header on the drums panel names no keyboard mode', () => {
    useAppStore.setState({ isInputPanelOpen: false, inputPanelMode: 'drums' });
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(html).toContain('Current input: Drums');
    expect(html).not.toContain('Scale');
  });

  test('the collapsed summary is gone once the deck is open', () => {
    useAppStore.setState({ isInputPanelOpen: true, inputPanelMode: 'keyboard' });
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(html).not.toContain('input-deck-collapsed-summary');
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

describe('the dock focus chip', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  // The dock is the one surface visible from every tab and every Pattern
  // segment, so it is where "which track am I working on" has to be
  // answerable without navigating.
  test('renders the focused track label, open or closed', () => {
    useAppStore.setState({ focusTrack: 'drum', isInputPanelOpen: false });
    const closed = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    const chipTag = openTagContaining(closed, 'id="btn-focus-chip"');
    expect(chipTag).toContain('id="btn-focus-chip"');
    expect(chipTag).not.toContain('aria-haspopup');
    expect(closed).toContain('>Beat</span>');
    useAppStore.setState({ isInputPanelOpen: true });
    const open = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    expect(open).toContain('id="btn-focus-chip"');
    expect(open).toContain('>Beat</span>');
  });

  test('the menu offers every focus', () => {
    const html = renderToString(
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
    );
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-focus-chip-${id}"`);
  });

  test('exactly one item carries aria-current, matching the focused track', () => {
    try {
      useAppStore.setState({ focusTrack: 'drum' });
      const html = renderToString(
        <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />,
      );
      const current = MIX_LAYER_IDS.filter((id) => {
        const tag = openTagContaining(html, `id="btn-focus-chip-${id}"`);
        return tag.includes('aria-current="true"');
      });
      expect(current).toEqual(['drum']);
      for (const id of MIX_LAYER_IDS) {
        if (id === 'drum') continue;
        const tag = openTagContaining(html, `id="btn-focus-chip-${id}"`);
        expect(tag).not.toContain('aria-current');
      }
    } finally {
      useAppStore.setState({ focusTrack: 'synth' });
    }
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BottomInputDock } from './BottomInputDock';
import { DockMenuList } from './DockMenu';
import { MIX_LAYER_LABELS } from '../mixLayers';
import { MIX_LAYER_IDS, type MixLayerId } from '@/store/focusTrack';
import { nextInputTargetPin, panelForTarget, pickInputTarget } from './useBottomInputDock';
import { useAppStore } from '@/store/store';
import { DEFAULT_PADS } from './DrumPadGrid';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes, MELODY_KEYS } from './Keyboard';

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
};

beforeEach(() => {
  useAppStore.setState({ isInputPanelOpen: false, focusTrack: 'synth', inputTargetPin: null, recordingTrack: null });
});

afterEach(() => {
  useAppStore.setState({ isInputPanelOpen: false, focusTrack: 'synth', inputTargetPin: null, recordingTrack: null });
});

const render = () =>
  renderToString(<BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />);

describe('BottomInputDock', () => {
  test('toggle button is always visible; body is collapsed when closed', () => {
    const html = render();
    expect(html).toContain('btn-toggle-input-deck');
    expect(html).not.toContain('C Major');
    expect(html).not.toContain('btn-pad-kick');
  });

  test('the "Input" label is hidden below md but stays the button\'s name', () => {
    expect(render()).toContain('<span class="sr-only md:not-sr-only">Input</span>');
  });

  test('there are no Keyboard | Drums tabs, open or closed (R341)', () => {
    for (const isInputPanelOpen of [false, true]) {
      useAppStore.setState({ isInputPanelOpen });
      const html = render();
      expect(html).not.toContain('input-tab-');
      expect(html).not.toContain('Input deck panel');
      expect(html).not.toContain('input-deck-collapsed-summary');
    }
  });

  test('keyboard panel renders the scale badge and octave controls', () => {
    useAppStore.setState({ isInputPanelOpen: true });
    const html = render();
    expect(html).toContain('C Major');
    expect(html).toContain('btn-keyboard-octave-down');
    expect(html).not.toContain('btn-pad-kick');
  });

  test('the panel is the pads iff the input target is drum', () => {
    useAppStore.setState({ isInputPanelOpen: true });
    for (const id of MIX_LAYER_IDS) {
      useAppStore.setState({ focusTrack: id });
      const html = render();
      expect(html.includes('btn-pad-kick')).toBe(id === 'drum');
      expect(html.includes('btn-keyboard-octave-down')).toBe(id !== 'drum');
    }
  });

  test('a pinned target picks the panel, not the focus', () => {
    useAppStore.setState({ isInputPanelOpen: true, focusTrack: 'drum', inputTargetPin: 'synth' });
    const html = render();
    expect(html).toContain('btn-keyboard-octave-down');
    expect(html).not.toContain('btn-pad-kick');
    expect(html).toContain('>Lead</span>');
  });
});

describe('the keyboard mode picker', () => {
  test('is in the header both collapsed and open, a closed <button> menu', () => {
    for (const isInputPanelOpen of [false, true]) {
      useAppStore.setState({ isInputPanelOpen });
      const html = render();
      const tag = openTagContaining(html, 'id="btn-keyboard-mode-chip"');
      expect(tag.startsWith('<button')).toBe(true);
      expect(tag).toContain('aria-label="Keyboard mode: Scale"');
      expect(tag).toContain('aria-expanded="false"');
      expect(tag).toContain('aria-controls="btn-keyboard-mode-list"');
      // Closed, Popup mounts no panel: the items exist only while open
      // (their markup is pinned on DockMenuList in DockMenu.test.tsx).
      expect(html).not.toContain('id="btn-keyboard-mode-chromatic"');
    }
  });

  test('the chip names the current mode and carries its title', () => {
    const html = renderToString(
      <BottomInputDock keyboardProps={{ ...keyboardProps, keyboardMode: 'chord' }} drumProps={drumProps} />,
    );
    const tag = openTagContaining(html, 'id="btn-keyboard-mode-chip"');
    expect(tag).toContain('aria-label="Keyboard mode: Chord"');
    expect(tag).toContain('title="Chord Mode: diatonic triads per scale degree, plus a melody zone"');
  });

  test('is absent when the input target is drum', () => {
    for (const isInputPanelOpen of [false, true]) {
      useAppStore.setState({ isInputPanelOpen, focusTrack: 'drum' });
      expect(render()).not.toContain('btn-keyboard-mode-');
    }
  });

  test('is gone from the keyboard toolbar', () => {
    useAppStore.setState({ isInputPanelOpen: true });
    const html = render();
    expect(html).not.toContain('role="radiogroup"');
  });
});

describe('the dock target chip', () => {
  // The dock is the one surface visible from every tab and every Pattern
  // segment, so it is where "which track do the keys play" has to be
  // answerable without navigating.
  test('renders the target label, open or closed', () => {
    useAppStore.setState({ focusTrack: 'drum', isInputPanelOpen: false });
    const closed = render();
    const chipTag = openTagContaining(closed, 'id="btn-focus-chip"');
    expect(chipTag).not.toContain('aria-haspopup');
    expect(chipTag).toContain('aria-label="Keys play Beat"');
    expect(closed).toContain('>Beat</span>');
    useAppStore.setState({ isInputPanelOpen: true });
    const open = render();
    expect(open).toContain('id="btn-focus-chip"');
    expect(open).toContain('>Beat</span>');
  });

  test('the menu offers every track', () => {
    const html = renderToString(
      <DockMenuList options={MIX_LAYER_IDS} current="synth" idPrefix="btn-focus-chip" labels={MIX_LAYER_LABELS} onPick={() => {}} />,
    );
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-focus-chip-${id}"`);
  });

  test('a pinned target names the chip, and the menu marks exactly that track', () => {
    useAppStore.setState({ focusTrack: 'synth', inputTargetPin: 'drum' });
    expect(openTagContaining(render(), 'id="btn-focus-chip"')).toContain('aria-label="Keys play Beat"');
    const html = renderToString(
      <DockMenuList options={MIX_LAYER_IDS} current="drum" idPrefix="btn-focus-chip" labels={MIX_LAYER_LABELS} onPick={() => {}} />,
    );
    const current = MIX_LAYER_IDS.filter((id) =>
      openTagContaining(html, `id="btn-focus-chip-${id}"`).includes('aria-current="true"'),
    );
    expect(current).toEqual(['drum']);
  });

  test('linked: the link icon, the idle style, pressed as "Follow selection"', () => {
    const html = render();
    const link = openTagContaining(html, 'id="btn-input-target-link"');
    expect(link).toContain('aria-label="Follow selection"');
    expect(link).toContain('aria-pressed="true"');
    expect(link).toContain('title="Follow selection"');
    expect(link).toContain('btn-soft btn-accent');
    expect(openTagContaining(html, 'id="btn-focus-chip"')).toContain('btn-soft btn-accent');
    expect(html).toContain('lucide-link2');
    expect(html).not.toContain('lucide-unlink2');
  });

  test('pinned: the unlink icon, and neither half of the group keeps the tint', () => {
    useAppStore.setState({ inputTargetPin: 'chord' });
    const html = render();
    const link = openTagContaining(html, 'id="btn-input-target-link"');
    expect(link).toContain('aria-pressed="false"');
    expect(link).toContain('title="Pinned — follow selection again"');
    expect(link).not.toContain('btn-accent');
    expect(openTagContaining(html, 'id="btn-focus-chip"')).not.toContain('btn-accent');
    expect(html).toContain('lucide-unlink2');
    expect(html).toContain('>Chord</span>');
  });

  test('the chip and the link are one joined group', () => {
    const html = render();
    expect(openTagContaining(html, 'id="btn-focus-chip"')).toContain('join-item');
    expect(openTagContaining(html, 'id="btn-input-target-link"')).toContain('join-item');
    expect(html).toContain('id="input-target-group"');
    expect(openTagContaining(html, 'id="input-target-group"')).toContain('join');
  });

  /** R341: armed, the keys stay on the armed track, so the target and its link lock. */
  test('armed: the chip and the link are disabled; disarmed they are not', () => {
    try {
      useAppStore.setState({ focusTrack: 'synth', inputTargetPin: null, recordingTrack: 'lead' });
      const armed = render();
      expect(openTagContaining(armed, 'id="btn-focus-chip"')).toContain('disabled');
      expect(openTagContaining(armed, 'id="btn-input-target-link"')).toContain('disabled');
      expect(openTagContaining(armed, 'id="input-target-group"')).toContain('title="Recording');
      useAppStore.setState({ recordingTrack: null });
      const idle = render();
      expect(openTagContaining(idle, 'id="btn-focus-chip"')).not.toContain('disabled');
      expect(openTagContaining(idle, 'id="btn-input-target-link"')).not.toContain('disabled');
    } finally {
      useAppStore.setState({ recordingTrack: null });
    }
  });
});

describe('the dock menus on ui/Popup', () => {
  test('both triggers are real buttons, and nothing is focusable by hack', () => {
    const html = render();
    for (const id of ['btn-focus-chip', 'btn-keyboard-mode-chip']) {
      const tag = openTagContaining(html, `id="${id}"`);
      expect(tag.startsWith('<button')).toBe(true);
      expect(tag).toContain('aria-expanded="false"');
    }
    expect(html).not.toContain('role="button"');
    expect(html).not.toMatch(/<ul[^>]*tabindex/);
  });

  test('the target menu opens upward from a flex wrapper inside the joined group', () => {
    expect(render()).toContain(
      '<div id="input-target-group" class="join"><div class="dropdown dropdown-start dropdown-top flex"><button',
    );
  });
});

describe('pickInputTarget', () => {
  function recorder() {
    const calls: [string, unknown][] = [];
    return {
      calls,
      setFocusTrack: (id: MixLayerId) => calls.push(['focus', id]),
      setInputTargetPin: (id: MixLayerId | null) => calls.push(['pin', id]),
    };
  }

  test('linked: picking selects the track (and so navigates)', () => {
    const r = recorder();
    pickInputTarget('chord', false, r);
    expect(r.calls).toEqual([['focus', 'chord']]);
  });

  test('pinned: picking re-pins and never touches focus', () => {
    const r = recorder();
    pickInputTarget('chord', true, r);
    expect(r.calls).toEqual([['pin', 'chord']]);
  });
});

describe('nextInputTargetPin', () => {
  test('unlinking pins the current target; re-linking clears the pin', () => {
    expect(nextInputTargetPin(null, 'fx')).toBe('fx');
    expect(nextInputTargetPin('fx', 'fx')).toBeNull();
    expect(nextInputTargetPin('bass', 'synth')).toBeNull();
  });
});

describe('panelForTarget', () => {
  test('drum → drums, every other track → keyboard', () => {
    for (const id of MIX_LAYER_IDS) {
      expect(panelForTarget(id)).toBe(id === 'drum' ? 'drums' : 'keyboard');
    }
  });
});

/** R340: the mobile surface fits the width and never scrolls. */
describe('the mobile keyboard surface', () => {
  const chord = { ...keyboardProps, keyboardMode: 'chord' as const };

  test('chord mode on mobile shows the chords only, in a surface that does not scroll', () => {
    useAppStore.setState({ isInputPanelOpen: true });
    const html = renderToString(
      <BottomInputDock keyboardProps={chord} drumProps={drumProps} keyboardVariant="mobile" />,
    );
    for (const key of MELODY_KEYS) expect(html).not.toContain(`id="chord-key-${key}"`);
    expect(html).toContain('id="chord-key-KeyA"');
    expect(html).not.toContain('overflow-x-auto');
  });

  test('chord mode on desktop keeps the melody keys and the scrolling surface', () => {
    useAppStore.setState({ isInputPanelOpen: true });
    const html = renderToString(<BottomInputDock keyboardProps={chord} drumProps={drumProps} />);
    for (const key of MELODY_KEYS) expect(html).toContain(`id="chord-key-${key}"`);
    expect(html).toContain('overflow-x-auto');
  });
});

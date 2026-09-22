import { describe, expect, test } from 'bun:test';
import { createElement, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { BottomInputDock } from './ui/BottomInputDock';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from './ui/Keyboard';
import { LoopPage } from './loop/LoopPage';
import { PatternView } from './loop/PatternView';
import { SequencerView } from './loop/SequencerView';
import { SoundView } from './loop/SoundView';
import { ArrangeView } from './song/ArrangeView';
import { SongPage } from './song/SongPage';
import { PlaybackHost } from './playback/PlaybackHost';
import { DesktopShell } from './shell/DesktopShell';
import { MobileShell } from './shell/MobileShell';
import { MobileTabBar } from './shell/MobileTabBar';
import { LayerPages } from './shell/LayerPages';
import { SHELL_PROPS } from './shell/shellPropsFixture';

// A React.memo result is an OBJECT with $$typeof === Symbol.for('react.memo')
// and the wrapped component on `.type` — NOT a function carrying `compare`,
// which is what a hasOwnProperty check would wrongly look for.
const REACT_MEMO = Symbol.for('react.memo');
type AnyProps = Record<string, unknown>;

/** Reached through `unknown` so this file compiles either way. */
function memoInner(component: unknown): ComponentType<AnyProps> {
  const w = component as { $$typeof?: symbol; type?: ComponentType<AnyProps> };
  expect(w.$$typeof).toBe(REACT_MEMO);
  if (!w.type) throw new Error('React.memo wrapper exposes no inner component');
  return w.type;
}

// @dnd-kit/core numbers each DndContext's aria-describedby id from a
// module-level counter that keeps incrementing across mounts for the life of
// the process; it never resets and carries no information about markup, so
// mounting the same tree twice (exactly what this file does to compare a
// wrapped and unwrapped render) always bumps it by one and would otherwise
// make ArrangeView/ChordView-bearing views fail this check regardless of
// whether memoizing changed anything.
function normalizeDndIds(html: string): string {
  return html.replace(/DndDescribedBy-\d+/g, 'DndDescribedBy-N');
}

const noop = () => {};

const keyboardProps = {
  keyboardMode: 'scale-locked' as const, setKeyboardMode: noop,
  keyboardOctave: 0, setKeyboardOctave: noop,
  activeNotes: new Set<string>(), scaleRoot: 'C', scaleType: 'Major',
  scaleLockedRows: getScaleLockedKeyboardNotes('C', 'Major', 0),
  chordKeyboardRows: getChordKeyboardRows('C', 'Major', 0),
  handleNoteOn: noop, handleNoteOff: noop,
};

const drumProps = {
  pads: [], activePadId: null, onTriggerPad: noop, onPadVolumeChange: noop, onPadVolumeCommit: noop,
};

// LoopPage and SequencerView take no props (the drumProps chain that used to
// thread App -> LoopPage -> SequencerView was deleted once InputDeckDrumProps
// moved to BottomInputDock only), so their case is zero-prop like SoundView,
// ArrangeView and SongPage.
const CASES: Array<[string, unknown, AnyProps]> = [
  ['SoundView', SoundView, {}],
  ['PatternView', PatternView, {}],
  ['SequencerView', SequencerView, {}],
  ['ArrangeView', ArrangeView, {}],
  ['BottomInputDock', BottomInputDock, { keyboardProps, drumProps }],
  ['LoopPage', LoopPage, {}],
  ['SongPage', SongPage, {}],
  ['LayerPages', LayerPages, {}],
  ['DesktopShell', DesktopShell, { ...SHELL_PROPS }],
  ['MobileShell', MobileShell, { ...SHELL_PROPS }],
  ['MobileTabBar', MobileTabBar, { activeTab: 'sound', onSelect: () => {} }],
];

describe('App-level children are memoized, and memoizing changed no markup', () => {
  for (const [name, component, props] of CASES) {
    test(`${name} is a React.memo wrapper`, () => {
      expect(typeof memoInner(component)).toBe('function');
    });

    test(`${name} renders byte-identically through the wrapper`, () => {
      const outer = renderToString(createElement(component as ComponentType<AnyProps>, props));
      const inner = renderToString(createElement(memoInner(component), props));
      expect(outer.length).toBeGreaterThan(0);
      expect(normalizeDndIds(outer)).toBe(normalizeDndIds(inner));
    });
  }
});

describe('PlaybackHost is memoized', () => {
  // Not a CASES row: that loop asserts non-empty markup, and the host renders
  // nothing by design.
  test('PlaybackHost is a React.memo wrapper', () => {
    expect(typeof memoInner(PlaybackHost)).toBe('function');
  });
});

import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { TransportBar } from './TransportBar';
import { aggregatePlayerState, isHardStopEnabled } from '../store/transportSlice';
import { resolveTransportButtons } from './ui/PlayerTransport';

describe('TransportBar', () => {
  test('the BPM label uses a real Tailwind breakpoint, not the phantom xs:', () => {
    const html = renderToString(<TransportBar />);

    // `xs` is not a Tailwind v4 default breakpoint and this repo has no
    // tailwind.config, so `xs:inline` never generates a rule and the label
    // stays display:none at every viewport width.
    expect(html).not.toContain('xs:inline');
    expect(html).toContain('sm:inline');
  });

  test('transport controls are daisyUI buttons on semantic tokens', () => {
    const html = renderToString(<TransportBar />);

    // A single literal substring, so `btn-sm`, `join-item` and the colour
    // class are proven to sit on the same button, not on unrelated elements.
    expect(html).toContain('btn btn-sm join-item gap-1.5 font-bold text-xs btn-success');
    expect(html).toContain('input input-xs input-ghost');
    expect(html).toContain('range range-xs range-primary');
  });
});

describe('transport bar aggregate behaviour', () => {
  test('one player stopping while the other is stopped still allows a hard stop', () => {
    const seq = 'stopping' as const;
    const chords = 'stopped' as const;
    const aggregate = aggregatePlayerState(seq, chords);

    expect(aggregate).toBe('stopping');
    // The main button is parked, but the cut must stay available.
    expect(resolveTransportButtons(aggregate).main.disabled).toBe(true);
    expect(isHardStopEnabled(seq, chords)).toBe(true);
  });

  test('a single playing player drives the whole bar into playing', () => {
    expect(aggregatePlayerState('stopped', 'playing')).toBe('playing');
    expect(isHardStopEnabled('stopped', 'playing')).toBe(true);
  });

  test('fully stopped disables the hard stop', () => {
    expect(aggregatePlayerState('stopped', 'stopped')).toBe('stopped');
    expect(isHardStopEnabled('stopped', 'stopped')).toBe(false);
  });

  // NOTE on the mixed 'stopping'/'stopped' case specifically: it cannot be
  // exercised through a rendered <TransportBar /> in this repo. zustand v5's
  // `useStore` wires `getServerSnapshot` to `selector(api.getInitialState())`
  // (src: node_modules/zustand/react.js), and `getInitialState()` always
  // returns the exact object captured once at store creation
  // (node_modules/zustand/vanilla.js) — `useAppStore.setState(...)` never
  // touches it. `react-dom/server`'s `useSyncExternalStore` shim calls only
  // `getServerSnapshot()` (never `getSnapshot()`), so every `renderToString`
  // call in this suite reflects the store's *original* default values,
  // regardless of any `setState` performed beforehand — confirmed empirically
  // and already documented next door in
  // `InstantVibesBar.test.tsx` ("renderToString reads that initial
  // snapshot"). Working around it needs either a production change to
  // `TransportBar.tsx` or new module-mocking test infrastructure this repo
  // does not otherwise use, both out of scope for a test-only fix — see the
  // task report for the full investigation.
  //
  // What IS provable through the wired component is the polarity of the
  // `hardStopDisabled` expression itself, using the one store state
  // `renderToString` can ever observe: the default, fully-stopped one. This
  // still catches the failure mode the finding cares about (an inverted `!`
  // at TransportBar.tsx:29): confirmed by deleting that `!` locally and
  // re-running this test, which fails against the "hard button must be
  // disabled" assertion below.
  test('the wired component renders hard stop disabled and play enabled at the default (fully stopped) state', () => {
    const html = renderToString(<TransportBar />);
    const mainButton = html.match(/<button id="btn-bottom-transport"[^>]*>/)?.[0];
    const hardButton = html.match(/<button id="btn-bottom-transport-hard"[^>]*>/)?.[0];

    expect(mainButton).toBeDefined();
    expect(hardButton).toBeDefined();
    expect(mainButton).not.toContain('disabled');
    expect(hardButton).toContain('disabled');
  });
});

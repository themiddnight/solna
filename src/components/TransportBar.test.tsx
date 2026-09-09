import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { TransportBar, songModeLabel } from './TransportBar';
import { aggregatePlayerState, isHardStopEnabled, transportDisplayState } from '../store/transportSlice';
import { resolveTransportButtons } from './ui/PlayerTransport';
import { createDefaultLoop } from '../store/loopSlice';
import { useAppStore } from '../store/store';
import type { Loop } from '../store/types';

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

  test('the master fader renders on the dB taper, at unity by default', () => {
    const html = renderToString(<TransportBar />);

    // Creation-time store state (the zustand + renderToString trap): the
    // factory default is unity, so the fader renders at 0.75 of travel.
    expect(html).toContain('title="Master: 0.0 dB"');
    expect(html).toContain('value="0.75"');
    expect(html).toContain('aria-label="Master"');
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

  test('a solo-loop scope makes the master button offer Play, so a click takes over into song mode', () => {
    // Task 1 already covers transportDisplayState's cases in isolation; this
    // proves the composition the master button actually renders from — on
    // the song layer a solo loop it does not own still presents as 'stopped',
    // so a playing aggregate resolves to the Play button, and PlayerTransport
    // routes a click on that button to onPlay (playAll).
    const displayState = transportDisplayState({ kind: 'loop', loopId: 'a' }, 'playing', 'song', 'a');
    expect(displayState).toBe('stopped');
    expect(resolveTransportButtons(displayState).main.label).toBe('Play');
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

describe('transport meter select', () => {
  test('renders one select carrying all six meters on semantic tokens', () => {
    const html = renderToString(<TransportBar />);
    expect(html).toContain('id="select-transport-meter"');
    expect(html).toContain('select select-xs select-ghost');
    for (const label of ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8']) {
      expect(html).toContain(`>${label}</option>`);
    }
  });

  // A Tailwind palette class is a family PLUS a shade — `slate-400`, `indigo-500`. The shade is
  // not decoration in this assertion, it is what keeps it from firing on ordinary utilities that
  // merely end in a family's name: a bare `not.toContain('slate-')` fails on `-translate-x-1/2`,
  // which is exactly what the VU meter's tick marks introduced. `scripts/themeTokenGuard.ts`
  // (`bun run check:theme`) already spells the rule this way and scans every file; this test is
  // the narrow, in-render version of it and must not enforce a stricter rule than the gate does.
  test('the meter control introduces no raw palette classes', () => {
    const html = renderToString(<TransportBar />);
    expect(html).not.toMatch(/\b(?:indigo|slate)-(?:50|[1-9]00|950)\b/);
    expect(html).not.toContain('text-white');
  });
});

describe('songModeLabel', () => {
  test('returns a song-mode badge only while a song position exists', () => {
    const loops: Loop[] = [{ ...createDefaultLoop(), name: 'Verse' }];
    expect(songModeLabel(null, loops)).toBe(null);
    expect(songModeLabel(0, loops)).toBe('Song · Verse');
  });

  // Reading `name` directly rendered a bare "Song · " for every loop nobody
  // had renamed, which after the label change is every new loop.
  test('falls back to the app label rather than rendering a bare Song ·', () => {
    const loops: Loop[] = [createDefaultLoop()];
    expect(songModeLabel(0, loops)).toBe('Song · untitled-1');
  });
});

describe('the transport bar no longer carries the solo chip', () => {
  afterEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  /**
   * The `SOLO · … ×` chip moved to the view header (ui/SoloChip.tsx), where a
   * solo set is visible on both the Sound and Pattern headers it survives.
   * The bar must not grow a second copy: two clear buttons for one set is a
   * worse bug than the crowding the move fixed.
   */
  test('renders no solo chip even with a solo set', () => {
    useAppStore.setState({ soloTracks: ['lead', 'drums'] });
    const html = renderToString(<TransportBar />);
    expect(html).not.toContain('data-solo-chip');
    expect(html).not.toContain('SOLO ·');
  });
});

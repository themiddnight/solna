import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { TransportBar, TransportReadout } from './TransportBar';
import { TransportSheet } from './TransportSheet';
import { songModeLabel, transportReadout } from './useTransportBar';
import { aggregatePlayerState, transportDisplayState } from '../store/transportSlice';
import { resolveTransportButtons } from './ui/PlayerTransport';
import { createDefaultLoop } from '../store/loopSlice';
import { useAppStore } from '../store/store';
import { audioRecoveryStore } from '../store/audioRecovery';
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
    expect(aggregate !== 'stopped').toBe(true);
  });

  test('a single playing player drives the whole bar into playing', () => {
    expect(aggregatePlayerState('stopped', 'playing')).toBe('playing');
    expect(aggregatePlayerState('stopped', 'playing') !== 'stopped').toBe(true);
  });

  test('fully stopped disables the hard stop', () => {
    expect(aggregatePlayerState('stopped', 'stopped')).toBe('stopped');
    expect(aggregatePlayerState('stopped', 'stopped') !== 'stopped').toBe(false);
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

describe('transport bar audio recovery warning', () => {
  afterEach(() => audioRecoveryStore.setState({ status: 'healthy', modalOpen: false, evidence: [] }));

  test('is absent when healthy and present when recovery was dismissed', () => {
    expect(renderToString(<TransportBar />)).not.toContain('Audio needs recovery');
    audioRecoveryStore.setState({ status: 'unhealthy', modalOpen: false });
    expect(renderToString(<TransportBar />)).toContain('aria-label="Audio needs recovery"');
  });
});

/**
 * R332: below `md` the bar is one row — play/stop, the target, the incident
 * chip, a tempo readout and a chevron — and everything else lives in a
 * non-modal sheet rendered inside the bar. Split at the sheet's `<dialog` so
 * each half is asserted on its own.
 */
describe('the mobile transport bar', () => {
  const html = renderToString(<TransportBar variant="mobile" bottomInset={false} />);
  const sheetAt = html.indexOf('<dialog');
  const bar = html.slice(0, sheetAt);
  const sheet = html.slice(sheetAt);
  const { bpm, meterId } = useAppStore.getInitialState();

  test('is one row: no column stack, no md:contents wrappers', () => {
    expect(html).toMatch(/^<div class="shrink-0 bg-base-100 border-t border-base-300 px-2 py-1 flex items-center gap-1 /);
    expect(html).not.toContain('flex-col');
    expect(html).not.toContain('md:contents');
  });

  test('keeps play/stop, the target label and the readout', () => {
    expect(bar).toContain('id="btn-bottom-transport"');
    expect(bar).toContain('id="btn-bottom-transport-hard"');
    expect(bar).toContain('id="label-transport-play-target" class="text-xs text-base-content/70 truncate min-w-0 flex-1"');
    expect(bar).toContain(`>${transportReadout(bpm, meterId)}</button>`);
  });

  test('the chevron and the readout both control the sheet, collapsed at first', () => {
    expect(bar).toContain('aria-label="Transport settings"');
    for (const id of ['btn-transport-sheet', 'btn-transport-readout']) {
      const button = bar.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
      expect(button).toContain('aria-expanded="false"');
      expect(button).toContain('aria-controls="sheet-transport"');
    }
    expect(sheet).toContain('<dialog id="sheet-transport"');
  });

  test('carries no BPM stepper, meter select, fader, metronome, MIDI or level meter in the bar', () => {
    for (const marker of [
      'id="input-transport-bpm"',
      'id="select-transport-meter"',
      'id="slider-transport-master"',
      'id="btn-transport-metronome"',
      'MIDI',
      'Master peak',
    ]) {
      expect(bar).not.toContain(marker);
    }
  });

  test('the sheet is non-modal and anchored above the bar', () => {
    expect(sheet).toContain('class="absolute bottom-full inset-x-0 z-40');
    expect(sheet).not.toContain('modal-backdrop');
  });

  test('no song-mode badge: it never shows below md', () => {
    expect(html).not.toContain('id="badge-song-mode"');
  });
});

describe('the transport sheet', () => {
  const noop = () => {};
  const html = renderToString(
    <TransportSheet
      open
      onClose={noop}
      bpm={120}
      setBpm={noop}
      meterId="4/4"
      setMeter={noop}
      metronomeActive
      onToggleMetronome={noop}
      masterVolume={0}
      setMasterVolume={noop}
      isPlaying={false}
    />,
  );

  test('renders all six controls', () => {
    expect(html).toContain('id="input-transport-bpm"');
    expect(html).toContain('id="select-transport-meter"');
    expect(html).toContain('id="btn-transport-metronome"');
    expect(html).toContain('>MIDI</span>');
    expect(html).toContain('title="Master peak: -∞ dB"');
    expect(html).toContain('id="slider-transport-master"');
  });

  test('shows what the bar row hides: captions, the level meter, the MIDI word, the dB readout', () => {
    expect(html).toContain('<span class="text-[10px] text-base-content/50 px-1">BPM</span>');
    expect(html).toContain('<span class="text-[10px] text-base-content/50 px-1">Meter</span>');
    expect(html).toContain('class="flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box"');
    expect(html).toContain('<span class="inline text-[10px]">MIDI</span>');
    expect(html).toContain('<span class="tabular-nums text-[10px] text-base-content/60 w-14 text-right shrink-0">0.0 dB</span>');
  });

  test('the BPM stepper buttons take a 44px touch target', () => {
    for (const label of ['Decrease BPM', 'Increase BPM']) {
      expect(html).toMatch(new RegExp(`aria-label="${label}"[^>]*class="[^"]*btn-sm[^"]*min-h-11 min-w-11"`));
    }
  });

  test('the meter select takes the same 44px target, so the two fields stand level', () => {
    expect(html).toMatch(/<select id="select-transport-meter"[^>]*class="[^"]*min-h-11"/);
  });

  test('the metronome is a labelled toggle that states its pressed state', () => {
    expect(html).toMatch(/<button id="btn-transport-metronome" type="button" aria-pressed="true" class="btn btn-sm gap-1.5 text-xs btn-primary"/);
    expect(html).toContain('Metronome</button>');
  });
});

describe('the mobile readout', () => {
  const readout = (metronomeActive: boolean) =>
    renderToString(<TransportReadout bpm={96} meterId="6/8" metronomeActive={metronomeActive} open={false} onToggle={() => {}} />);

  test('reads BPM · meter', () => {
    expect(transportReadout(96, '6/8')).toBe('96 · 6/8');
    expect(readout(false)).toContain('>96 · 6/8</button>');
  });

  test('a dot, and the same fact for a screen reader, while the metronome is on', () => {
    expect(readout(true)).toContain('<span aria-hidden="true" class="w-1.5 h-1.5 rounded-full bg-primary"></span>');
    expect(readout(true)).toContain('<span class="sr-only">, metronome on</span>');
    expect(readout(false)).not.toContain('rounded-full');
    expect(readout(false)).not.toContain('metronome on');
  });
});

describe('the desktop transport bar is unchanged', () => {
  const html = renderToString(<TransportBar />);

  test('keeps its two-group row and every control inline', () => {
    expect(html).toContain(
      'class="shrink-0 bg-base-100 border-t border-base-300 px-2 sm:px-3 py-1.5 sm:py-2 pb-safe sm:pb-safe-lg flex flex-col md:flex-row md:items-center md:justify-between gap-1 sm:gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl"',
    );
    for (const marker of [
      'id="input-transport-bpm"',
      'id="select-transport-meter"',
      'id="btn-transport-metronome"',
      'id="slider-transport-master"',
      'title="Master peak: -∞ dB"',
      '<span class="hidden sm:inline text-[10px]">MIDI</span>',
      'id="label-transport-play-target" class="text-xs text-base-content/70 truncate max-w-20 sm:max-w-32 min-w-0"',
    ]) {
      expect(html).toContain(marker);
    }
  });

  test('has no readout, no chevron and no sheet', () => {
    expect(html).not.toContain('btn-transport-readout');
    expect(html).not.toContain('btn-transport-sheet');
    expect(html).not.toContain('<dialog');
  });
});

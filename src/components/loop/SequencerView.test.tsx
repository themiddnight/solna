import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { SequencerView } from './SequencerView';
import { useAppStore } from '@/store/store';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { DRUM_GRIDS } from '@/data/drumGrids';
import type { BeatParams, BeatPattern } from '@/types';

describe('SequencerView theming', () => {
  const html = renderToString(<SequencerView />);

  test('panels are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-panel border border-base-300');
    expect(html).not.toContain('#12152A');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#0B0D19');
  });

  test('step numbers keep tabular-nums and the downbeat uses accent', () => {
    expect(html).toContain('tabular-nums');
    expect(html).toContain('text-accent');
  });

  test('track dots render the drum-namespace token for every voice', () => {
    for (const voice of BEAT_VOICE_IDS) {
      expect(html, `${voice} row colour`).toContain(`bg-drum-${voice}`);
    }
  });


  test('no legacy palette utilities survive', () => {
    for (const cls of [
      'amber-',
      'cyan-',
      'emerald-',
      'indigo-',
      'pink-',
      'purple-',
      'rose-',
      // Bare 'slate' false-positives on 'translate' (as in -translate-y-1/2),
      // so we check for the palette-color form 'slate-' specifically.
      'slate-',
      'text-white',
      'bg-white/20',
    ]) {
      expect(html).not.toContain(cls);
    }
  });
});

/**
 * Drum Sound moved to the Sound tab (nav restructure phase 2): a kit, a filter
 * and a level change how the drums SOUND and change no note, which is the
 * whole of the Sound/Pattern boundary rule. What is left here is the rhythm.
 */
describe('the beat segment is pattern only', () => {
  const html = renderToString(<SequencerView />);

  test('renders the Pattern card', () => {
    expect(html).toContain('>Pattern<');
  });

  test('no longer renders any sound-shaping control', () => {
    expect(html).not.toContain('Drum Sound');
    expect(html).not.toContain('select-sequencer-sound-kit');
    expect(html).not.toContain('Drum Level');
  });

  test('keeps the grid preset select, which rewrites notes rather than sound', () => {
    expect(html).toContain('select-sequencer-grid');
  });

  // The grid select carries no visible label — the card it sits in is already
  // titled Pattern and it is that card's only field — so its accessible name
  // has to come from somewhere else. This half of the old "the kit and grid
  // selects use the shared stacked field label" test survives the Kit half's
  // move to SoundView because the grid select itself never moved.
  test('the grid select carries its own accessible name', () => {
    expect(html).toContain('aria-label="Drum grid"');
  });
});

describe('SequencerView grid options carry their meter', () => {
  test('in 4/4 every grid is labelled with its own meter', () => {
    useAppStore.setState({ meterId: '4/4' });
    const html = renderToString(<SequencerView />);
    expect(html).toContain('Synthwave · 4/4');
    expect(html).toContain('Boom Bap · 4/4');
    // The option's VALUE is the library id and its LABEL is the display name.
    // They were the same string while the menu was keyed by genre name.
    expect(html).toContain('value="synthwave"');
    expect(html).toContain('value="boom-bap"');
  });

  test('the menu offers the vibe grids too, not just the sequencer genres', () => {
    // The whole point of merging the two drum-grid tables: what an Instant Vibe
    // is built from is now loadable from the sequencer, and a vibe may
    // reference any of the 30.
    useAppStore.setState({ meterId: '4/4' });
    const html = renderToString(<SequencerView />);
    expect(html).toContain('value="lofi-half-time-brush"');
    expect(html).toContain('Lo-Fi Half-Time Brush · 4/4');
    expect(html).toContain('value="afro-six-eight-bell"');
  });

  // There is no companion test here rendering a non-default active meter
  // (e.g. '3/4') through `<SequencerView />` and asserting the "what it
  // becomes" wording. A real `<SequencerView />` cannot be rendered in a
  // non-default active meter through this harness: zustand v5's `useStore`
  // wires `getServerSnapshot` to `selector(api.getInitialState())`
  // (node_modules/zustand/react.js), and `getInitialState()` always returns
  // the object captured once at store creation — `useAppStore.setState(...)`
  // never touches it, and `react-dom/server`'s `useSyncExternalStore` shim
  // calls only `getServerSnapshot()`. This is already confirmed and documented
  // in this repo at `TransportBar.test.tsx:51-66` and `InstantVibesBar.test.tsx`
  // ("renderToString reads that initial snapshot"). Verified empirically here
  // too: `useAppStore.setState({ meterId: '3/4' })` followed by
  // `renderToString(<SequencerView />)` still renders the 4/4 default.
  //
  // A test that calls `patternOptionLabel`/`patternMeterTitle` directly with a
  // '3/4' argument instead of going through the component would not exercise
  // `SequencerView.tsx` at all — it cannot fail for a wiring bug in the
  // component (e.g. a swapped `preset.meter`/`meter.id` argument order, or a
  // dropped `title` prop), and `meterSelect.test.ts` already pins that
  // composition at the helper level. So no such substitute test is added
  // here; a future task that needs the mismatch case rendered end-to-end will
  // need either a production-code change to how `SequencerView` reads
  // `meterId` (e.g. a prop/context seam a test can drive) or new
  // module-mocking test infrastructure this repo does not otherwise use.
});

import { SequencerGrid } from './sequencer/SequencerGrid';
import { stepPublisher } from '../playbackStep';
import { stepCells } from '../sequencerGrid';
import { getMeter } from '@/utils/meter';
import { StepHeader } from '../ui/StepHeader';
import { TrackRow } from './sequencer/TrackRow';
import { useSegmentGatedStep } from '../playbackStep';
import React from 'react';

describe('SequencerGrid', () => {
  const cells = stepCells(getMeter('4/4'));
  const pattern = useAppStore.getState().beatPattern;
  const mix = useAppStore.getState().beatMix;

  const render = () =>
    renderToString(
      <SequencerGrid
        pattern={pattern}
        mix={mix}
        cells={cells}
        onToggleStep={() => {}}
        onToggleMute={() => {}}
        onPreview={() => {}}
        onVolumeChange={() => {}}
      />,
    );

  test('renders the step header and one row per CANONICAL voice', () => {
    const html = render();
    // The roster, not the stored rows: the grid draws every voice the Beat
    // model has, in `BEAT_VOICE_IDS` order, so a pattern missing a row is a
    // silent lane rather than a lane that vanishes.
    for (const voice of BEAT_VOICE_IDS) {
      expect(html, `${voice} row`).toContain(`id="sequencer-row-${voice}"`);
    }
    expect(html).toContain('pl-44'); // StepHeader's strip
  });

  // `isCurrent` in StepHeader/TrackRow is gated by `isPlaying`, which
  // SequencerGrid reads with a plain `useAppStore` selector — the same
  // selector the pre-move SequencerView used, and the same one that hits the
  // renderToString/getInitialState trap documented at the bottom of this
  // file: `setState` cannot move it here, so a full `<SequencerGrid
  // isPlaying-through-the-store />` render can never show the highlight under
  // this harness, playing or not. What this harness CAN exercise is the
  // exact hook call SequencerGrid makes for its playhead
  // (`useSegmentGatedStep('sequencer', 'beat')`), wired into the same leaves
  // with `isPlaying` supplied directly — proving the publisher's value
  // actually reaches the grid, the same way StepRow.test.tsx proves
  // PlayingStepRow's gated ring with a literal prop.
  //
  // This still does not exercise `useSegmentGatedStep`'s FOCUS gate itself
  // (whether `subscribe` attaches a listener at all): `renderToString` never
  // invokes `useSyncExternalStore`'s `subscribe` argument — each call below is
  // a fresh render, not a live-mounted tree receiving a notification — so
  // `getSnapshot` (unconditional, reads `stepPublisher.getStep` regardless of
  // focus) is all that is actually observed here, exactly as it was for the
  // plain `useCurrentStep` this replaced. The gate's pure decision function,
  // `shouldSubscribeToStep`, is unit-tested directly in
  // `playbackStep.test.ts`, which is the only place in this no-DOM repo that
  // CAN test it.
  test('reads the playhead from the step publisher', () => {
    function Probe() {
      const currentStep = useSegmentGatedStep('sequencer', 'beat');
      return <StepHeader cells={cells} currentStep={currentStep} isPlaying />;
    }
    stepPublisher.reset('sequencer');
    const atZero = renderToString(<Probe />);
    stepPublisher.publish('sequencer', 7);
    const atSeven = renderToString(<Probe />);
    expect(atSeven).not.toBe(atZero);
    expect(atSeven).toContain('bg-primary text-primary-content font-bold shadow-md shadow-primary/50');
    stepPublisher.reset('sequencer');
    expect(renderToString(<Probe />)).toBe(atZero);
  });

  // The pattern is seeded HERE rather than taken off the store, so the
  // assertion says what it means: this fixture's kick is on every fourth step
  // by construction, and the test does not quietly depend on whichever groove
  // `defaultBeatState` happens to ship. It is also the whole reason this
  // assertion moved down from the theming block above, which renders the view
  // straight off the creation-time store.
  test('an active step keeps the shadow that used to read shadow-indigo-500/20', () => {
    const seeded = { rows: { ...pattern.rows, kick: pattern.rows.kick.map((_, i) => i % 4 === 0) } };
    const html = renderToString(
      <SequencerGrid
        pattern={seeded}
        mix={mix}
        cells={cells}
        onToggleStep={() => {}}
        onToggleMute={() => {}}
        onPreview={() => {}}
        onVolumeChange={() => {}}
      />,
    );
    expect(html).toContain('shadow-primary/20');
  });

  test('no raw palette or absolute black/white classes leak in', () => {
    const html = render();
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });

  // The grid's JSX was moved out of SequencerView verbatim, not rewritten —
  // this proves it byte-for-byte rather than by the substring checks above,
  // which would pass even if a class or an element got dropped or reordered
  // as long as one known fragment survived. `isPlaying` is computed the same
  // way `SequencerGrid` computes it (off `getInitialState`, not `getState`)
  // because plain `useAppStore` selectors hit the zustand+renderToString trap
  // documented at the top of this file: a rendered `<SequencerGrid />` always
  // reflects the store's creation-time snapshot, never a later `setState`.
  test('renders exactly the markup SequencerView used to inline', () => {
    stepPublisher.publish('sequencer', 5);
    const isPlaying = useAppStore.getInitialState().sequencerPlayer !== 'stopped';

    const before = renderToString(
      <div className="overflow-x-auto">
        <StepHeader cells={cells} currentStep={5} isPlaying={isPlaying} />
        <div className="space-y-1.5 sm:space-y-2 min-w-[660px] sm:min-w-[700px]">
          {BEAT_VOICE_IDS.map((voice) => (
            <TrackRow
              key={voice}
              voiceId={voice}
              steps={pattern.rows[voice]}
              mix={mix.voices[voice]}
              cells={cells}
              currentStep={5}
              isPlaying={isPlaying}
              onToggleStep={() => {}}
              onToggleMute={() => {}}
              onPreview={() => {}}
              onVolumeChange={() => {}}
            />
          ))}
        </div>
      </div>,
    );
    const after = render();
    stepPublisher.reset('sequencer');

    expect(after).toBe(before);
  });

  test('every track row carries a tapered dB fader at unity', () => {
    const html = renderToString(<SequencerView />);
    // Creation-time store state: the eleven factory tracks are all at unity.
    expect(html).toContain('id="slider-track-');
    expect(html).toContain('title="Kick level: 0.0 dB"');
    expect(html).toContain('step="0.005"');
  });
});

describe('DEV-388: the drum-kit-resets-on-refresh fix', () => {
  // The store is one singleton for the whole bun process, and a test here
  // writes Beat state. The snapshot/restore is a `beforeEach`/`afterEach` pair
  // and not a trailing line in the test body on purpose: a trailing restore is
  // SKIPPED when an expectation above it throws, so a failing test would leak
  // its mutated Beat state into every file that runs after it in the same
  // process — one real failure reported as several unrelated ones.
  let beatSnapshot: { beatParams: BeatParams; beatPattern: BeatPattern };
  beforeEach(() => {
    const { beatParams, beatPattern } = useAppStore.getState();
    beatSnapshot = { beatParams, beatPattern };
  });
  afterEach(() => {
    useAppStore.setState(beatSnapshot);
  });

  // What CANNOT be exercised here, said plainly rather than pointed at a test
  // that doesn't exist: `renderToString` never runs `useEffect` at all (see
  // .claude/rules/testing.md's zustand+renderToString trap and React's own
  // SSR semantics) — so re-adding the deleted mount-time `useEffect` that
  // used to overwrite the rehydrated kit would turn NOTHING in this file red,
  // regardless of what it did. store.test.ts's "DEV-388: drum kit + drum
  // filter survive a real refresh" already rules the persist/rehydrate path
  // OUT as the cause (a negative result); there is no positive, effect-firing
  // reproduction available under this repo's no-DOM constraint.
  //
  // What IS pinned instead, both as static properties of the source rather
  // than of a render: (1) the component writes no kit AT ALL — not from the
  // grid picker, not from a mount effect — and (2) it declares exactly one
  // `useEffect`, the preview cleanup, so a reviewer (or this test) catching a
  // second one is the signal a mount-time kit effect has come back.
  //
  // Nav restructure Task 6 moved the kit <select> (and its own write) to
  // SoundView; the pattern/sound split then took the last one away from
  // `applyDrumGrid` too. This file must now write NO sound at all: the grid
  // picker on Pattern loads rows, and the Beat patch is the user's to pick on
  // Sound.
  test('SequencerView writes no Beat sound at all — the picker loads rows only', () => {
    const src = readFileSync(
      new URL('./SequencerView.tsx', import.meta.url),
      'utf8',
    );
    // Guard on the two SETTERS this component would have to subscribe to in
    // order to write a sound at all, so a reintroduced write — a mount effect
    // included — turns this red without needing to name the shape of it.
    expect(src).not.toContain('setBeatPreset');
    expect(src).not.toContain('setBeatParams');
    const applyDrumGridBody = src.slice(
      src.indexOf('const applyDrumGrid ='),
      src.indexOf('const gridOptions ='),
    );
    expect(applyDrumGridBody).toContain('replaceBeatPattern(grid.rows)');
    // NOT `grid.kit`, which no longer exists as a string anywhere and could
    // therefore never fail. These two can: `beatPresetId` is the field the grid
    // still carries as provenance, and `setBeatPreset` is the call a "restore
    // the old picker behaviour" change would reach for.
    expect(applyDrumGridBody).not.toContain('beatPresetId');
    expect(applyDrumGridBody).not.toContain('setBeatPreset');
  });

  // The behavioural half of the rule above. This repo has no DOM, so the
  // <select>'s own change event cannot be fired; what IS executed here is the
  // one store call `applyDrumGrid`'s body is pinned to make, against a grid
  // whose authored sound differs from the loop's — so "picking a grid loads
  // rows only" is observed as state, not only as source text.
  test('choosing a grid rewrites the Pattern and leaves Beat Params untouched', () => {
    const { replaceBeatPattern, setBeatPreset } = useAppStore.getState();
    setBeatPreset('club-standard');
    const gridId = 'boom-bap'; // authored on dusty-break, not club-standard
    const grid = DRUM_GRIDS[gridId];
    expect(grid.beatPresetId).not.toBe('club-standard');
    const soundBefore = useAppStore.getState().beatParams;

    replaceBeatPattern(grid.rows);

    const after = useAppStore.getState();
    expect(after.beatPattern.rows.kick.slice(0, grid.rows.kick.length)).toEqual(grid.rows.kick);
    expect(after.beatPattern.rows.kick.some((hit) => hit)).toBe(true);
    // Identity, not equality: a sound write of any kind rebuilds this object.
    expect(after.beatParams).toBe(soundBefore);
    expect(after.beatParams.basePresetId).toBe('club-standard');
  });

  // Now ZERO, not one. The single effect this used to allow was the note
  // preview's cleanup, and the note preview existed for the `'synth'`/`'bass'`
  // sequencer tracks the roster never had; every Beat voice is a drum one-shot
  // with nothing to cancel. A component with no effect at all cannot grow a
  // mount-time write by accident, which is what this test has always been for.
  test('the component declares no useEffect at all', () => {
    const src = readFileSync(
      new URL('./SequencerView.tsx', import.meta.url),
      'utf8',
    );
    const effects = src.match(/useEffect\(/g) ?? [];
    expect(effects.length).toBe(0);
  });

  test('the grid select starts unselected, not claiming a grid nothing chose', () => {
    const html = renderToString(<SequencerView />);
    expect(html).toContain('Choose a grid');
  });
});

describe('Pattern › Beat track solo', () => {
  const html = renderToString(<SequencerView />);

  test('the Beat header carries the track-level Drums solo', () => {
    expect(html).toContain('aria-label="Solo Drums"');
  });

  test('and no per-voice solo — one solo button in the whole segment', () => {
    expect(html.split('btn-solo-').length - 1).toBe(1);
  });
});

describe('Pattern › Beat segment paste button', () => {
  test('the drum pattern card body carries the beat-pattern paste button', () => {
    const src = readFileSync(new URL('./SequencerView.tsx', import.meta.url), 'utf8');
    expect(src).toContain("groups={['beat-pattern']}");
  });
});

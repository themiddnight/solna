import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SequencerView } from './SequencerView';
import { useAppStore } from '../../store/store';
import { FIELD_LABEL, FIELD_LANE, FIELD_SELECT } from '../ui/fieldClasses';

describe('SequencerView theming', () => {
  const html = renderToString(<SequencerView />);

  test('panels are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-panel border border-base-300');
    expect(html).not.toContain('#12152A');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#0B0D19');
  });

  /**
   * The view header carries identity only, like Master FX. Each module owns its
   * own controls in its own card, which is what ChordView's chord and bass cards
   * already did — the sequencer's header had grown to seven controls, including
   * the pattern edits that belong beside the grid they rewrite.
   */
  test('the drum controls live in their module cards, not the view header', () => {
    const soundCard = html.indexOf('Drum Sound');
    const patternCard = html.indexOf('>Pattern<');
    expect(soundCard).toBeGreaterThan(-1);
    expect(patternCard).toBeGreaterThan(-1);
    // The kit belongs to the sound module; the genre picker and the three
    // destructive pattern tools belong to the pattern module.
    expect(html.indexOf('select-sequencer-sound-kit')).toBeGreaterThan(soundCard);
    expect(html.indexOf('select-sequencer-genre')).toBeGreaterThan(patternCard);
    expect(html.indexOf('btn-randomize-grid')).toBeGreaterThan(patternCard);
    expect(html.indexOf('btn-clear-grid')).toBeGreaterThan(patternCard);
    // Both cards come after the header, so nothing above them can be the header.
    expect(soundCard).toBeGreaterThan(html.indexOf('Drum Sequencer'));
  });

  // A control inside a card's control row wears a stacked label above it (the
  // form ChordView uses); an inline `Label:` prefix is for a group sitting in a
  // one-line toolbar (`Target:`, `Sound Style:`). These two moved into cards, so
  // they moved to the stacked form — and to the shared token, not a fifth copy.
  // The regression this row was rebuilt for: five fields whose controls were
  // 24, 30, 32 and 48px tall bottom-aligned into five different label heights.
  test('every field in a control row shares one label line and one control lane', () => {
    const soundRow = html.slice(html.indexOf('Drum Sound'), html.indexOf('>Pattern<'));
    const labels = soundRow.split(FIELD_LABEL).length - 1;
    const lanes = soundRow.split(FIELD_LANE).length - 1;
    // Kit, Filter, Cutoff, Res each own a label + lane; Drum Level's label and
    // 32px shell come from ChannelStrip, which sits on the same line already.
    expect(labels).toBe(5);
    expect(lanes).toBe(4);
  });

  test('the kit and genre selects use the shared stacked field label', () => {
    expect(html).toContain(FIELD_LABEL);
    expect(html).toContain(FIELD_SELECT);
    expect(html).toContain('>Kit</label>');
    expect(html).not.toContain('Pattern:');
    expect(html).not.toContain('Kit:');
    // The genre select carries no visible label — the card it sits in is
    // already titled Pattern and it is that card's only field — so its
    // accessible name has to come from somewhere else.
    expect(html).toContain('aria-label="Drum pattern genre"');
    expect(html).not.toContain('>Genre</label>');
  });

  test('the drum filter type switch is a daisyUI join on the 32px control lane', () => {
    expect(html).toContain('join');
    // `sm`, not `xs`: it is one field in a control row, and a 24px join next to
    // a 32px select is what pushed the row's labels onto different baselines.
    expect(html).toContain('btn btn-sm join-item');
    expect(html).toContain(FIELD_LANE);
  });

  test('step numbers keep tabular-nums and the downbeat uses accent', () => {
    expect(html).toContain('tabular-nums');
    expect(html).toContain('text-accent');
  });

  test('track dots render semantic token backgrounds', () => {
    expect(html).toContain('bg-error');
    expect(html).toContain('bg-warning');
    expect(html).toContain('bg-success');
    expect(html).toContain('bg-accent');
    expect(html).toContain('bg-secondary');
  });

  test('the active-step shadow that used to read shadow-indigo-500/20 is now shadow-primary/20', () => {
    expect(html).toContain('shadow-primary/20');
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

describe('SequencerView genre options carry their meter', () => {
  test('in 4/4 every genre is labelled with its own meter', () => {
    useAppStore.setState({ meterId: '4/4' });
    const html = renderToString(<SequencerView />);
    expect(html).toContain('Synthwave · 4/4');
    expect(html).toContain('Boom Bap · 4/4');
    // The value is still the bare genre key, so applyGenrePreset is unaffected.
    expect(html).toContain('value="Synthwave"');
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
import { getMeter } from '../../utils/meter';
import { StepHeader } from './sequencer/StepHeader';
import { TrackRow } from './sequencer/TrackRow';
import { useCurrentStep } from '../playbackStep';
import React from 'react';

describe('SequencerGrid', () => {
  const cells = stepCells(getMeter('4/4'));
  const tracks = useAppStore.getState().sequencerTracks;

  const render = () =>
    renderToString(
      <SequencerGrid
        tracks={tracks}
        cells={cells}
        onToggleStep={() => {}}
        onToggleMute={() => {}}
        onPreview={() => {}}
      />,
    );

  test('renders the step header and one row per track', () => {
    const html = render();
    for (const track of tracks) {
      expect(html).toContain(`id="sequencer-row-${track.id}"`);
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
  // exact hook call SequencerGrid makes (`useCurrentStep('sequencer')`),
  // wired into the same leaves with `isPlaying` supplied directly — proving
  // the publisher's value actually reaches the grid, the same way
  // StepRow.test.tsx proves PlayingStepRow's gated ring with a literal prop.
  test('reads the playhead from the step publisher', () => {
    const Probe: React.FC = () => {
      const currentStep = useCurrentStep('sequencer');
      return <StepHeader cells={cells} currentStep={currentStep} isPlaying />;
    };
    stepPublisher.reset('sequencer');
    const atZero = renderToString(<Probe />);
    stepPublisher.publish('sequencer', 7);
    const atSeven = renderToString(<Probe />);
    expect(atSeven).not.toBe(atZero);
    expect(atSeven).toContain('bg-primary text-primary-content font-bold shadow-md shadow-primary/50');
    stepPublisher.reset('sequencer');
    expect(renderToString(<Probe />)).toBe(atZero);
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
        <div className="space-y-2 min-w-[700px]">
          {tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              cells={cells}
              currentStep={5}
              isPlaying={isPlaying}
              onToggleStep={() => {}}
              onToggleMute={() => {}}
              onPreview={() => {}}
            />
          ))}
        </div>
      </div>,
    );
    const after = render();
    stepPublisher.reset('sequencer');

    expect(after).toBe(before);
  });
});

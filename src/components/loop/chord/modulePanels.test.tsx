import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BassModulePanel } from './BassModulePanel';
import { ChordModulePanel } from './ChordModulePanel';
import { PadModulePanel } from './PadModulePanel';

const noop = () => {};

describe('ChordModulePanel', () => {
  const html = renderToString(
    <ChordModulePanel
      onPatternPreviewDown={noop}
      onPatternPreviewUp={noop}
      isPlaying={false}
    />,
  );

  test('renders every control the inline block rendered', () => {
    for (const id of [
      'select-chord-sound-preset',
      'select-chord-octave',
      'select-chord-rhythm-pattern',
      'btn-preview-chord-pattern',
      'slider-chord-feel',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('is its own tint-chord card, like its Bass and Pad siblings', () => {
    // It used to return a bare fragment and borrow the progression card's
    // shell — the only one of the three accompaniment layers without a card
    // and a title of its own.
    expect(html).toContain('card bg-panel tint-chord border border-module-chord/30');
    expect(html).toContain('Chord Module');
  });

  test('carries the Adjust Synth button', () => {
    // Moved here from the progression card's header: it adjusts this layer's
    // sound, which is what Bass and Pad put in the same corner.
    expect(html).toContain('Adjust Synth');
  });

  test('does not render the re-harmonize controls', () => {
    // Both call setChords — they rewrite the progression every layer reads,
    // not this layer's voice of it — so they belong to ChordView's
    // progression card, beside the badge that reports their effect.
    expect(html).not.toContain('btn-reharmonize-chord-progression');
    expect(html).not.toContain('btn-toggle-auto-reharmonize');
    expect(html).not.toContain('Auto-Reharmonize');
  });

  test('wears the chord module identity token and no raw colour', () => {
    expect(html).toContain('text-module-chord');
    expect(html).toContain('[--range-thumb:var(--color-module-chord-content)]');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
  });

  test('the custom step grid is hidden while the mode is preset', () => {
    // INITIAL state has chordRhythmMode 'preset', so no PlayingStepRow renders.
    expect(html).not.toContain('rounded-field transition-all cursor-pointer relative');
  });

  test('the step-number strip is gated on the same mode as the grid', () => {
    // Both moved out of the pattern field together; a conditional left behind
    // on only one of them would leave a bare 1..16 strip under a preset.
    expect(html).not.toContain('Custom Chord Pattern');
    expect(html).not.toContain('min-w-[520px]');
  });
});

describe('BassModulePanel', () => {
  const html = renderToString(
    <BassModulePanel onPatternPreviewDown={noop} onPatternPreviewUp={noop} isPlaying={false} />,
  );

  test('renders every control the inline block rendered', () => {
    for (const id of [
      'select-bass-sound-preset',
      'select-bass-octave',
      'select-bass-rhythm-pattern',
      'btn-preview-bass-pattern',
      'slider-bass-feel',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('keeps its tint-bass card shell and bass identity token', () => {
    expect(html).toContain('card bg-panel tint-bass border border-module-bass/30');
    expect(html).toContain('text-module-bass');
    expect(html).toContain('Bass Module');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
  });

  test('carries the Adjust Synth button', () => {
    expect(html).toContain('Adjust Synth');
  });

  test('the custom step grid and its number strip are hidden while preset', () => {
    expect(html).not.toContain('rounded-field transition-all cursor-pointer relative');
    expect(html).not.toContain('Custom Bass Pattern');
    expect(html).not.toContain('min-w-[520px]');
  });
});

describe('PadModulePanel', () => {
  // getServerSnapshot serves the store's creation-time state (the zustand +
  // renderToString trap), which has padMode 'pad' — so this renders the
  // chord-voicing fields (voicing), never the drone fields. The other
  // branch is exercised by padArm/padPlayback tests; this test stays
  // limited to the structural class-string checks the sibling panels use.
  const html = renderToString(<PadModulePanel />);

  test('renders every control the pad-mode fields expose', () => {
    for (const id of [
      'select-pad-sound-preset',
      'btn-pad-mode-pad',
      'btn-pad-mode-drone',
      'select-pad-octave',
      'btn-pad-voicing-triad',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  // The octave select is the one field OUTSIDE the mode branch, because
  // padOctave feeds resolveDroneNotes as well as the chord-following path.
  // A render can only ever show pad mode here, so what this pins is the
  // control's full range and its select shape, matching chord and bass.
  test('offers the pad octave as a select spanning Oct 1 to Oct 5', () => {
    expect(html).toContain('id="select-pad-octave"');
    // renderToString splits `Oct {o}` into two text nodes, so the marker is
    // part of the output, not noise in the assertion. Value and label are
    // asserted apart because the selected option also carries `selected=""`.
    for (const o of [1, 2, 3, 4, 5]) {
      expect(html).toContain(`<option value="${o}"`);
      expect(html).toContain(`>Oct <!-- -->${o}</option>`);
    }
    expect(html).not.toContain('>Oct <!-- -->6</option>');
    expect(html).not.toContain('>Oct <!-- -->0</option>');
    expect(html).not.toContain('id="btn-pad-octave-3"');
  });

  test('wears its tint-pad card shell and pad identity token, no raw colour', () => {
    expect(html).toContain('card bg-panel tint-pad border border-module-pad/30');
    expect(html).toContain('text-module-pad');
    expect(html).toContain('Pad Module');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
  });
});

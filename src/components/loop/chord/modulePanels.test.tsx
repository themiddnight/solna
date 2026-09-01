import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BassModulePanel } from './BassModulePanel';
import { ChordModulePanel } from './ChordModulePanel';

const noop = () => {};

describe('ChordModulePanel', () => {
  const html = renderToString(
    <ChordModulePanel
      onPatternPreviewDown={noop}
      onPatternPreviewUp={noop}
      autoReharmonize
      onToggleAutoReharmonize={noop}
      onReharmonize={noop}
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
      'btn-reharmonize-chord-progression',
      'btn-toggle-auto-reharmonize',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('wears the chord module identity token and no raw colour', () => {
    expect(html).toContain('text-module-chord');
    expect(html).toContain('[--range-thumb:var(--color-module-chord-content)]');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
  });

  test('the auto-reharmonize label follows the prop', () => {
    // React's static-server-renderer inserts a `<!-- -->` boundary comment
    // between two sibling children that both resolve to plain strings (the
    // literal "Auto-Reharmonize: " and the ternary result) so hydration can
    // tell them apart — present in the pre-extraction markup too, not an
    // artifact of this move.
    expect(html).toContain('Auto-Reharmonize: <!-- -->ON');
    const off = renderToString(
      <ChordModulePanel
        onPatternPreviewDown={noop}
        onPatternPreviewUp={noop}
        autoReharmonize={false}
        onToggleAutoReharmonize={noop}
        onReharmonize={noop}
        isPlaying={false}
      />,
    );
    expect(off).toContain('Auto-Reharmonize: <!-- -->OFF');
    expect(off).toContain('btn-soft');
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

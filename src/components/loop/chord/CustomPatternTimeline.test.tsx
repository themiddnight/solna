import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import {
  CustomPatternTimelineView,
  type CustomPatternTimelineViewProps,
} from './CustomPatternTimeline';

/**
 * The one-lane Chord/Bass timeline, rendered to a string. There is no DOM in
 * this repo, so the pointer commit/cancel arithmetic is covered through
 * `spanResizeOutcome` and everything asserted here is markup: which columns
 * exist, what an event is called, that a body cell is not a second event, and
 * that the playhead folds the run-absolute step this lane is published.
 *
 * The PUBLIC `CustomPatternTimeline` subscribes to `useCurrentStep('chords')`
 * and cannot be handed a step, which is why the view is exported separately
 * with `currentStep` as a prop — see playbackStep.wiring.test.ts for the
 * subscription itself.
 */

const noop = () => {};

const LOOP_LENGTH = 2;
const STEPS_PER_BAR = 16;
const ACCENT_GROUPS = [4, 4, 4, 4];

/** A two-bar 4/4 chord pattern with a four-step span and a one-step span. */
function chordPattern(): { values: boolean[]; holds: number[] } {
  const values = new Array<boolean>(LOOP_LENGTH * MAX_STEPS_PER_BAR).fill(false);
  const holds = new Array<number>(LOOP_LENGTH * MAX_STEPS_PER_BAR).fill(1);
  // Bar two beat one: columns 16..19.
  values[MAX_STEPS_PER_BAR] = true;
  holds[MAX_STEPS_PER_BAR] = 4;
  // Bar two beat two: column 20.
  values[MAX_STEPS_PER_BAR + 4] = true;
  return { values, holds };
}

function render(
  overrides: Partial<CustomPatternTimelineViewProps<boolean>> = {},
): string {
  const { values, holds } = chordPattern();
  return renderToString(
    <CustomPatternTimelineView<boolean>
      values={values}
      holds={holds}
      loopLength={LOOP_LENGTH}
      stepsPerBar={STEPS_PER_BAR}
      accentGroups={ACCENT_GROUPS}
      boundaries={[0, 16, 32]}
      empty={false}
      label="Chord"
      color="bg-module-chord text-module-chord-content"
      isPlaying
      currentStep={null}
      onActivate={noop}
      onErase={noop}
      onResize={noop}
      {...overrides}
    />,
  );
}

describe('CustomPatternTimelineView', () => {
  const html = render();

  test('draws every visible column and a left-aligned bar label per bar', () => {
    for (let column = 0; column < LOOP_LENGTH * STEPS_PER_BAR; column++) {
      expect(html).toContain(`data-column="${column}"`);
    }
    expect(html).toContain('Bar 1');
    expect(html).toContain('Bar 2');
    // The beat-number strip is gone; only the per-bar labels remain.
    expect(html).not.toContain('data-beat=');
  });

  test('an empty column is a button named for its position', () => {
    expect(html).toContain('aria-label="Chord event at bar 1 beat 1 step 1"');
    expect(html).toContain('aria-label="Chord event at bar 1 beat 3 step 1"');
  });

  test('shades empty columns by beat, matching the drum grid', () => {
    // Beat 1 (columns 0-3) is an even beat group and takes the lighter base;
    // beat 2 (columns 4-7) takes the darker, so a beat boundary reads without a
    // ruler — the same zebra StepRow draws for the sequencer.
    const beat1 = html.match(/<button[^>]*aria-label="Chord event at bar 1 beat 1 step 1"[^>]*>/)?.[0] ?? '';
    const beat2 = html.match(/<button[^>]*aria-label="Chord event at bar 1 beat 2 step 1"[^>]*>/)?.[0] ?? '';
    expect(beat1).toContain('bg-base-100');
    expect(beat2).toContain('bg-base-200');
  });

  test('draws a hairline divider at each bar boundary', () => {
    expect((html.match(/data-bar-divider/g) ?? []).length).toBe(LOOP_LENGTH - 1);
    expect(html).toContain('data-bar-divider="16"');
  });

  test('holds every column at least half its height, scrolling instead of shrinking', () => {
    // h-9 is 36px, so a column never drops below 18px; the scroller's min-width
    // is that floor times the column count (32), not the old fixed 420/520px.
    expect(html).toContain('min-width:576px');
    expect(html).not.toContain('min-w-[420px]');
  });

  test('an event head carries its own name and a right-edge resize handle', () => {
    expect(html).toContain('aria-label="Chord event at bar 2 beat 1 step 1"');
    expect(html).toContain('aria-label="Resize Chord event at bar 2 beat 1 step 1"');
    expect(html).toContain('aria-label="Chord event at bar 2 beat 2 step 1"');
    expect(html).toContain('aria-label="Resize Chord event at bar 2 beat 2 step 1"');
  });

  test('a body cell points back at its owner and is no event of its own', () => {
    const body = html.match(/<div[^>]*data-owner-column="16"[^>]*>/)?.[0] ?? '';
    expect(body).toContain('data-owner-column="16"');
    expect(body).not.toContain('aria-label');
    expect(body).not.toContain('tabindex');
    // Only heads and empty columns are named events: 32 columns, two of them
    // heads and three of them bodies. A body that became its own event would
    // add a fourth name and a fourth handler.
    expect((html.match(/aria-label="Chord event at bar/g) ?? []).length).toBe(29);
  });

  test('folds the published step by this lane cycle, so bar two is reachable', () => {
    expect(render({ currentStep: 20 })).toContain('data-playhead-column="20"');
    expect(render({ currentStep: 20 })).toContain('aria-label="Playhead at bar 2 beat 2 step 1"');
    // The chords publisher emits a run-absolute step, so the same column is
    // reached again one cycle later rather than running off the lane.
    expect(render({ currentStep: 20 + LOOP_LENGTH * STEPS_PER_BAR })).toContain(
      'data-playhead-column="20"',
    );
    expect(render({ currentStep: 20 + LOOP_LENGTH * STEPS_PER_BAR })).toContain(
      'aria-label="Playhead at bar 2 beat 2 step 1"',
    );
    expect(render({ currentStep: 0 })).toContain('data-playhead-column="0"');
  });

  test('draws no playhead while the transport is stopped', () => {
    expect(render({ currentStep: 20, isPlaying: false })).not.toContain('data-playhead-column');
  });

  test('wears the caller module token and no raw palette colour', () => {
    expect(html).toContain('bg-module-chord text-module-chord-content');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
  });

  test('names a tone span by the caller label rather than a generic event', () => {
    const { values, holds } = chordPattern();
    const bass = renderToString(
      <CustomPatternTimelineView<string>
        values={values.map((active) => (active ? 'fifth' : 'rest'))}
        holds={holds}
        loopLength={LOOP_LENGTH}
        stepsPerBar={STEPS_PER_BAR}
        accentGroups={ACCENT_GROUPS}
        boundaries={[0, 16, 32]}
        empty="rest"
        label="Bass"
        color="bg-module-bass text-module-bass-content"
        valueLabel={() => '5th'}
        isPlaying
        currentStep={null}
        onActivate={noop}
        onErase={noop}
        onResize={noop}
      />,
    );

    expect(bass).toContain('aria-label="Bass 5th at bar 2 beat 1 step 1"');
    expect(bass).toContain('aria-label="Resize Bass 5th at bar 2 beat 1 step 1"');
    expect(bass).toContain('aria-label="Bass event at bar 1 beat 3 step 1"');
  });
});

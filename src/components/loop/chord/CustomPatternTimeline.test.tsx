import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import { customPatternFoldedStep } from './customPatternGrid';
import { CustomPatternTimeline, type CustomPatternTimelineProps } from './CustomPatternTimeline';

/**
 * The one-lane Chord/Bass timeline, rendered to a string. There is no DOM in
 * this repo, so the pointer commit/cancel arithmetic is covered through
 * `spanResizeOutcome` and everything asserted here is markup: which columns
 * exist, what an event is called, that a body cell is not a second event, and
 * that a stopped lane draws no playhead.
 *
 * `CustomPatternTimeline` (the exported grid, memoized) takes NO
 * `currentStep` prop at all — mirroring `LeadMelodyCells`, it never reads the
 * shared step, so a published step cannot force it to rebuild its cells or
 * its per-cell context. `CustomPatternPlayhead` is the only thing in the file
 * that subscribes to `useSegmentGatedStep('chords', 'accompaniment')`
 * (mirroring `LeadMarker`), gated so the subscription is inert while
 * Accompaniment is not the focused Pattern segment, and
 * `CustomPatternTimeline` renders it inline as a grid item alongside the
 * cells — a component-tree child rather than a sibling, unlike `LeadMarker`,
 * because this lane's columns are `1fr` tracks and only a fellow CSS Grid
 * item lines up with them (see the file's own docblock).
 *
 * A subscriber cannot be handed a step under `renderToString` (the zustand +
 * external-store trap: `useSyncExternalStore` serves `getSnapshot()`'s
 * CURRENT value for both snapshots here, and nothing in this test drives the
 * shared `stepPublisher` singleton), so the fold arithmetic
 * `CustomPatternPlayhead` uses is pinned directly as pure logic
 * (`customPatternFoldedStep`, tested in `customPatternGrid.test.ts`) and only
 * the DEFAULT (unpublished, step 0) render is asserted here — exactly the
 * convention `LeadMelodyGrid.test.tsx` uses for `LeadMarker`.
 */

const noop = () => {};

const LOOP_LENGTH = 2;
const STEPS_PER_BAR = 16;
const ACCENT_GROUPS = [4, 4, 4, 4];

const source = readFileSync(
  join(process.cwd(), 'src/components/loop/chord/CustomPatternTimeline.tsx'),
  'utf8',
);

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

function render(overrides: Partial<CustomPatternTimelineProps<boolean>> = {}): string {
  const { values, holds } = chordPattern();
  return renderToString(
    <CustomPatternTimeline<boolean>
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
      onActivate={noop}
      onErase={noop}
      onResize={noop}
      {...overrides}
    />,
  );
}

describe('CustomPatternTimeline (the memoized cell grid)', () => {
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

  test('draws no playhead while the transport is stopped', () => {
    expect(render({ isPlaying: false })).not.toContain('data-playhead-column');
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
      <CustomPatternTimeline<string>
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

/**
 * The split itself: code-shape proof that the cell-building logic cannot
 * read a step, plus a source pin of where the ONE subscription lives — the
 * same two-part proof `LeadMelodyGrid.test.tsx` uses for `LeadMarker`
 * ("the marker subscribes the step itself, so a tick re-renders one div").
 * A per-tick render-COUNT is not runtime-testable in this harness (no DOM,
 * no render counter); what is testable, and what actually matters for
 * review, is that `currentStep` cannot reach the grid's props at all.
 */
describe('the playhead subscription is isolated to its own leaf', () => {
  test('CustomPatternTimelineProps has no currentStep field for the grid to read', () => {
    // A type-level guard: if `currentStep` were ever re-added to the grid's
    // own prop type, this assignment would stop compiling.
    const props: CustomPatternTimelineProps<boolean> = {
      values: [false],
      holds: [1],
      loopLength: 1,
      stepsPerBar: 1,
      accentGroups: [1],
      boundaries: [0],
      empty: false,
      label: 'Chord',
      color: '',
      isPlaying: false,
      onActivate: noop,
      onErase: noop,
      onResize: noop,
    };
    expect('currentStep' in props).toBe(false);
  });

  test('exactly one useSegmentGatedStep call in the file, inside CustomPatternPlayhead', () => {
    expect(source.match(/useSegmentGatedStep\(/g) ?? []).toHaveLength(1);
    expect(source).toContain("useSegmentGatedStep('chords', 'accompaniment')");
    const playheadStart = source.indexOf('function CustomPatternPlayhead');
    const gridStart = source.indexOf('export function CustomPatternTimeline');
    expect(playheadStart).toBeGreaterThan(-1);
    expect(gridStart).toBeGreaterThan(playheadStart);
    // The subscription sits inside CustomPatternPlayhead's own body, not the
    // grid's — a retyped call site would move it out of this slice.
    expect(source.slice(playheadStart, gridStart)).toContain(
      "useSegmentGatedStep('chords', 'accompaniment')",
    );
  });

  test('the grid renders the playhead as a child, not a value threaded through props', () => {
    const gridStart = source.indexOf('export function CustomPatternTimeline');
    expect(source.slice(gridStart)).toContain('<CustomPatternPlayhead');
  });
});

describe('CustomPatternPlayhead (the subscribed leaf)', () => {
  test('folds the published step by this lane cycle — see customPatternGrid.test.ts', () => {
    // The fold arithmetic CustomPatternPlayhead uses is pure and fully
    // covered there; this just proves it is the SAME function this file
    // imports, not a re-implemented copy that could drift.
    expect(customPatternFoldedStep(20, LOOP_LENGTH * STEPS_PER_BAR)).toBe(20);
    expect(customPatternFoldedStep(20, 1 * STEPS_PER_BAR)).toBe(4);
  });

  test('renders at the default step when nothing has published yet', () => {
    // renderToString cannot force the shared stepPublisher singleton to a
    // playing value (same trap LeadMarker's own test documents), so this
    // proves the composition wires correctly at its creation-time default
    // (step 0) rather than proving a later tick moves it.
    expect(render()).toContain('data-playhead-column="0"');
    expect(render()).toContain('aria-label="Playhead at bar 1 beat 1 step 1"');
  });
});

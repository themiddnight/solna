import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type React from 'react';
import { renderToString } from 'react-dom/server';
import { LeadMelodyHeaders, LeadMelodyGrid, LeadMarker, LeadMarkerView } from './LeadMelodyGrid';
import { stepCells } from '../../sequencerGrid';
import { getMeter } from '../../../utils/meter';
import { leadColumnCells } from './melodyGrid';

const source = readFileSync(
  join(process.cwd(), 'src/components/loop/lead/LeadMelodyGrid.tsx'),
  'utf8',
);

describe('LeadMelodyGrid', () => {
  test('renders one loop-length option per divisor of the progression', () => {
    // Default progression (INITIAL_CHORDS) totals 4 bars → divisors 1, 2, 4.
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('id="select-lead-loop-length"');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="4"');
  });

  test('the grid lays out loopLength × stepsPerBar columns', () => {
    // Defaults: 4/4 (16 steps) × 1-bar loop → 16 columns of 20px.
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('repeat(16, 20px)');
  });

  test('the marker translates by column × cell width, from the ruler onward', () => {
    // The stride is LEAD_CELL_WIDTH, the same constant the header buttons size
    // themselves with — a marker that drifts from its own ruler is worse than
    // two honest markers. `left` is the note-name column's width.
    const html = renderToString(<LeadMarkerView column={3} />);
    expect(html).toContain('translateX(60px)'); // 3 × 20
    expect(html).toContain('left:44px');
    expect(renderToString(<LeadMarkerView column={0} />)).toContain('translateX(0px)');
  });

  test('the marker subscribes the step itself, so a tick re-renders one div', () => {
    // LeadMarker owns useLeadMarkerColumn; LeadMelodyGrid does not call it.
    // Read from the grid's body, a published step (8-32/sec) reconciled the
    // toolbar's two selects, the Slider, eight buttons and every pitch label
    // to move one translateX — the same fix as moving the grid out of
    // SynthView. Geometry stays on LeadMarkerView's explicit prop because
    // renderToString cannot force a playing store state.
    expect(renderToString(<LeadMarker columns={16} />)).toContain('translateX(0px)');
    // Exactly one call site, and it is LeadMarker's. There is no DOM here to
    // count renders with, so the subscription's LOCATION is what is pinned.
    expect(source.match(/useLeadMarkerColumn\(/g) ?? []).toHaveLength(1);
    expect(source).toContain('<LeadMarker columns={columns} />');
  });

  test('a stopped grid still draws the marker, parked on the cursor', () => {
    // One marker, always. Stopped it is the cursor (0 by default under
    // renderToString), playing it is the clock — but it never disappears, and
    // the header strip no longer draws a second band of its own.
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('ring-inset ring-primary');
    expect(html).toContain('translateX(0px)');
    expect(html).not.toContain('bg-secondary text-secondary-content');
  });

  test('no raw palette or absolute black/white classes leak in', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });

  test('renders a clear button and the note-name column', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('id="btn-lead-clear"');
    expect(html).toContain('font-mono');
  });

  test('the resolution select offers the three resolutions, in order', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('id="select-lead-step-resolution"');
    const options = [...html.matchAll(/<option value="(1\/(?:8|16|32))"/g)].map((m) => m[1]);
    expect(options).toEqual(['1/8', '1/16', '1/32']);
  });
});

describe('LeadMelodyGrid cells', () => {
  test('an empty melody renders every cell unpressed with its pitch label', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="C4"');
    // Scoped to the CELL buttons: the header strips legitimately press the
    // selected bar and the cursor column, and an unscoped assertion here
    // would fail on a selection that has nothing to do with the melody.
    expect(html).not.toContain('aria-pressed="true" class="relative h-5');
  });

  test('the bar copy and paste buttons render, with paste dead until something is copied', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('id="btn-lead-copy-bar"');
    expect(html).toContain('id="btn-lead-paste-bar"');
    expect(html.slice(html.indexOf('id="btn-lead-paste-bar"'))).toContain('disabled');
  });
});

describe('LeadMelodyHeaders', () => {
  const meter = getMeter('4/4');
  const cellsPerBar = stepCells(meter);
  const headerProps = (columns: number, cursor = 0): React.ComponentProps<typeof LeadMelodyHeaders> => ({
    columns,
    cellsPerBar,
    cursor,
    selectedBar: Math.floor(cursor / meter.stepsPerBar),
    onSelectColumn: () => {},
    columnsPerBar: meter.stepsPerBar,
  });

  test('renders one cell per column in both strips, numbering bars and beats', () => {
    const html = renderToString(
      <LeadMelodyHeaders {...headerProps(32)} />,
    );
    // Two strips of 32 columns, plus one label spacer each.
    expect(html.split('width:20px').length - 1).toBe(64);
    expect(html.split('width:44px').length - 1).toBe(2);
    // Bar numbers appear only at each bar start: 2 bars over 32 columns.
    // Scoped to the bar-number strip's own class string, since the beat
    // strip legitimately renders a "3" (beat 3 of 4) in this same html.
    expect(html).toContain('>1</button>');
    expect(html).toContain('>2</button>');
    expect(html).not.toContain('font-bold text-base-content/60" style="width:20px">3</button>');
  });

  test('the whole selected bar is pressed, and exactly one column is the cursor', () => {
    // The bar strip marks every column of the selected bar so the band reads
    // as one target; the beat strip marks the single cursor column. The
    // cursor's PIXELS belong to the marker now (DEV-377), so the strip carries
    // only the a11y state.
    const html = renderToString(<LeadMelodyHeaders {...headerProps(32, 20)} />);
    expect(html.split('aria-pressed="true"').length - 1).toBe(meter.stepsPerBar + 1);
    expect(html).toContain('bg-primary/20 text-primary');
    expect(html).not.toContain('bg-secondary');
  });

  test('a cursor in bar 1 does not light bar 0', () => {
    const barZeroPressed = (cursor: number): number => {
      const html = renderToString(<LeadMelodyHeaders {...headerProps(32, cursor)} />);
      return html.slice(0, html.indexOf('Bar 2')).split('aria-pressed="true"').length - 1;
    };
    expect(barZeroPressed(0)).toBeGreaterThan(0);
    expect(barZeroPressed(20)).toBe(0);
  });

  test('every header cell is a real button, so the strips are reachable by keyboard', () => {
    const html = renderToString(<LeadMelodyHeaders {...headerProps(16)} />);
    expect(html.split('<button').length - 1).toBe(32);
    expect(html).toContain('aria-label="Bar 1"');
    expect(html).toContain('aria-label="Bar 1 step 1"');
  });

  test('both strips are a full grid row tall, and the DEV-371 contract survives it', () => {
    const html = renderToString(<LeadMelodyHeaders {...headerProps(16, 5)} />);
    // h-5 is the grid row cell's height (LeadMelodyCells and the note-name
    // column both use it), so a bar or a beat is an easy pointer target.
    expect(html.split('h-5 flex items-center justify-center').length - 1).toBe(32);
    // Everything DEV-371 delivered, unchanged: every column is a real button,
    // every button is labelled, the selected bar and the cursor column are the
    // pressed ones, and the arrow-key handler is still on both strips.
    expect(html.split('<button').length - 1).toBe(32);
    expect(html).toContain('aria-label="Bar 1"');
    expect(html).toContain('aria-label="Bar 1 step 6"');
    expect(html.split('aria-pressed="true"').length - 1).toBe(meter.stepsPerBar + 1);
    expect(html.split('width:20px').length - 1).toBe(32);
  });

  test('output is byte-identical to the same props rendered twice', () => {
    const render = () =>
      renderToString(
        <LeadMelodyHeaders {...headerProps(16)} />,
      );
    expect(render()).toBe(render());
  });

  test('is memoized, so the parent re-rendering with the same props is free', () => {
    // React.memo wraps the function component; assert the wrapper is present so
    // the whole point of the extraction cannot be silently undone.
    expect((LeadMelodyHeaders as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });

  test('no raw palette or absolute black/white classes leak in', () => {
    const html = renderToString(
      <LeadMelodyHeaders {...headerProps(16)} />,
    );
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });

  test('the DEV-371 contract holds at every stride, only the counts change', () => {
    // The labels' CONTENT changes with the column count; their contract does
    // not. Every column is a real button, every button is labelled, the
    // selected bar and the cursor column are the pressed ones.
    const at = (colsPerBar: number): string =>
      renderToString(
        <LeadMelodyHeaders
          {...headerProps(colsPerBar, 0)}
          columnsPerBar={colsPerBar}
          cellsPerBar={leadColumnCells(meter, (16 * 2) / colsPerBar)}
        />,
      );

    const eighths = at(8);
    expect(eighths.split('<button').length - 1).toBe(16); // 8 bar + 8 beat
    expect(eighths).toContain('aria-label="Bar 1"');
    expect(eighths).toContain('aria-label="Bar 1 step 6"');
    expect(eighths.split('aria-pressed="true"').length - 1).toBe(8 + 1);

    const thirtyseconds = at(32);
    expect(thirtyseconds.split('<button').length - 1).toBe(64);
    expect(thirtyseconds).toContain('aria-label="Bar 1 step 32"');
    expect(thirtyseconds.split('aria-pressed="true"').length - 1).toBe(32 + 1);
  });

  test('the cell width never moves, so the marker and the ruler cannot drift', () => {
    // No zoom, on purpose: the marker's translateX and these buttons must
    // agree on a stride in pixels, and a fixed width keeps that agreement
    // free rather than making it a third thing to keep in sync.
    const wide = renderToString(
      <LeadMelodyHeaders
        {...headerProps(32, 0)}
        columnsPerBar={32}
        cellsPerBar={leadColumnCells(meter, 1)}
      />,
    );
    expect(wide.split('width:20px').length - 1).toBe(64);
    expect(renderToString(<LeadMarkerView column={3} />)).toContain('translateX(60px)');
  });
});

describe('LeadMelodyGrid gate slider', () => {
  test('renders the labelled per-loop gate at the default 85%', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('Gate 85%');
    expect(html).toContain('id="range-lead-gate"');
    expect(html).toContain('range range-primary range-xs w-20');
  });

  test('the slider states that gate applies when the arp is off', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('Applies when the arp is off');
  });
});

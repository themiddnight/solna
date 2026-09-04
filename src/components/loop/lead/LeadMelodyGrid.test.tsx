import { describe, expect, test } from 'bun:test';
import type React from 'react';
import { renderToString } from 'react-dom/server';
import { LeadMelodyHeaders, LeadMelodyGrid, LeadPlayhead } from './LeadMelodyGrid';
import { stepCells } from '../../sequencerGrid';
import { getMeter } from '../../../utils/meter';

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

  test('the playhead overlay translates by step × cell width', () => {
    expect(renderToString(<LeadPlayhead currentStep={3} />)).toContain('translateX(60px)'); // 3 × 20
    expect(renderToString(<LeadPlayhead currentStep={0} />)).toContain('translateX(0px)');
  });

  test('a stopped lead player renders no playhead at all', () => {
    // The store's lead player is 'stopped' by default, and LeadMelodyGrid now
    // owns useLeadPlayback, so this is the real stopped rendering.
    expect(renderToString(<LeadMelodyGrid />)).not.toContain('ring-inset ring-primary');
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
    stepsPerBar: meter.stepsPerBar,
    columns,
    cellsPerBar,
    cursor,
    selectedBar: Math.floor(cursor / meter.stepsPerBar),
    onSelectColumn: () => {},
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
    // as one target; the beat strip marks the single cursor column.
    const html = renderToString(<LeadMelodyHeaders {...headerProps(32, 20)} />);
    expect(html.split('aria-pressed="true"').length - 1).toBe(meter.stepsPerBar + 1);
    expect(html).toContain('bg-secondary text-secondary-content');
    expect(html).toContain('bg-primary/20 text-primary');
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

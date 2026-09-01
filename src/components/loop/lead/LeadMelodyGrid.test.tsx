import { describe, expect, test } from 'bun:test';
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

describe('LeadMelodyHeaders', () => {
  const meter = getMeter('4/4');
  const cellsPerBar = stepCells(meter);

  test('renders one cell per column in both strips, numbering bars and beats', () => {
    const html = renderToString(
      <LeadMelodyHeaders stepsPerBar={meter.stepsPerBar} columns={32} cellsPerBar={cellsPerBar} />,
    );
    // Two strips of 32 columns, plus one label spacer each.
    expect(html.split('width:20px').length - 1).toBe(64);
    expect(html.split('width:44px').length - 1).toBe(2);
    // Bar numbers appear only at each bar start: 2 bars over 32 columns.
    // Scoped to the bar-number strip's own class string, since the beat
    // strip legitimately renders a "3" (beat 3 of 4) in this same html.
    expect(html).toContain('>1</div>');
    expect(html).toContain('>2</div>');
    expect(html).not.toContain('font-bold text-base-content/60" style="width:20px">3</div>');
  });

  test('output is byte-identical to the same props rendered twice', () => {
    const render = () =>
      renderToString(
        <LeadMelodyHeaders stepsPerBar={meter.stepsPerBar} columns={16} cellsPerBar={cellsPerBar} />,
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
      <LeadMelodyHeaders stepsPerBar={meter.stepsPerBar} columns={16} cellsPerBar={cellsPerBar} />,
    );
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });
});

import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { LeadPianoRoll } from './LeadPianoRoll';

describe('LeadPianoRoll', () => {
  test('renders one loop-length option per divisor of the progression', () => {
    // Default progression (INITIAL_CHORDS) totals 4 bars → divisors 1, 2, 4.
    const html = renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />);
    expect(html).toContain('id="select-lead-loop-length"');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="4"');
  });

  test('the grid lays out loopLength × stepsPerBar columns', () => {
    // Defaults: 4/4 (16 steps) × 1-bar loop → 16 columns of 20px.
    const html = renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />);
    expect(html).toContain('repeat(16, 20px)');
  });

  test('the playhead overlay translates by step × cell width only while playing', () => {
    const playing = renderToString(<LeadPianoRoll currentStep={3} isPlaying />);
    expect(playing).toContain('translateX(60px)'); // 3 × 20
    const stopped = renderToString(<LeadPianoRoll currentStep={3} isPlaying={false} />);
    expect(stopped).not.toContain('translateX(60px)');
  });

  test('no raw palette or absolute black/white classes leak in', () => {
    const html = renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />);
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });

  test('renders a clear button and the note-name column', () => {
    const html = renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />);
    expect(html).toContain('id="btn-lead-clear"');
    expect(html).toContain('font-mono');
  });
});

import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { StepHeader } from './StepHeader';
import { STEP_ROW_CLASS } from './StepRow';
import { stepCells } from '../sequencerGrid';
import { getMeter } from '../../utils/meter';

const cells = stepCells(getMeter('4/4'));

describe('StepHeader', () => {
  test('one numbered cell per step of the meter', () => {
    const html = renderToString(
      <StepHeader cells={cells} currentStep={0} isPlaying={false} />,
    );
    for (let n = 1; n <= cells.length; n++) expect(html).toContain(`>${n}</div>`);
    expect(stepCells(getMeter('12/8')).length).toBe(24);
  });

  test('the default container is the drum grid\'s own, gutter and all', () => {
    // The drum grid renders StepHeader with no className. Its markup must not
    // move when the chord and bass grids start passing one.
    const html = renderToString(
      <StepHeader cells={cells} currentStep={0} isPlaying={false} />,
    );
    expect(html).toContain(
      'flex items-center gap-2 mb-2 pl-38 sm:pl-44 min-w-[600px] sm:min-w-[700px]',
    );
  });

  test('a className REPLACES the default rather than appending to it', () => {
    // Appending would leave the pl-* gutter in place and indent the chord and
    // bass numbers by the drum grid's track-label column.
    const html = renderToString(
      <StepHeader cells={cells} currentStep={0} isPlaying={false} className={STEP_ROW_CLASS} />,
    );
    expect(html).toContain(`class="${STEP_ROW_CLASS}"`);
    expect(html).not.toContain('pl-44');
    expect(html).not.toContain('pl-38');
    expect(html).not.toContain('min-w-[700px]');
    expect(html).not.toContain('min-w-[600px]');
  });

  test('STEP_ROW_CLASS is the row default, so a header sharing it aligns', () => {
    // The numbers sit in their own flex container from the buttons. Different
    // gap utilities put the two on different column pitches, and the drift
    // compounds across 16 steps — this pins them to one constant.
    expect(STEP_ROW_CLASS).toContain('gap-1.5');
  });

  test('the playing step is highlighted, and only while playing', () => {
    const playing = renderToString(
      <StepHeader cells={cells} currentStep={4} isPlaying />,
    );
    expect(playing).toContain('bg-primary text-primary-content');
    const stopped = renderToString(
      <StepHeader cells={cells} currentStep={4} isPlaying={false} />,
    );
    expect(stopped).not.toContain('bg-primary text-primary-content');
  });

  test('beat-start numbers are accented and carry no raw colour', () => {
    const html = renderToString(
      <StepHeader cells={cells} currentStep={0} isPlaying={false} />,
    );
    expect(html).toContain('text-accent font-bold');
    expect(html).not.toContain('#');
    expect(html).not.toContain('text-white');
  });
});

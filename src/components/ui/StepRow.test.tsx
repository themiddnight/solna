import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { StepRow, PlayingStepRow } from './StepRow';
import { stepPublisher } from '../playbackStep';
import { stepCells } from '../sequencerGrid';
import { getMeter } from '../../utils/meter';
import type { BassStepChoice } from '../../audio/bassPatterns';

describe('StepRow — boolean grid', () => {
  const cells = stepCells(getMeter('4/4'));
  const steps = [
    true, false, false, false,
    true, false, false, false,
    true, false, false, false,
    true, false, false, false,
  ];

  test('renders one button per cell', () => {
    const html = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={-1}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(html.split('<button').length - 1).toBe(16);
  });

  test('active steps wear the caller colour; inactive steps wear base tokens', () => {
    const html = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={-1}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(html).toContain('bg-module-chord text-module-chord-content');
    expect(html).toContain('bg-base-200');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('#');
  });

  test('the playing step carries the playhead ring, gated by isPlaying', () => {
    const playing = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={0}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(playing).toContain('ring-2 ring-primary');
    const stopped = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={0}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(stopped).not.toContain('ring-2 ring-primary');
  });
});

describe('StepRow — bass choices with labels', () => {
  const cells = stepCells(getMeter('4/4'));
  const choices: BassStepChoice[] = [
    'root', 'rest', 'rest', 'rest',
    'fifth', 'rest', 'rest', 'rest',
    'seventh', 'rest', 'rest', 'rest',
    'octave', 'rest', 'rest', 'rest',
  ];
  const label = (v: BassStepChoice): string =>
    v === 'root' ? 'R' : v === 'third' ? '3' : v === 'fifth' ? '5' : v === 'seventh' ? '7' : v === 'octave' ? '8' : '';

  test('labels render on active steps', () => {
    const html = renderToString(
      <StepRow<BassStepChoice>
        cells={cells}
        steps={choices}
        currentStep={-1}
        isPlaying={false}
        color="bg-module-bass text-module-bass-content"
        isActive={(v) => v !== 'rest'}
        getLabel={label}
        onStepClick={() => {}}
      />,
    );
    expect(html).toContain('>R<');
    expect(html).toContain('>5<');
    expect(html).toContain('>7<');
    expect(html).toContain('>8<');
  });

});
describe('PlayingStepRow', () => {
  const cells = stepCells(getMeter('4/4'));
  const steps = cells.map(() => false);

  test('renders the ring on the step the publisher currently holds', () => {
    stepPublisher.publish('chords', 3);
    const html = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    // One highlighted column, and it is the published one.
    expect(html.split('ring-2 ring-primary').length - 1).toBe(1);

    stepPublisher.publish('chords', 4);
    const moved = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(moved).not.toBe(html);
    stepPublisher.reset('chords');
  });

  test('renders byte-identically to StepRow given the same step', () => {
    stepPublisher.publish('chords', 2);
    const wrapped = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    const plain = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={2}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(wrapped).toBe(plain);
    stepPublisher.reset('chords');
  });

  test('a stopped player shows no ring regardless of the published step', () => {
    stepPublisher.publish('chords', 5);
    const html = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(html).not.toContain('ring-2 ring-primary');
    stepPublisher.reset('chords');
  });
});

describe('StepRow — the props TrackRow needs', () => {
  const cells = stepCells(getMeter('4/4'));
  const steps = Array.from({ length: 16 }, (_, i) => i % 4 === 0);

  const base = {
    cells,
    steps,
    currentStep: -1,
    isPlaying: false,
    color: 'bg-error',
    isActive: (v: boolean) => v === true,
    onStepClick: () => {},
  };

  test('getButtonId stamps a stable id on every button', () => {
    const html = renderToString(
      <StepRow<boolean> {...base} getButtonId={(i) => `step-kick-${i}`} />,
    );
    for (let i = 0; i < 16; i++) expect(html).toContain(`id="step-kick-${i}"`);
  });

  test('without getButtonId no id attribute is emitted (existing callers unchanged)', () => {
    expect(renderToString(<StepRow<boolean> {...base} />)).not.toContain('id="');
  });

  test('activeOverlay="pulse" renders the pulse div instead of a label', () => {
    const html = renderToString(<StepRow<boolean> {...base} activeOverlay="pulse" />);
    expect(html).toContain('absolute inset-0 bg-base-content/10 rounded-field animate-pulse');
    expect(html.split('animate-pulse').length - 1).toBe(4);
  });

  test('activeOverlay="pulse" ignores getLabel', () => {
    const html = renderToString(
      <StepRow<boolean> {...base} activeOverlay="pulse" getLabel={() => 'X'} />,
    );
    expect(html).not.toContain('>X<');
  });

  test('the default overlay is still the label badge', () => {
    const html = renderToString(<StepRow<boolean> {...base} getLabel={() => 'X'} />);
    expect(html).toContain('>X<');
    expect(html).not.toContain('animate-pulse');
  });

  test('rowClassName replaces the wrapper class and defaults to the current one', () => {
    expect(renderToString(<StepRow<boolean> {...base} />))
      .toContain('class="flex items-center gap-1.5"');
    expect(renderToString(<StepRow<boolean> {...base} rowClassName="flex-1 flex items-center gap-1.5" />))
      .toContain('class="flex-1 flex items-center gap-1.5"');
  });
});

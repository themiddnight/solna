import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { StepRow } from './StepRow';
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

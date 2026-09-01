import type { BassStepChoice } from '../../../audio/bassPatterns';

const BASS_STEP_CYCLE: BassStepChoice[] = ['rest', 'root', 'third', 'fifth', 'seventh', 'octave'];

/**
 * The next bass grid value for a click. Exported so the pure-logic tests can
 * pin the full cycle without a DOM.
 */
export function nextBassStepChoice(current: BassStepChoice): BassStepChoice {
  const idx = BASS_STEP_CYCLE.indexOf(current);
  return BASS_STEP_CYCLE[(idx + 1) % BASS_STEP_CYCLE.length];
}

/**
 * The short label shown on an active bass grid step. Exported for the same
 * reason as nextBassStepChoice.
 */
export function bassStepLabel(choice: BassStepChoice): string {
  switch (choice) {
    case 'root': return 'R';
    case 'third': return '3';
    case 'fifth': return '5';
    case 'seventh': return '7';
    case 'octave': return '8';
    case 'rest': return '';
  }
}

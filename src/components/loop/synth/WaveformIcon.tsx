import type { LfoWaveform, OscillatorWaveform } from '@/types/synth';

/**
 * One period of each waveform, drawn rather than abbreviated.
 *
 * The oscillator buttons used to read "sawt / squa / sine / tria" — the first
 * four letters of the value, which is the one part of the word that does not
 * distinguish "square" from anything and reads as a truncation bug. A shape is
 * what a synthesist actually recognises, so the button shows the shape and
 * carries the FULL name as its accessible name (`WAVEFORM_LABELS`), never the
 * truncation.
 *
 * `LfoWaveform` is a superset of `OscillatorWaveform` — it adds sample-and-hold
 * — so one table serves the oscillator row and the LFO row. Drawing two tables
 * would let the shared four drift apart between the two panels.
 */
export const WAVEFORM_LABELS: Record<LfoWaveform, string> = {
  sawtooth: 'Sawtooth',
  square: 'Square',
  triangle: 'Triangle',
  sine: 'Sine',
  'sample-and-hold': 'Sample and hold',
};

/** The oscillator row's four, in the approved prototype's order. */
export const OSCILLATOR_WAVEFORMS: readonly OscillatorWaveform[] = [
  'sawtooth',
  'square',
  'triangle',
  'sine',
];

/** The LFO row's five — the four above plus sample-and-hold. */
export const LFO_WAVEFORMS: readonly LfoWaveform[] = [...OSCILLATOR_WAVEFORMS, 'sample-and-hold'];

/** The path data per waveform, on a 32x16 viewBox. */
const WAVEFORM_PATHS: Record<LfoWaveform, string> = {
  sawtooth: 'M2 13 L10 3 L10 13 L18 3 L18 13 L26 3 L26 13 L30 8',
  square: 'M2 13 V3 H10 V13 H18 V3 H26 V13 H30',
  triangle: 'M2 13 L9 3 L16 13 L23 3 L30 13',
  sine: 'M2 8 C6 1 10 1 14 8 S22 15 30 8',
  'sample-and-hold': 'M2 11 H8 V5 H14 V13 H20 V7 H26 V10 H30',
};

/**
 * Decorative by construction: `aria-hidden`, because the button around it owns
 * the accessible name. An icon that named itself would make every button read
 * its label twice.
 */
export function WaveformIcon({ waveform }: { waveform: LfoWaveform }) {
  return (
    <svg
      viewBox="0 0 32 16"
      aria-hidden="true"
      className="w-7 h-3.5 overflow-visible fill-none stroke-current"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    >
      <path d={WAVEFORM_PATHS[waveform]} />
    </svg>
  );
}

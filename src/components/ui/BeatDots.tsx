import { groupBeats } from '../../utils/playhead';

export type BeatDotsTone = 'chord' | 'contrast';

export interface BeatDotsProps {
  /** Length of the counter in beats — a two-bar chord counts eight. */
  totalBeats: number;
  /** Beat currently sounding, 0-based; null when nothing is playing. */
  activeBeat: number | null;
  size?: 'sm' | 'md';
  /** `contrast` is for dots sitting on a filled module-chord surface. */
  tone?: BeatDotsTone;
  className?: string;
}

const DOT_SIZE = {
  sm: 'h-1 w-1',
  md: 'h-1.5 w-1.5',
} as const;

const BAR_GAP = {
  sm: 'gap-1.5',
  md: 'gap-2',
} as const;

const DOT_GAP = {
  sm: 'gap-0.5',
  md: 'gap-1',
} as const;

const TONE = {
  chord: { filled: 'bg-module-chord', empty: 'bg-base-content/20' },
  contrast: { filled: 'bg-module-chord-content', empty: 'bg-module-chord-content/30' },
} as const;

/**
 * Bar/beat position as dots, grouped by bar. Beats fill up as the chord plays
 * and clear on its next pass, so the row reads as progress through the chord
 * rather than a single moving marker.
 *
 * Shared by the Synth header and the chord cards, so it takes its position as
 * props and reads no store.
 */
export function BeatDots({
  totalBeats,
  activeBeat,
  size = 'md',
  tone = 'chord',
  className = '',
}: BeatDotsProps) {
  const bars = groupBeats(totalBeats);
  const colors = TONE[tone];
  const label =
    activeBeat === null ? `${totalBeats} beats` : `Beat ${activeBeat + 1} of ${totalBeats}`;

  return (
    <div
      role="img"
      aria-label={label}
      className={`flex items-center ${BAR_GAP[size]} ${className}`}
    >
      {bars.map((beats) => (
        <div key={beats[0]} className={`flex items-center ${DOT_GAP[size]}`}>
          {beats.map((beat) => (
            <span
              key={beat}
              className={`${DOT_SIZE[size]} rounded-full transition-colors ${
                activeBeat !== null && beat <= activeBeat ? colors.filled : colors.empty
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

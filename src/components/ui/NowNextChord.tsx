import { ArrowRight } from 'lucide-react';

export interface NowNextChordProps {
  /** Label of the chord currently sounding (or the one Play would start on). */
  now: string | null;
  /** Label of the chord queued after it; null when there is no distinct next. */
  next: string | null;
  className?: string;
}

/**
 * "Now -> next" chord readout. The sounding chord is the focal point; the next
 * one is deliberately smaller and dimmer so a glance lands on what is playing.
 * The next slot is dropped below `sm` — the Synth header row is tight there.
 */
export function NowNextChord({ now, next, className = '' }: NowNextChordProps) {
  if (!now) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Fixed-width slots: chord labels vary in length, and without them every
          label change would shove the beat dots sideways. */}
      <span className="w-20 text-center sm:text-right text-sm sm:text-base font-semibold text-module-chord truncate">
        {now}
      </span>
      {next && (
        <>
          <ArrowRight className="hidden sm:block h-3 w-3 shrink-0 text-base-content/40" />
          <span className="hidden sm:block w-16 text-left text-xs text-base-content/50 truncate">
            {next}
          </span>
        </>
      )}
    </div>
  );
}

import { Headphones } from 'lucide-react';
import { SOLO_TRACK_LABELS, type SoloTrack } from '@/store/trackAudibility';
import { IconButton } from './IconButton';
import { useLiveStore } from './useLiveStore';

export interface SoloButtonProps {
  track: SoloTrack;
  /** `xs` inside a module card header, `sm` on the Sound view's target row. */
  size?: 'xs' | 'sm';
  className?: string;
}

/**
 * The one track-solo control, rendered at all six placements (spec §4): Sound's
 * target row, Pattern › Lead's header, the chord/bass/pad rows, and Pattern ›
 * Beat's header. The mixer deliberately has none.
 *
 * It only WRITES the ui slice. Effective audibility is computed in
 * store/engineSync.ts and nowhere else — src/components/ may not import
 * audio/engine, and a second copy of the formula in a view is how the two would
 * drift.
 *
 * Reads through useLiveStore, not useAppStore: roughly a third of this suite
 * renders through renderToString, where zustand serves creation-time state as
 * the server snapshot and a test's setState would silently not apply (see
 * .claude/rules/testing.md).
 *
 * A headphones icon rather than a bare "S": IconButton requires an icon and
 * gives the button its accessible name, and "listen to this alone" is what the
 * control means. `btn-primary` when active rather than a new colour role — it
 * is the same active-toggle look the mode switcher and the metronome already
 * use, and IconButton's variant union is closed on purpose.
 */
export function SoloButton({ track, size = 'xs', className }: SoloButtonProps) {
  const active = useLiveStore((s) => s.soloTracks.includes(track));
  const toggleSoloTrack = useLiveStore((s) => s.toggleSoloTrack);
  const label = SOLO_TRACK_LABELS[track];
  return (
    <IconButton
      id={`btn-solo-${track}`}
      label={active ? `Un-solo ${label}` : `Solo ${label}`}
      icon={<Headphones className="w-3.5 h-3.5" />}
      size={size}
      variant={active ? 'primary' : 'outline'}
      aria-pressed={active}
      className={className}
      onClick={() => toggleSoloTrack(track)}
    />
  );
}

import { LocateFixed, LocateOff } from 'lucide-react';
import type { Layer } from '@/types';
import { useLiveStore } from '@/components/ui/useLiveStore';
import { IconButton } from '@/components/ui/IconButton';

/**
 * Arrange's follow-the-playhead toggle. Song layer only — it is the same
 * `layer !== 'song'` gate `ProjectNameLabel` uses, and for the same reason it
 * sits beside it: the control belongs to what the song tabs are editing, not
 * to the tabs.
 *
 * Deliberately shown on BOTH song tabs rather than only on Arrange. It is a
 * stored preference, so setting it from Master FX is meaningful, and gating it
 * on the tab would shift the tab row sideways every time the user crossed
 * between the two — moving the buttons out from under the pointer that is
 * clicking them.
 *
 * Takes `layer` as a prop for the same testability reason ProjectNameLabel
 * does: a rendered `<Header />` can never reach the song layer under
 * `renderToString` (see .claude/rules/testing.md).
 */
export function FollowPlayheadToggle({ layer }: { layer: Layer }) {
  // useLiveStore, not a plain useAppStore selector: this component is rendered
  // standalone in the suite and a plain selector would serve the store's
  // creation-time value under renderToString, making the "off" state
  // untestable (see ui/useLiveStore.ts and .claude/rules/testing.md).
  const followPlayhead = useLiveStore((s) => s.followPlayhead);
  const toggleFollowPlayhead = useLiveStore((s) => s.toggleFollowPlayhead);
  if (layer !== 'song') return null;
  return (
    <IconButton
      id="btn-follow-playhead"
      label={followPlayhead ? 'Following the playing loop — click to stop' : 'Follow the playing loop'}
      aria-pressed={followPlayhead}
      active={followPlayhead}
      icon={
        followPlayhead ? (
          <LocateFixed className="w-4 h-4 text-primary" />
        ) : (
          <LocateOff className="w-4 h-4 opacity-60" />
        )
      }
      onClick={toggleFollowPlayhead}
    />
  );
}

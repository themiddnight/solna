import { LocateFixed, LocateOff } from 'lucide-react';
import { useLiveStore } from '@/components/ui/useLiveStore';
import { IconButton } from '@/components/ui/IconButton';
import { MenuRowButton, type ToolVariantProps } from '@/components/ui/MenuRowButton';

/**
 * Arrange's follow-the-playhead toggle. Song layer only, like
 * `ProjectNameLabel`, through its `HEADER_TOOLS` row.
 *
 * Deliberately shown on BOTH song tabs rather than only on Arrange. It is a
 * stored preference, so setting it from Master FX is meaningful, and gating it
 * on the tab would shift the tab row sideways every time the user crossed
 * between the two — moving the buttons out from under the pointer that is
 * clicking them.
 */
export function FollowPlayheadToggle({ variant = 'bar' }: ToolVariantProps) {
  // useLiveStore, not a plain useAppStore selector: this component is rendered
  // standalone in the suite and a plain selector would serve the store's
  // creation-time value under renderToString, making the "off" state
  // untestable (see ui/useLiveStore.ts and .claude/rules/testing.md).
  const followPlayhead = useLiveStore((s) => s.followPlayhead);
  const toggleFollowPlayhead = useLiveStore((s) => s.toggleFollowPlayhead);
  const icon = followPlayhead ? (
    <LocateFixed className="w-4 h-4 text-primary" />
  ) : (
    <LocateOff className="w-4 h-4 opacity-60" />
  );
  if (variant === 'row') {
    // A toggle's name stays fixed; aria-pressed carries the state.
    return (
      <MenuRowButton id="btn-follow-playhead" icon={icon} label="Follow the playing loop"
        aria-pressed={followPlayhead} className={followPlayhead ? 'btn-active' : undefined}
        onClick={toggleFollowPlayhead} />
    );
  }
  return (
    <IconButton
      id="btn-follow-playhead"
      label={followPlayhead ? 'Following the playing loop — click to stop' : 'Follow the playing loop'}
      aria-pressed={followPlayhead}
      active={followPlayhead}
      icon={icon}
      onClick={toggleFollowPlayhead}
    />
  );
}

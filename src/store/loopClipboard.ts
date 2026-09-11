import type { LoopCopyGroupId } from './loopCopy';
import { useAppStore } from './store';

/**
 * The groups actually applied by a paste, plus the key implication. A chord
 * progression always carries `key`: the push model learns the target only at
 * paste time, and pasting absolute-root chords into a different key without
 * the key would leave the loop broken.
 */
export function pasteGroupsFor(groups: readonly LoopCopyGroupId[]): LoopCopyGroupId[] {
  return groups.includes('chord-progression') && !groups.includes('key')
    ? [...groups, 'key']
    : [...groups];
}

/** Remember the active loop as the copy source ("copy all"). No-op with no active loop. */
export function copyLoopSection(): void {
  const s = useAppStore.getState();
  const active = s.loops.find((loop) => loop.id === s.activeLoopId);
  if (!active) return;
  s.setLoopClipboard({ sourceLoopId: active.id });
}

/** Paste the buffered source's `groups` into the active loop. No-op on an empty
 *  buffer, a self-paste, or a source that no longer exists (the buffer is then
 *  cleared). */
export function pasteLoopSection(groups: readonly LoopCopyGroupId[]): void {
  const s = useAppStore.getState();
  const clip = s.loopClipboard;
  if (!clip || clip.sourceLoopId === s.activeLoopId) return;
  if (!s.loops.some((loop) => loop.id === clip.sourceLoopId)) {
    s.clearLoopClipboard();
    return;
  }
  s.applyLoopCopy(s.activeLoopId, clip.sourceLoopId, pasteGroupsFor(groups));
}

/**
 * The two vibe actions, in their own module so InstantVibesBar can defer the
 * whole dependency tree behind a dynamic import().
 *
 * Both stay SYNCHRONOUS and keep their exact signatures: the async boundary is
 * the module load in the click handler, not these functions, so
 * InstantVibesBar.test.tsx exercises them the same way it always did.
 */
import { applyInstantVibeToStore } from '../store/instantVibes';
import type { InstantVibe } from '../types';
import { useAppStore } from '../store/store';
import {
  createDraw,
  formatVariationSummary,
  resolveVibeVariation,
  type RerollToast,
} from '../store/vibeVariation';

export function selectVibe(
  vibe: InstantVibe,
  deps: { onToast: (text: string) => void }
): void {
  applyInstantVibeToStore(vibe);
  deps.onToast(`Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${vibe.scaleRoot} ${vibe.scaleType})`);
}

/**
 * Rerolls the loaded vibe into a different piece of music in the same genre.
 *
 * The ONLY place this feature calls Math.random: everything below
 * resolveVibeVariation takes the VibeDraw this creates, which is what makes the
 * draw policy testable by enumeration.
 *
 * Applies through the same applyInstantVibeToStore a chip click uses. That is
 * deliberate and load-bearing: the synchronous
 * audioEngine.stopSource('chord'|'bass', 0.02) cut, the selective restart and
 * the bar-grid rewind all live in there, and a second apply path would have to
 * keep them in sync. This function makes no engine call of its own.
 */
export function rerollVibe(
  vibe: InstantVibe,
  deps: { onToast: (toast: RerollToast) => void }
): void {
  const { scaleRoot, chordRhythmId, bassPatternId } = useAppStore.getState();
  const result = resolveVibeVariation(
    vibe,
    { scaleRoot, chordRhythmId, bassPatternId },
    createDraw(Math.random),
  );
  applyInstantVibeToStore(result.vibe);
  deps.onToast(formatVariationSummary(result.summary));
}

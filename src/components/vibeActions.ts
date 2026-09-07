/**
 * The two vibe actions, in their own module so InstantVibesBar can defer the
 * whole dependency tree behind a dynamic import().
 *
 * Both stay SYNCHRONOUS and keep their exact signatures: the async boundary is
 * the module load in the click handler, not these functions, so
 * InstantVibesBar.test.tsx exercises them the same way it always did.
 */
import type { VibeSpec } from '../data/vibes';
import { applyVibeToStore, resolveVibe } from '../store/vibes';
import { useAppStore } from '../store/store';
import {
  createDraw,
  formatVariationSummary,
  resolveVibeVariation,
  type RerollToast,
} from '../store/vibeVariation';

export function selectVibe(
  vibe: VibeSpec,
  deps: { onToast: (text: string) => void }
): void {
  applyVibeToStore(resolveVibe(vibe));
  deps.onToast(`Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${vibe.scaleRoot} ${vibe.scaleType})`);
}

/**
 * Rerolls the loaded vibe into a different piece of music in the same genre.
 *
 * The ONLY place this feature calls Math.random: everything below
 * resolveVibeVariation takes the VibeDraw this creates, which is what makes the
 * draw policy testable by enumeration.
 *
 * Resolves through the same resolveVibe and applies through the same
 * applyVibeToStore a chip click uses. Both are deliberate and load-bearing: the
 * reroll draws IDS, so the drawn spec becomes sound down the one resolver every
 * vibe goes through, and the synchronous
 * audioEngine.stopSource('chord'|'bass'|'pad', 0.02) cut, the selective restart and
 * the bar-grid rewind all live in applyVibeToStore, which a second apply path
 * would have to keep in sync. This function makes no engine call of its own.
 */
export function rerollVibe(
  vibe: VibeSpec,
  deps: { onToast: (toast: RerollToast) => void }
): void {
  const { scaleRoot, chordRhythmId, bassPatternId } = useAppStore.getState();
  const { spec, summary } = resolveVibeVariation(
    vibe,
    { scaleRoot, chordRhythmId, bassPatternId },
    createDraw(Math.random),
  );
  applyVibeToStore(resolveVibe(spec));
  deps.onToast(formatVariationSummary(summary));
}

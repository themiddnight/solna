/**
 * The two vibe actions, in their own module so InstantVibesBar can defer the
 * whole dependency tree behind a dynamic import().
 *
 * Both stay SYNCHRONOUS: the async boundary is the module load in the click
 * handler, not these functions, so InstantVibesBar.test.tsx calls them directly.
 * Each confirms itself through `showFeedback` under the one key `vibe`, so a
 * reroll replaces the load toast it follows (R330).
 */
import type { VibeSpec } from '../data/vibes';
import { applyVibeToStore, resolveVibe } from '../store/vibes';
import { useAppStore } from '../store/store';
import { formatKeyLabel } from '@/utils/noteSpelling';
import {
  createDraw,
  formatVariationSummary,
  resolveVibeVariation,
} from '../store/vibeVariation';

/** A reroll's summary has more to read than a load's one line, so it stays longer. */
const REROLL_TOAST_MS = 4000;

export function selectVibe(vibe: VibeSpec): void {
  applyVibeToStore(resolveVibe(vibe));
  useAppStore.getState().showFeedback({
    key: 'vibe',
    message: `Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${formatKeyLabel(vibe.scaleRoot, vibe.scaleType)})`,
    tone: 'success',
  });
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
export function rerollVibe(vibe: VibeSpec): void {
  const { scaleRoot, chordRhythmId, bassPatternId } = useAppStore.getState();
  const { spec, summary } = resolveVibeVariation(
    vibe,
    { scaleRoot, chordRhythmId, bassPatternId },
    createDraw(Math.random),
  );
  applyVibeToStore(resolveVibe(spec));
  const { headline, detail } = formatVariationSummary(summary);
  // A different tone from the load toast, so a reroll and a load read apart.
  useAppStore.getState().showFeedback({
    key: 'vibe',
    message: headline,
    detail,
    tone: 'info',
    durationMs: REROLL_TOAST_MS,
  });
}

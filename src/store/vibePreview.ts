/**
 * The vibe picker's commands (R337). A vibe is auditioned on the current loop
 * and kept only on Use; Cancel writes the snapshot back in one set (R338).
 *
 * Loaded on demand by components/vibes/useVibePicker.ts: this module reaches
 * the engine and the four library resolvers, none of which the eager bundle
 * needs (R095).
 *
 * Every command starts with the same stop + cut: hardStopAll alone does not
 * silence voices already queued on the audio clock, so the accompaniment
 * sources are cut synchronously, BEFORE any write. The picker never restarts
 * what was playing: opening and closing both leave the transport stopped, and
 * a preview plays the active loop alone (soloLoop), never the song.
 */
import type { VibeSpec } from '../data/vibes';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import { holdPersistedWrites, releasePersistedWrites, useAppStore } from './store';
import type { AppStore } from './types';
import { captureVibeTargets, resolveVibe, resolveVibeVoices, vibeContentPatch, withMirror } from './vibes';
import { createDraw, formatVariationSummary, resolveVibeVariation, summarizeVibe } from './vibeVariation';

/** Same instant-but-clickless release the hard-stop button uses. */
const VIBE_SWAP_RELEASE = 0.02;

function stopAndCut(): void {
  useAppStore.getState().hardStopAll();
  for (const source of ACCOMPANIMENT_SOURCES) audioEngine.stopSource(source, VIBE_SWAP_RELEASE);
}

function playActiveLoop(): void {
  const { soloLoop, activeLoopId } = useAppStore.getState();
  soloLoop(activeLoopId);
}

function endPreview(): void {
  releasePersistedWrites();
  useAppStore.getState().setNoteInputSuspended(false);
}

/**
 * Open: disk keeps the pre-preview state (R335), input goes quiet (R336), the
 * transport stops. An open that throws undoes itself before rethrowing, so a
 * failed open never leaves writes held or input suspended.
 */
export function beginVibePreview(): Partial<AppStore> {
  holdPersistedWrites();
  try {
    useAppStore.getState().setNoteInputSuspended(true);
    stopAndCut();
    return captureVibeTargets(useAppStore.getState());
  } catch (error) {
    endPreview();
    throw error;
  }
}

/**
 * Audition `spec`: everything resolved before any state is touched, then one
 * write, then play. Returns the detail line the picker shows under the name.
 */
export function previewVibe(spec: VibeSpec): string {
  const vibe = resolveVibe(spec);
  const voices = resolveVibeVoices(vibe);
  stopAndCut();
  useAppStore.setState((s) => withMirror(s, vibeContentPatch(s, vibe, voices)));
  playActiveLoop();
  return formatVariationSummary(summarizeVibe(spec)).detail;
}

/**
 * Reroll `base` into a different piece in the same genre and audition it.
 * The ONLY Math.random call of the feature: everything below takes the draw.
 */
export function rerollPreview(base: VibeSpec): { spec: VibeSpec; headline: string; detail: string } {
  const { scaleRoot, chordRhythmId, bassPatternId } = useAppStore.getState();
  const { spec, summary } = resolveVibeVariation(
    base,
    { scaleRoot, chordRhythmId, bassPatternId },
    createDraw(Math.random),
  );
  previewVibe(spec);
  return { spec, ...formatVariationSummary(summary) };
}

/** Play what is in the store now — never re-applies, so a rerolled variant survives. Idempotent. */
export function playPreview(): void {
  stopAndCut();
  playActiveLoop();
}

export function stopPreview(): void {
  stopAndCut();
}

/** Use: keep what the store holds. */
export function commitVibePreview(): void {
  stopAndCut();
  endPreview();
}

/** Cancel (and Esc, ✕, the backdrop, unmount): the snapshot back in one write. */
export function cancelVibePreview(snapshot: Partial<AppStore>): void {
  stopAndCut();
  useAppStore.setState((s) => withMirror(s, snapshot));
  endPreview();
}

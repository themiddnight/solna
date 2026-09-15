import type { AudioEngine } from './engine';
import type { BeatParams } from '@/types';

/**
 * The one hop from a Beat patch to the drum DSP.
 *
 * It exists so that "install this Beat" is a single call with a single
 * definition of what installing means, wherever it happens: the live bridge
 * (`store/engineSync.ts`), the transient preview (`store/beatPreview.ts`) and
 * the offline mixdown (`audio/export/renderMixdown.ts`) all route through
 * here. Before this, the live path installed a kit by NAME and the export
 * installed one kit for the whole arrangement, and the two could not be
 * compared because they were not the same call.
 *
 * It is in `src/audio/` and takes the engine as an ARGUMENT, so the offline
 * render can apply a patch to its throwaway engine without reaching for the
 * singleton, and so nothing here has to know the store exists.
 *
 * `time` is passed straight through: the live callers omit it and mean "now",
 * while the render's pass boundary supplies an absolute offline time. Nothing
 * here computes one — every scheduled time is an argument.
 */
export function applyBeatParams(engine: AudioEngine, params: BeatParams, time?: number): void {
  engine.setDrumKit(params.voices, params.outputTrimDb);
  engine.setBeatFilter(params.filter.cutoff, params.filter.resonance, params.filter.type, time);
}

import { LFO } from "tone";
import type { Filter, InputNode } from "tone";

import type { SynthState } from "../shared/types";
import { SynthParamManager } from "./SynthParamManager";
import type { ToneSynthInstance } from "./SynthFactory";

/**
 * Square-wave amplitude compensation. A square LFO spends all its time at the extremes rather
 * than sweeping through them, so it reads as a narrower modulation than the same min/max on a
 * sine; widening the range by this factor makes the perceived depth match.
 */
const SQUARE_RANGE_COMPENSATION = 1.18;

/**
 * Owns the synth's single optional modulation LFO: creating it on demand, retargeting it when
 * `lfoTarget` changes, and disposing it whenever modulation is switched off (`lfoAmount <= 0`)
 * or the surrounding synth chain is torn down.
 *
 * Split out of SynthEngine so the engine file stays under the TR-20 logic-file cap; the LFO is
 * the most self-contained part of the chain (it owns exactly one node and reads the rest of the
 * chain only as inputs).
 */
export class SynthLfoController {
  private lfoRef: LFO | null = null;

  /**
   * Reconciles the LFO against the current synth state — creates, retargets, retunes, or
   * disposes it as needed. Safe to call on every param update.
   */
  update(
    state: SynthState,
    synthRef: ToneSynthInstance | null,
    filterRef: Filter | null,
  ): void {
    if (!synthRef || state.lfoAmount <= 0) {
      this.dispose();
      return;
    }

    const targetParam: unknown = SynthParamManager.getLfoTargetParam(state, synthRef, filterRef);
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!targetParam) {
      this.dispose();
      return;
    }

    const { min, max } = SynthParamManager.getLfoRange(state);
    const lfoFreq = state.lfoSync
      ? SynthParamManager.subdivisionToHz(state.lfoSyncSubdivision)
      : state.lfoFrequency;

    let effMin = min;
    let effMax = max;
    if (state.lfoWaveform === "square") {
      const range = max - min;
      const center = min + range / 2;
      const newRange = range * SQUARE_RANGE_COMPENSATION;
      effMin = center - newRange / 2;
      effMax = center + newRange / 2;
    }

    if (!this.lfoRef) {
      this.lfoRef = new LFO({
        min: effMin,
        max: effMax,
        type: state.lfoWaveform as LFO["type"],
        frequency: lfoFreq,
      });
      this.lfoRef.connect(targetParam as InputNode);
      this.lfoRef.start();
      return;
    }

    this.lfoRef.min = effMin;
    this.lfoRef.max = effMax;
    this.lfoRef.type = state.lfoWaveform as LFO["type"];
    this.lfoRef.frequency.value = lfoFreq;

    try {
      this.lfoRef.disconnect();
    } catch {
      /* ignore */
    }
    this.lfoRef.connect(targetParam as InputNode);

    if (this.lfoRef.state !== "started") this.lfoRef.start();
  }

  /** Retunes a tempo-synced LFO after a BPM change. No-op when sync is off or no LFO exists. */
  syncToTempo(state: SynthState): void {
    if (!state.lfoSync || !this.lfoRef) return;
    this.lfoRef.frequency.value = SynthParamManager.subdivisionToHz(state.lfoSyncSubdivision);
  }

  dispose(): void {
    if (this.lfoRef) {
      try {
        this.lfoRef.stop();
        this.lfoRef.dispose();
      } catch {
        /* ignore */
      }
    }
    this.lfoRef = null;
  }
}

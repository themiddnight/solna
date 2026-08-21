import type { Filter} from "tone";
import { PolySynth, getTransport } from "tone";
import type { SynthState } from "../shared/types";

// Tone.js dynamic object shape — avoids `any` for internal property access
interface ToneSynth {
  portamento?: number;
  detune?: { value: number };
  oscillator?: { type?: string; detune?: { value: number } };
  envelope?: { attack?: number; decay?: number; sustain?: number; release?: number };
  modulationIndex?: { value: number };
  harmonicity?: { value: number };
  modulationEnvelope?: { attack?: number; decay?: number; sustain?: number; release?: number };
  voices?: ToneSynth[];
  set?: (params: Record<string, unknown>) => void;
}

export class SynthParamManager {
  /**
   * Applies portamento glide to single synth voice or multiple polyphonic voices.
   */
  static applyPortamento(synth: unknown, value: number): void {
    if (synth === null || synth === undefined) return;
    try {
      if (synth instanceof PolySynth) {
        const p = synth as unknown as { voices?: { portamento?: number }[]; set(params: Record<string, unknown>): void };
        if (p.voices && Array.isArray(p.voices)) {
          p.voices.forEach((v) => {
            if (typeof v.portamento === "number") v.portamento = value;
          });
        }
        if (typeof p.set === "function") {
          p.set({ portamento: value });
        }
      } else {
        const s = synth as { portamento?: number };
        if (typeof s.portamento === "number") s.portamento = value;
      }
    } catch {
      console.warn("[SynthParamManager] Failed to apply portamento");
    }
  }

  /**
   * Converts a musical subdivision string (e.g. '8n', '4n.', '16nt') to cycles in Hertz based on current BPM.
   */
  static subdivisionToHz(subdivision: string): number {
    try {
      const bpm = getTransport().bpm.value;
      const beatsPerSecond = bpm / 60;
      let baseValue: number;
      let multiplier = 1;

      if (subdivision.endsWith(".")) {
        multiplier = 1.5;
        subdivision = subdivision.slice(0, -1);
      } else if (subdivision.endsWith("t")) {
        multiplier = 2 / 3;
        subdivision = subdivision.slice(0, -1);
      }

      if (subdivision.endsWith("m")) {
        const parsedBars = parseInt(subdivision.slice(0, -1), 10);
        const bars = Number.isFinite(parsedBars) ? parsedBars : 1;
        baseValue = bars * 4;
      } else if (subdivision.endsWith("n")) {
        const parsedNote = parseInt(subdivision.slice(0, -1), 10);
        const noteVal = Number.isFinite(parsedNote) ? parsedNote : 4;
        baseValue = 4 / noteVal;
      } else {
        baseValue = 1;
      }

      return (beatsPerSecond / baseValue) * multiplier;
    } catch {
      return 5; // Default safe frequency fallback
    }
  }

  /**
   * Resolves the target AudioParam for LFO modulation depending on selected modulation target (pitch vs filter).
   */
  static getLfoTargetParam(
    state: SynthState,
    synthInput: unknown,
    filter: Filter | null,
  ): unknown {
    const synth = synthInput as ToneSynth | null;
    if (!synth) return null;
    if (state.lfoTarget === "pitch") {
      if (synth.detune) return synth.detune;
      if (synth.oscillator?.detune)
        return synth.oscillator.detune;
      return null;
    }
    if (filter) return filter.frequency;
    return null;
  }

  /**
   * Resolves LFO modulation depth ranges depending on current filter frequency and target parameters.
   */
  static getLfoRange(state: SynthState): { min: number; max: number } {
    if (state.lfoTarget === "pitch") {
      const depth = Math.max(0, Math.min(3600, state.lfoAmount));
      return { min: 0, max: depth };
    }
    const baseFreq = state.filterFrequency;
    const amount = Math.max(0, Math.min(20000, state.lfoAmount));
    return { min: baseFreq, max: Math.min(20000, baseFreq + amount) };
  }

  /**
   * Updates standard parameters on a single synth voice.
   */
  static updateVoiceParams(voice: ToneSynth | null, params: Partial<SynthState>): void {
    if (!voice) return;
    try {
      if (
        params.oscillatorType &&
        voice.oscillator &&
        params.oscillatorType !== "noise"
      ) {
        voice.oscillator.type = params.oscillatorType.toLowerCase();
      }
      if (voice.envelope) {
        if (params.ampAttack !== undefined)
          voice.envelope.attack = params.ampAttack;
        if (params.ampDecay !== undefined)
          voice.envelope.decay = params.ampDecay;
        if (params.ampSustain !== undefined)
          voice.envelope.sustain = params.ampSustain;
        if (params.ampRelease !== undefined)
          voice.envelope.release = params.ampRelease;
      }
      if (params.modulationIndex !== undefined && voice.modulationIndex) {
        voice.modulationIndex.value = params.modulationIndex;
      }
      if (params.harmonicity !== undefined && voice.harmonicity) {
        voice.harmonicity.value = params.harmonicity;
      }
      if (voice.modulationEnvelope) {
        if (params.modAttack !== undefined)
          voice.modulationEnvelope.attack = params.modAttack;
        if (params.modDecay !== undefined)
          voice.modulationEnvelope.decay = params.modDecay;
        if (params.modSustain !== undefined)
          voice.modulationEnvelope.sustain = params.modSustain;
        if (params.modRelease !== undefined)
          voice.modulationEnvelope.release = params.modRelease;
      }
    } catch {
      // Ignore individual parameter errors
    }
  }

  /**
   * Updates multiple parameters on PolySynth.
   */
  static updatePolySynthParams(synthInput: unknown, params: Partial<SynthState>): void {
    const synth = synthInput as ToneSynth | null;
    if (!synth) return;
    try {
      const updates: Record<string, unknown> = {};
      if (params.oscillatorType && params.oscillatorType !== "noise") {
        updates.oscillator = { type: params.oscillatorType.toLowerCase() };
      }

      const env: Record<string, unknown> = {};
      if (params.ampAttack !== undefined) env.attack = params.ampAttack;
      if (params.ampDecay !== undefined) env.decay = params.ampDecay;
      if (params.ampSustain !== undefined) env.sustain = params.ampSustain;
      if (params.ampRelease !== undefined) env.release = params.ampRelease;
      if (Object.keys(env).length > 0) updates.envelope = env;

      if (params.modulationIndex !== undefined) {
        updates.modulationIndex = params.modulationIndex;
      }
      if (params.harmonicity !== undefined) {
        updates.harmonicity = params.harmonicity;
      }

      const modEnv: Record<string, unknown> = {};
      if (params.modAttack !== undefined) modEnv.attack = params.modAttack;
      if (params.modDecay !== undefined) modEnv.decay = params.modDecay;
      if (params.modSustain !== undefined) modEnv.sustain = params.modSustain;
      if (params.modRelease !== undefined) modEnv.release = params.modRelease;
      if (Object.keys(modEnv).length > 0) updates.modulationEnvelope = modEnv;

      if (Object.keys(updates).length > 0) {
        synth.set?.(updates);
      }

      if (synth.voices && Array.isArray(synth.voices)) {
        synth.voices.forEach((v) => this.updateVoiceParams(v, params));
      }
    } catch {
      // Ignore poly synth updates error
    }
  }

  /**
   * Updates standard parameters on MonoSynth or FMSynth.
   */
  static updateMonoSynthParams(synthInput: unknown, params: Partial<SynthState>): void {
    const synth = synthInput as ToneSynth | null;
    if (!synth) return;
    try {
      if (
        params.oscillatorType &&
        synth.oscillator &&
        params.oscillatorType !== "noise"
      ) {
        synth.oscillator.type = params.oscillatorType.toLowerCase();
      }
      if (synth.envelope) {
        if (params.ampAttack !== undefined)
          synth.envelope.attack = params.ampAttack;
        if (params.ampDecay !== undefined)
          synth.envelope.decay = params.ampDecay;
        if (params.ampSustain !== undefined)
          synth.envelope.sustain = params.ampSustain;
        if (params.ampRelease !== undefined)
          synth.envelope.release = params.ampRelease;
      }
      if (params.modulationIndex !== undefined && synth.modulationIndex) {
        synth.modulationIndex.value = params.modulationIndex;
      }
      if (params.harmonicity !== undefined && synth.harmonicity) {
        synth.harmonicity.value = params.harmonicity;
      }
      if (synth.modulationEnvelope) {
        if (params.modAttack !== undefined)
          synth.modulationEnvelope.attack = params.modAttack;
        if (params.modDecay !== undefined)
          synth.modulationEnvelope.decay = params.modDecay;
        if (params.modSustain !== undefined)
          synth.modulationEnvelope.sustain = params.modSustain;
        if (params.modRelease !== undefined)
          synth.modulationEnvelope.release = params.modRelease;
      }
    } catch {
      // Ignore mono synth updates error
    }
  }
}

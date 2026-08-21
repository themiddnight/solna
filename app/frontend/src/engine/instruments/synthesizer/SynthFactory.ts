import { Synth, FMSynth, NoiseSynth, PolySynth } from "tone";
import { APP_MAX_POLYPHONY } from "@/engine/audio";
import type { SynthState } from "../shared/types";

/**
 * The concrete Tone.js synth instances this engine builds. Modeled as a union
 * of the real Tone classes (not a hand-rolled structural interface) so every
 * instance assigns without a cast and `instanceof` narrows to the exact voice
 * shape — mono voices (Synth/FMSynth) expose `setNote` and a note-less
 * `triggerRelease(time?)`, while PolySynth's `triggerRelease(notes, time?)`
 * takes the note. Narrow before calling voice-specific methods.
 */
export type ToneSynthInstance = Synth | FMSynth | NoiseSynth | PolySynth;

export function isNoiseOscillator(type?: string): boolean {
  return type === "noise";
}

export function createSynthesizer(
  instrumentName: string,
  synthState: SynthState,
): ToneSynthInstance {
  const requestedOscillator = synthState.oscillatorType;
  const isNoiseOsc = isNoiseOscillator(requestedOscillator);
  const safeOscillatorType = isNoiseOsc ? "sawtooth" : requestedOscillator;

  const commonEnvelope = {
    attack: synthState.ampAttack,
    decay: synthState.ampDecay,
    sustain: synthState.ampSustain,
    release: synthState.ampRelease,
  };

  const commonOscillator = { type: safeOscillatorType };

  switch (instrumentName) {
    case "analog_mono":
    case "analog_bass":
    case "analog_lead":
      if (isNoiseOsc) {
        return new NoiseSynth({
          envelope: commonEnvelope,
          noise: { type: "white" },
        });
      }
      return new Synth({
        oscillator: commonOscillator as Record<string, unknown>,
        envelope: commonEnvelope,
      });

    case "analog_poly": {
      const polySynth = new PolySynth(Synth, {
        oscillator: commonOscillator as Record<string, unknown>,
        envelope: commonEnvelope,
      });
      polySynth.maxPolyphony = APP_MAX_POLYPHONY;
      return polySynth;
    }

    case "fm_mono":
      return new FMSynth({
        harmonicity: synthState.harmonicity,
        modulationIndex: synthState.modulationIndex,
        envelope: commonEnvelope,
        modulation: { type: "sine" },
        modulationEnvelope: {
          attack: synthState.modAttack,
          decay: synthState.modDecay,
          sustain: synthState.modSustain,
          release: synthState.modRelease,
        },
      });

    case "fm_poly": {
      const fmPolySynth = new PolySynth(FMSynth, {
        harmonicity: synthState.harmonicity,
        modulationIndex: synthState.modulationIndex,
        envelope: commonEnvelope,
        modulation: { type: "sine" },
        modulationEnvelope: {
          attack: synthState.modAttack,
          decay: synthState.modDecay,
          sustain: synthState.modSustain,
          release: synthState.modRelease,
        },
      });
      fmPolySynth.maxPolyphony = APP_MAX_POLYPHONY;
      return fmPolySynth;
    }

    default:
      return new Synth({ envelope: commonEnvelope });
  }
}

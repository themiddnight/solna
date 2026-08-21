/**
 * EffectsFactory — Creates and manages audio effect instances.
 * Extracted from effectsArchitecture.ts for maintainability.
 * Import via effectsArchitecture.ts for backward compatibility.
 */
import { setContext, start } from "tone";
import { EFFECT_TYPE } from "./audioEffectTypes";
import type { AudioEffect, EffectType } from "./audioEffectTypes";

import { createReverbEffect } from "./effects/ReverbEffect";
import { createDelayEffect } from "./effects/DelayEffect";
import { createCompressorEffect } from "./effects/CompressorEffect";
import { createFilterEffect } from "./effects/FilterEffect";
import { createAutoFilterEffect } from "./effects/AutoFilterEffect";
import { createAutoPannerEffect } from "./effects/AutoPannerEffect";
import { createAutoWahEffect } from "./effects/AutoWahEffect";
import { createBitCrusherEffect } from "./effects/BitCrusherEffect";
import { createChorusEffect } from "./effects/ChorusEffect";
import { createDistortionEffect } from "./effects/DistortionEffect";
import { createPhaserEffect } from "./effects/PhaserEffect";
import { createPingPongDelayEffect } from "./effects/PingPongDelayEffect";
import { createStereoWidenerEffect } from "./effects/StereoWidenerEffect";
import { createTremoloEffect } from "./effects/TremoloEffect";
import { createVibratoEffect } from "./effects/VibratoEffect";
import { createGraphicEQEffect } from "./effects/GraphicEQEffect";
import { createAutotuneEffect } from "./effects/AutotuneEffect";
import { createVocoderEffect } from "./effects/VocoderEffect";
import { createDuckerEffect } from "./effects/DuckerEffect";
import { createVocoderExtEffect } from "./effects/VocoderExtEffect";

export class EffectsFactory {
  private static context: AudioContext | null = null;
  private static isInitialized = false;

  static async initialize(audioContext: AudioContext): Promise<void> {
    // Skip re-initialization when the same context is already set up —
    // `setContext` is synchronous and Tone.start() only needs to run once.
    // Without this guard every MixerEngine constructor triggers a duplicate
    // 100ms timeout + Tone.start() on the fire-and-forget initializeAsync path.
    if (this.isInitialized && this.context === audioContext) return;

    this.context = audioContext;
    // Ensure Tone uses the same AudioContext so nodes interconnect seamlessly
    try {
      setContext(audioContext);
      // Start Tone.js to enable all Tone effects
      await start();
      this.isInitialized = true;
    } catch {
      // ignore
    }
  }

  /**
   * Create a new effect instance
   */
  static createEffect(type: EffectType, id?: string): AudioEffect | null {
    if (!this.context) return null;

    // Create new effect
    switch (type) {
      case EFFECT_TYPE.REVERB:
        return createReverbEffect(this.context, id);
      case EFFECT_TYPE.DELAY:
        return createDelayEffect(this.context, id);
      case EFFECT_TYPE.COMPRESSOR:
        return createCompressorEffect(this.context, id);
      case EFFECT_TYPE.FILTER:
        return createFilterEffect(this.context, id);
      case EFFECT_TYPE.AUTOFILTER:
        return createAutoFilterEffect(this.context, id);
      case EFFECT_TYPE.AUTOPANNER:
        return createAutoPannerEffect(this.context, id);
      case EFFECT_TYPE.AUTOWAH:
        return createAutoWahEffect(this.context, id);
      case EFFECT_TYPE.BITCRUSHER:
        return createBitCrusherEffect(this.context, id);
      case EFFECT_TYPE.CHORUS:
        return createChorusEffect(this.context, id);
      case EFFECT_TYPE.DISTORTION:
        return createDistortionEffect(this.context, id);
      case EFFECT_TYPE.PHASER:
        return createPhaserEffect(this.context, id);
      case EFFECT_TYPE.PINGPONGDELAY:
        return createPingPongDelayEffect(this.context, id);
      case EFFECT_TYPE.STEREOWIDENER:
        return createStereoWidenerEffect(this.context, id);
      case EFFECT_TYPE.TREMOLO:
        return createTremoloEffect(this.context, id);
      case EFFECT_TYPE.VIBRATO:
        return createVibratoEffect(this.context, id);
      case EFFECT_TYPE.GRAPHICEQ:
        return createGraphicEQEffect(this.context, id);
      case EFFECT_TYPE.AUTOTUNE:
        return createAutotuneEffect(this.context, id);
      case EFFECT_TYPE.VOCODER:
        return createVocoderEffect(this.context, id);
      case EFFECT_TYPE.DUCKER:
        return createDuckerEffect(this.context, id);
      case EFFECT_TYPE.VOCODEREXT:
        return createVocoderExtEffect(this.context, id);
      default:
        return null;
    }
  }

  /**
   * Dispose an effect instance
   */
  static releaseEffect(effect: AudioEffect): void {
    try {
      effect.cleanup();
    } catch {
      // ignore
    }

    effect.enabled = false;
  }
}

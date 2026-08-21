import type {
  EngineAudioContext,
  InstrumentEngineConfig,
  InstrumentEngine,
  SynthState,
  InstrumentParamsState,
} from "./types";
import type { InstrumentCategory } from "./constants";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";

export abstract class BaseInstrumentEngine implements InstrumentEngine {
  protected config: InstrumentEngineConfig;
  protected isLoaded = false;
  protected isLoading = false;
  protected loadPromise: Promise<void> | null = null;
  /**
   * Lazily-created, cached pre-gain `GainNode` for this engine instance, sitting between the
   * instrument provider's output and the mixer channel's `inputGain` (DEV-301). See
   * `getPreGainNode()`/`connectPreGainToMixer()` below. Defaults to unity gain (1.0 / 0 dB).
   */
  protected preGainNode: GainNode | null = null;
  /**
   * In-flight `getPreGainNode()` promise, memoized the same way `loadPromise` serializes
   * concurrent `load()` calls. Guards against a re-entrancy race: without this, two calls to
   * `getPreGainNode()`/`connectPreGainToMixer()` issued before the first's
   * `getInstrumentAudioContext()` await resolves would both see `preGainNode === null`, both
   * call `createGain()`, and the second `GainNode` would silently overwrite the first in
   * `this.preGainNode` — leaving any caller holding the first node's reference (e.g. already
   * connected to the mixer) out of sync with subsequent `getPreGainNode()` callers (e.g.
   * `setVolume()`).
   */
  protected preGainNodePromise: Promise<GainNode> | null = null;

  constructor(config: InstrumentEngineConfig) {
    this.config = config;
  }

  // ===== Public concrete methods =====
  getKey(): string {
    return `${this.config.userId}-${this.config.instrumentName}-${this.config.category}`;
  }

  getAllActiveNotes(): string[] {
    return [];
  }

  getUserId(): string {
    return this.config.userId;
  }

  getUsername(): string {
    return this.config.username;
  }

  getInstrumentName(): string {
    return this.config.instrumentName;
  }

  getCategory(): InstrumentCategory {
    return this.config.category;
  }

  isInstrumentLoaded(): boolean {
    return this.isLoaded;
  }

  isInstrumentLoading(): boolean {
    return this.isLoading;
  }

  async updateInstrument(
    instrumentName: string,
    category: InstrumentCategory,
  ): Promise<void> {
    if (
      this.config.instrumentName === instrumentName &&
      this.config.category === category
    ) {
      return;
    }

    this.config.instrumentName = instrumentName;
    this.config.category = category;
    this.isLoaded = false;
    this.loadPromise = null;

    await this.load();
  }

  updateBPM(_bpm: number): void {
    // Override in specific engines if needed
  }

  scheduleParameterChange(
    _paramName: string,
    _value: number,
    _time: number,
    _transitionTime?: number,
  ): void {
    // Override in specific engines like SynthEngine for automation ramping
  }

  async waitForSamples(_timeout: number = 3000): Promise<string[]> {
    return [];
  }

  getAvailableSamples(): string[] {
    return [];
  }

  getSynthState(): SynthState | null {
    return null;
  }

  async updateSynthParams(_params: Partial<SynthState>): Promise<void> {
    // Override in SynthEngine
  }

  getInstrumentParams(): InstrumentParamsState | null {
    return null;
  }

  async updateInstrumentParams(
    _params: Partial<InstrumentParamsState>,
  ): Promise<void> {
    // Override in DrumEngine/MelodicEngine/AcousticDrumEngine/PercussionEngine
  }

  // ===== Protected methods =====
  protected async getInstrumentAudioContext(): Promise<EngineAudioContext> {
    const { AudioContextManager } = await import(
      "@/engine/audio"
    );
    return AudioContextManager.getInstrumentContext();
  }

  protected async getMixerDestinationNode(): Promise<AudioNode | null> {
    try {
      const { getOrCreateGlobalMixer } = await import(
        "@/engine/effects/runtime/effectsArchitecture"
      );
      const mixer = await getOrCreateGlobalMixer();
      const existing = mixer.getChannel(this.config.userId);
      const channel =
        existing ||
        mixer.createUserChannel(this.config.userId, this.config.username);
      return channel.inputGain;
    } catch (error) {
      console.warn(
        "[BaseInstrumentEngine] Mixer routing fallback to null:",
        error,
      );
      return null;
    }
  }

  protected async getPreGainNode(): Promise<GainNode> {
    if (this.preGainNode) {
      return this.preGainNode;
    }

    if (!this.preGainNodePromise) {
      this.preGainNodePromise = (async () => {
        try {
          const context = await this.getInstrumentAudioContext();
          const node = context.createGain();
          node.gain.value = 1.0;
          this.preGainNode = node;
          return node;
        } catch (error) {
          // Clear the cached in-flight promise on failure so the next call retries fresh
          // instead of permanently returning this rejected promise (self-healing, matching
          // AudioContextManager.getInstrumentContext()'s try/finally-reset idiom). Only the
          // failure path resets the cache — on success `preGainNode` is already set above, so
          // later calls short-circuit on the first guard without needing this promise at all.
          this.preGainNodePromise = null;
          throw error;
        }
      })();
    }

    return this.preGainNodePromise;
  }

  /**
   * Connects the pre-gain node to the mixer destination and returns the pre-gain node itself,
   * so subclasses can pass it as their provider's `destination` in place of the raw mixer
   * channel. If the mixer destination is unavailable, the pre-gain node is still returned,
   * left unconnected (graceful degradation, matching `getMixerDestinationNode`'s fallback style).
   * Unlike `getMixerDestinationNode`, the return value is never `null` — the pre-gain node
   * itself always exists; only its onward connection may be missing.
   */
  protected async connectPreGainToMixer(): Promise<AudioNode> {
    const preGain = await this.getPreGainNode();
    const mixerDestination = await this.getMixerDestinationNode();
    if (mixerDestination) {
      preGain.connect(mixerDestination);
    } else {
      console.warn(
        "[BaseInstrumentEngine] Mixer destination unavailable, pre-gain node left unconnected:",
        this.getKey(),
      );
    }
    return preGain;
  }

  // ===== Abstract methods =====
  abstract load(context?: EngineAudioContext): Promise<void>;
  abstract playNote(event: NoteEvent): void;
  abstract stopNote(event: NoteStopEvent): void;
  abstract stopAllNotes(): void;
  abstract setVolume(volume: number): void;
  abstract setSustain(sustain: boolean): void;
  abstract destroy(): void;
  abstract getAudioNode(): AudioNode | null;
}

import { AudioContextManager } from "@/engine/audio";
import { SynthEngine } from "../synthesizer/SynthEngine";
import { createEngine } from "../shared/engineFactory";
import type { InstrumentEngine, InstrumentEngineConfig } from "../shared/types";
import type { InstrumentCategory } from "../shared/constants";

export class InstrumentEnginePool {
  private readonly engines = new Map<string, InstrumentEngine>();
  private readonly configs = new Map<string, InstrumentEngineConfig>();
  private readonly loadingPromises = new Map<string, Promise<InstrumentEngine>>();
  // Version counter per key: incremented on each updateEngineInstrument call so
  // stale completions from superseded switches can be discarded.
  private readonly updateVersions = new Map<string, number>();

  /**
   * Retrieves an existing engine or starts loading a new one, returning a promise.
   * This prevents duplicate simultaneous loads for the same key.
   */
  async getOrCreateEngine(
    key: string,
    config: InstrumentEngineConfig,
  ): Promise<InstrumentEngine> {
    // 1. Return from active engines cache if ready
    const existing = this.engines.get(key);
    if (existing && existing.isInstrumentLoaded()) {
      return existing;
    }

    // 2. Return the existing load promise if loading is already in progress
    const pendingPromise = this.loadingPromises.get(key);
    if (pendingPromise) {
      return pendingPromise;
    }

    // 3. Initiate new engine creation and loading
    const loadPromise = (async () => {
      // Clean up any existing engine with the same key to prevent node leak
      if (existing) {
        existing.destroy();
      }

      const engine = createEngine(config);
      const context = await AudioContextManager.getInstrumentContext();

      // Ensure context is resumed (for Safari/WebKit compatibility)
      if (context.state === "suspended") {
        try {
          await context.resume();
        } catch (error) {
          console.warn(
            "[InstrumentEnginePool] Failed to resume AudioContext during engine load:",
            error,
          );
        }
      }

      await engine.load(context);

      this.engines.set(key, engine);
      this.configs.set(key, config);
      this.loadingPromises.delete(key);
      return engine;
    })();

    this.loadingPromises.set(key, loadPromise);

    try {
      return await loadPromise;
    } catch (error) {
      this.loadingPromises.delete(key);
      throw error;
    }
  }

  /**
   * Swaps the engine at `key` to a new instrument/category, preserving SynthState
   * when switching between synth types. This is the cross-category switching logic
   * that previously lived in InstrumentEngine.updateInstrument().
   *
   * Race-condition safe: uses a per-key version counter so that if a newer switch
   * starts before this one finishes loading, this stale result is discarded.
   *
   * The old engine is destroyed immediately when the switch is requested. The engine
   * object stays in the map (not deleted) so that concurrent switches still route
   * through this method and the version counter remains effective. All playback
   * methods guard against a destroyed engine via isLoaded, so leaving it in the map
   * is safe.
   */
  async updateEngineInstrument(
    key: string,
    instrumentName: string,
    category: InstrumentCategory,
  ): Promise<void> {
    const existing = this.engines.get(key);
    if (!existing) return;

    // Bump version BEFORE the same-instrument check so that switching back to the
    // currently loaded instrument (e.g. A→B→A while B is loading) cancels the
    // in-flight B load rather than letting it overwrite A after completion.
    const version = (this.updateVersions.get(key) ?? 0) + 1;
    this.updateVersions.set(key, version);

    // Skip if the engine is already loaded with the requested instrument.
    // Do NOT skip if the engine has been destroyed (isInstrumentLoaded = false):
    // a destroyed engine matching by name means an earlier switch destroyed it and
    // we need to reload (e.g. the A→B→A scenario where A was destroyed by the B switch).
    if (
      existing.getInstrumentName() === instrumentName &&
      existing.getCategory() === category &&
      existing.isInstrumentLoaded()
    ) {
      return;
    }

    const previousSynthState = existing.getSynthState();

    const currentConfig = this.configs.get(key);
    if (!currentConfig) return;

    // Destroy the old engine immediately. The virtual instrument UI is unmounted
    // during loading so no playback can occur during the gap. The destroyed engine
    // object remains in the map so subsequent rapid switches still route through
    // this method and stay under version-counter control.
    existing.stopAllNotes();
    existing.destroy();

    const newConfig = { ...currentConfig, instrumentName, category };
    this.configs.set(key, newConfig);

    const newEngine = createEngine(newConfig);
    const context = await AudioContextManager.getInstrumentContext();

    try {
      await newEngine.load(context);
    } catch (error) {
      // Roll back the config if no newer switch has already claimed this slot.
      if (this.updateVersions.get(key) === version) {
        this.configs.set(key, currentConfig);
      }
      newEngine.destroy();
      throw error;
    }

    // A newer switch superseded this one — discard the result.
    if (this.updateVersions.get(key) !== version) {
      newEngine.destroy();
      return;
    }

    if (newEngine instanceof SynthEngine && previousSynthState) {
      await newEngine.updateSynthParams(previousSynthState);
    }

    this.engines.set(key, newEngine);
  }

  /**
   * Retrieves an engine from the pool synchronously. Returns null if not loaded.
   */
  getEngine(key: string): InstrumentEngine | null {
    return this.engines.get(key) || null;
  }

  /**
   * Checks if an engine with the given key is currently loading.
   */
  isEngineLoading(key: string): boolean {
    return this.loadingPromises.has(key);
  }

  /**
   * Checks if an engine with the given key is ready to play.
   */
  isEngineReady(key: string): boolean {
    const engine = this.engines.get(key);
    return engine ? engine.isInstrumentLoaded() : false;
  }

  /**
   * Retrieves all active keys currently registered in the pool.
   */
  getKeys(): string[] {
    return Array.from(this.engines.keys());
  }

  /**
   * Disposes and removes a specific engine from the pool.
   */
  disposeEngine(key: string): void {
    const engine = this.engines.get(key);
    if (engine) {
      engine.destroy();
      this.engines.delete(key);
      this.configs.delete(key);
    }
    this.loadingPromises.delete(key);
  }

  /**
   * Disposes and clears all engines from the pool.
   */
  disposeAll(): void {
    this.engines.forEach((engine) => {
      try {
        engine.destroy();
      } catch (error) {
        console.warn("[InstrumentEnginePool] Error during engine dispose:", error);
      }
    });
    this.engines.clear();
    this.configs.clear();
    this.loadingPromises.clear();
  }
}

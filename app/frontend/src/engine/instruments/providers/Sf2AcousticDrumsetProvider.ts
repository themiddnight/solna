import type {
  InstrumentProvider,
  InstrumentProviderLoadContext,
  InstrumentProviderPlayOptions,
  InstrumentStopHandle,
} from "./types";

/**
 * Reserved scaffold for a future SF2 (SoundFont) backed acoustic drum kit
 * (DEV-282 enabler for DEV-283/DEV-284). This proves the extension seam: a new
 * sample source plugs in via a provider key + factory case + provider class,
 * with no change to the catalog or drum engines.
 *
 * It is intentionally inert — no `.sf2` bank is hosted and no kit config
 * declares `providerKey: "sf2-acoustic-drumset"` yet, so `load()` is never
 * reached at runtime. When a real SF2 kit lands, replace `load()`/`play()` with
 * a SoundFont loader (see `SmplrSoundfontProvider` for the URL-loading pattern).
 *
 * As a direct-MIDI player it returns [] from `getAvailableSamples()`, so the
 * drum engine skips the GM-note↔sample-name remap.
 */
export class Sf2AcousticDrumsetProvider implements InstrumentProvider {
  async load(_context: InstrumentProviderLoadContext): Promise<void> {
    return Promise.reject(
      new Error(
        "SF2 acoustic drum kits are not implemented yet (DEV-282 scaffold slot)",
      ),
    );
  }

  play(_options: InstrumentProviderPlayOptions): InstrumentStopHandle {
    return undefined;
  }

  stop(_note?: string | number, _time?: number): void {
    // No-op scaffold.
  }

  stopAll(): void {
    // No-op scaffold.
  }

  getAvailableSamples(): string[] {
    return [];
  }

  dispose(): void {
    // No-op scaffold.
  }
}

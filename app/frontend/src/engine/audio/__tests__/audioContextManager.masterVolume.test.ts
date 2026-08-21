import { describe, it, expect, afterEach } from "vitest";
import { AudioContextManager } from "../audioContextManager";
import { AUDIO_CONFIG } from "../audioConfig";

describe("MasterAudioBus — default gain (DEV-306)", () => {
  afterEach(async () => {
    await AudioContextManager.cleanup();
  });

  it("audioConfig.ts no longer exposes a masterGainLevel (single source of truth)", () => {
    expect((AUDIO_CONFIG.MASTER_BUS as Record<string, unknown>).masterGainLevel).toBeUndefined();
  });

  it("constructs the master gain node at unity (0dB), matching DEFAULT_MASTER_VOLUME_DB", async () => {
    await AudioContextManager.getInstrumentContext();
    const masterBus = AudioContextManager.getMasterBus();
    expect(masterBus).not.toBeNull();
    // 0dB -> linear gain 1.0
    expect(masterBus!.getMasterGain().gain.value).toBeCloseTo(1, 5);
  });
});

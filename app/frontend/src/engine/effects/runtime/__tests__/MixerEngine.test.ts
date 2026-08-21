import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// Tone.js hangs in jsdom because its internal initialization (audio context
// creation, state-change event loops) never completes with mocked Web Audio
// APIs. We mock the `tone` module BEFORE importing MixerEngine so Tone.js
// never loads. The tests only verify MixerEngine's channel/volume API —
// real Tone.js integration is covered by e2e / manual testing.
// ═══════════════════════════════════════════════════════════════════════════
vi.mock("tone", () => {
  // Mimics the subset of Tone.js constructors used by MixerEngine.
  // Arrow-function class fields must be declared before the constructor to
  // satisfy @typescript-eslint/member-ordering (fields → constructor → methods).

  class MockChannel {
    // ---- fields ----
    channel: { volume: { value: number }; pan: { value: number }; mute: boolean };
    pan: { value: number };
    mute: boolean;
    volume: { value: number };
    /** Captured from constructor opts so tests can assert MixerEngine's actual call site
     *  (DEV-305 final review: Tone's Channel/Panner default to channelCount:1, which
     *  down-mixes stereo to mono before panning — MixerEngine must pass channelCount:2). */
    channelCount: number | undefined;
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    receive = vi.fn().mockReturnValue({ gain: { value: 1 } });
    send = vi.fn().mockReturnValue({ gain: { value: 1 } });

    // ---- constructor ----
    constructor(opts?: { volume?: number; pan?: number; channelCount?: number }) {
      this.channel = { volume: { value: opts?.volume ?? 0 }, pan: { value: opts?.pan ?? 0 }, mute: false };
      this.pan = { value: opts?.pan ?? 0 };
      this.mute = false;
      this.volume = { value: opts?.volume ?? 0 };
      this.channelCount = opts?.channelCount;
    }
  }

  class MockGain {
    // ---- fields ----
    gain: { value: number };
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    chain = vi.fn().mockReturnThis();
    fan = vi.fn().mockReturnThis();

    // ---- constructor ----
    constructor(val?: number) {
      this.gain = { value: val ?? 1 };
    }
  }

  class MockAnalyser {
    // ---- fields ----
    type = 'fft' as const;
    size = 1024;
    smooth = 0.8;
    getValue = vi.fn().mockReturnValue(new Float32Array(1024));
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    input = { connect: vi.fn(), disconnect: vi.fn() };
    output = { connect: vi.fn(), disconnect: vi.fn() };
  }

  const mockCtx: { rawContext: AudioContext | null } = { rawContext: null };

  return {
    Channel: MockChannel,
    Gain: MockGain,
    Analyser: MockAnalyser,
    connect: vi.fn(),
    // The edge-patch helpers sever chain edges with tone's `disconnect` bridge
    // (mixerChainWiring.ts), so the mock must provide the export.
    disconnect: vi.fn(),
    getContext: vi.fn().mockReturnValue(mockCtx),
    setContext: vi.fn((ctx: AudioContext) => { mockCtx.rawContext = ctx; }),
    start: vi.fn().mockResolvedValue(undefined),
    get context() { return mockCtx; },
  };
});

// EffectsFactory.initialize() calls Tone's `start()` + has the removed 100ms
// setTimeout. In jsdom `start()` could hang, and tests don't need real effects.
vi.mock("../EffectsFactory", () => ({
  EffectsFactory: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

import { MixerEngine, MIXER_VOLUME_MIN_DB, MIXER_VOLUME_MAX_DB } from "../MixerEngine";
import { toDecibels } from "@/shared/audio/gainUnits";

describe("MixerEngine", () => {
  let ctx: AudioContext;
  let mixer: MixerEngine;
  const oscNodes: OscillatorNode[] = [];

  beforeAll(() => {
    ctx = new AudioContext();
    mixer = new MixerEngine(ctx);
  });

  afterEach(() => {
    for (const osc of oscNodes.splice(0)) {
      try { osc.stop(); } catch { /* already stopped */ }
      try { osc.disconnect(); } catch { /* already disconnected */ }
    }
  });

  afterAll(() => {
    void ctx.close();
  });

  function makeOsc(): OscillatorNode {
    const osc = ctx.createOscillator();
    oscNodes.push(osc);
    return osc;
  }

  it("a channel created while a mute requester is already registered comes up muted", () => {
    mixer.setChannelMasterMuted('u1', 'effect-1', true);
    const channel = mixer.createUserChannel('u1', 'Alice');
    expect(channel.masterSendGain).toBeDefined();
    expect(channel.masterSendGain?.gain.value).toBe(0);
  });

  it("a channel created with no mute requester comes up unmuted", () => {
    const channel = mixer.createUserChannel('u2', 'Bob');
    expect(channel.masterSendGain).toBeDefined();
    expect(channel.masterSendGain?.gain.value).toBe(1);
  });

  it("constructs the volume/pan stage with channelCount: 2 (DEV-305 final review: Tone's Channel/Panner default to channelCount:1, which silently down-mixes stereo to mono before panning at every pan position; see MixerEngine.stereo.test.ts for the mechanism)", () => {
    const channel = mixer.createUserChannel('cc1', 'Alice');
    expect(channel.toneChannel?.channelCount).toBe(2);
  });

  it('notifies channel-created listeners with the new channel id', () => {
    const seen: string[] = [];
    const unsub = mixer.onChannelCreated((id) => seen.push(id));
    mixer.createUserChannel('u3', 'Alice');
    expect(seen).toEqual(['u3']);
    unsub();
    mixer.createUserChannel('u4', 'Bob');
    expect(seen).toEqual(['u3']);
  });

  describe("voice volume", () => {
    it("getVoiceVolume returns null before any voice routing", () => {
      mixer.createUserChannel('v1', 'Alice');
      expect(mixer.getVoiceVolume('v1')).toBeNull();
    });

    it("setVoiceVolume and getVoiceVolume round-trip through the voice gain", () => {
      mixer.createUserChannel('v2', 'Alice');
      const osc = makeOsc();
      mixer.routeVoiceToChannel(osc, 'v2');

      mixer.setVoiceVolume('v2', toDecibels(6));
      expect(mixer.getVoiceVolume('v2')).toBe(6);
    });

    // dB, same -60..+12 mix-fader range as the instrument fader (DEV-324). The old
    // linear 0..4 clamp is gone with the linear API it belonged to.
    it("setVoiceVolume clamps to the mix-fader range", () => {
      mixer.createUserChannel('v3', 'Alice');
      const osc = makeOsc();
      mixer.routeVoiceToChannel(osc, 'v3');

      mixer.setVoiceVolume('v3', toDecibels(-120));
      expect(mixer.getVoiceVolume('v3')).toBe(MIXER_VOLUME_MIN_DB);

      mixer.setVoiceVolume('v3', toDecibels(48));
      expect(mixer.getVoiceVolume('v3')).toBe(MIXER_VOLUME_MAX_DB);
    });

    it("setVoiceVolume does not affect instrument volume", () => {
      mixer.createUserChannel('v4', 'Alice');
      const osc = makeOsc();
      mixer.routeVoiceToChannel(osc, 'v4');

      mixer.setUserVolume('v4', toDecibels(-3.5));
      mixer.setVoiceVolume('v4', toDecibels(6));

      expect(mixer.getVoiceVolume('v4')).toBe(6);
      expect(mixer.getUserVolume('v4')).toBe(-3.5);
    });

    it("setUserVolume does not affect voice volume", () => {
      mixer.createUserChannel('v5', 'Alice');
      const osc = makeOsc();
      mixer.routeVoiceToChannel(osc, 'v5');

      mixer.setVoiceVolume('v5', toDecibels(6));
      mixer.setUserVolume('v5', toDecibels(-6));

      expect(mixer.getVoiceVolume('v5')).toBe(6);
      expect(mixer.getUserVolume('v5')).toBe(-6);
    });

    it("removeUserChannel cleans up voice gain", () => {
      mixer.createUserChannel('v6', 'Alice');
      const osc = makeOsc();
      mixer.routeVoiceToChannel(osc, 'v6');
      expect(mixer.getVoiceVolume('v6')).toBe(0); // default = unity, 0 dB

      mixer.removeUserChannel('v6');
      expect(mixer.getVoiceVolume('v6')).toBeNull();
    });
  });

  describe("instrument volume (dB)", () => {
    it("setUserVolume/getUserVolume round-trip in dB and drive toneChannel.volume", () => {
      const channel = mixer.createUserChannel('db1', 'Alice');
      mixer.setUserVolume('db1', toDecibels(-9));
      expect(mixer.getUserVolume('db1')).toBe(-9);
      expect(channel.toneChannel?.volume.value).toBe(-9);
    });

    it("clamps to -60..+12 dB", () => {
      mixer.createUserChannel('db2', 'Alice');
      mixer.setUserVolume('db2', toDecibels(-100));
      expect(mixer.getUserVolume('db2')).toBe(-60);
      mixer.setUserVolume('db2', toDecibels(50));
      expect(mixer.getUserVolume('db2')).toBe(12);
    });

    it("passes -Infinity straight through as true mute, bypassing the -60 floor", () => {
      const channel = mixer.createUserChannel('db3', 'Alice');
      mixer.setUserVolume('db3', toDecibels(-Infinity));
      expect(mixer.getUserVolume('db3')).toBe(-Infinity);
      expect(channel.toneChannel?.volume.value).toBe(-Infinity);
    });

    it("setUserPan/getUserPan round-trip and drive toneChannel.pan", () => {
      const channel = mixer.createUserChannel('pan1', 'Alice');
      mixer.setUserPan('pan1', 0.5);
      expect(mixer.getUserPan('pan1')).toBe(0.5);
      expect(channel.toneChannel?.pan.value).toBe(0.5);
    });

    it("clamps pan to -1..1", () => {
      mixer.createUserChannel('pan2', 'Alice');
      mixer.setUserPan('pan2', 5);
      expect(mixer.getUserPan('pan2')).toBe(1);
      mixer.setUserPan('pan2', -5);
      expect(mixer.getUserPan('pan2')).toBe(-1);
    });
  });
});

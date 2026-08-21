import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VoiceVolumeController, type VoiceVolumeHost } from "../voiceVolumeController";
import { MIXER_VOLUME_MIN_DB, MIXER_VOLUME_MAX_DB } from "../mixerVolumeRange";
import { toDecibels, dbToGain, UNITY_DB } from "@/shared/audio/gainUnits";
import type { UserChannel } from "../audioEffectTypes";

/**
 * DEV-324 — the per-peer voice fader, in dB.
 *
 * The behaviour worth locking is the ordering one: a member appears in the list, and their
 * session-restored level is written, well before their WebRTC track arrives and the channel
 * gets a `voiceGain`. Dropping the request in that window is invisible in a unit test that
 * sets and reads in one breath, and shows up in a real room as "my saved level did nothing".
 */

const USER = "peer-1";

let context: AudioContext;
let channels: Map<string, UserChannel>;

const makeChannel = (): UserChannel =>
  ({
    userId: USER,
    username: "Peer One",
    inputGain: context.createGain(),
    monitorTap: context.createGain(),
    targetVolume: UNITY_DB,
    targetPan: 0,
    effectChain: [],
    sends: new Map(),
    voiceVolumeDb: UNITY_DB,
  }) satisfies UserChannel;

/** Stands in for the two real destinations: the channel's own output, and the post-tap stage. */
let mixDestination: GainNode;
let directDestination: GainNode;

const makeHost = (): VoiceVolumeHost => ({
  getChannel: (userId) => channels.get(userId),
  getAudioContext: () => context,
  connectNodes: () => { /* graph wiring is MixerEngine's job, not this unit's */ },
  getVoiceDestination: (_channel, routing) =>
    routing === "direct" ? directDestination : mixDestination,
});

describe("VoiceVolumeController", () => {
  beforeEach(() => {
    context = new AudioContext();
    channels = new Map();
    mixDestination = context.createGain();
    directDestination = context.createGain();
  });

  afterEach(() => {
    channels.clear();
  });

  it("clamps to the mix-fader range in dB, not to a linear 0..4", () => {
    const controller = new VoiceVolumeController(makeHost());
    channels.set(USER, makeChannel());

    controller.setVoiceVolume(USER, toDecibels(-200));
    expect(controller.getVoiceVolume(USER)).toBe(MIXER_VOLUME_MIN_DB);

    controller.setVoiceVolume(USER, toDecibels(60));
    expect(controller.getVoiceVolume(USER)).toBe(MIXER_VOLUME_MAX_DB);
  });

  it("keeps a level set before the peer's channel exists, and applies it on routing", () => {
    const controller = new VoiceVolumeController(makeHost());

    // No channel yet — this is the ordinary case on a session-storage restore.
    controller.setVoiceVolume(USER, toDecibels(-12));
    expect(controller.getVoiceVolume(USER)).toBe(-12);

    channels.set(USER, makeChannel());
    controller.routeVoiceToChannel(context.createGain(), USER);

    const channel = channels.get(USER);
    expect(channel?.voiceGain).toBeDefined();
    expect(channel?.voiceVolumeDb).toBe(-12);
    expect(channel?.voiceGain?.gain.value).toBeCloseTo(dbToGain(toDecibels(-12)), 5);
  });

  it("opens a newly routed channel at unity when the user has never touched the fader", () => {
    const controller = new VoiceVolumeController(makeHost());
    channels.set(USER, makeChannel());

    controller.routeVoiceToChannel(context.createGain(), USER);

    expect(channels.get(USER)?.voiceGain?.gain.value).toBeCloseTo(1, 5);
  });

  it("reaches above unity through the gain node — the boost the element path cannot deliver", () => {
    const controller = new VoiceVolumeController(makeHost());
    channels.set(USER, makeChannel());
    controller.routeVoiceToChannel(context.createGain(), USER);

    controller.setVoiceVolume(USER, toDecibels(12));

    // element.volume caps at 1; this is the reason the graph path exists at all.
    expect(dbToGain(toDecibels(12))).toBeGreaterThan(1);
    expect(controller.getVoiceVolume(USER)).toBe(12);
  });

  /**
   * DEV-325 — where the voice branch lands decides whether a peer talking during a mixdown
   * ends up inside the exported file. `mix` is upstream of the master tap (Perform: the room
   * owner's mix is the broadcast, BR-14); `direct` is the reserved post-tap stage (Arrange:
   * heard, never printed).
   */
  describe("routing mode", () => {
    const spiedHost = (): { host: VoiceVolumeHost; resolve: ReturnType<typeof vi.fn> } => {
      const resolve = vi.fn((_channel: UserChannel, routing: "mix" | "direct") =>
        routing === "direct" ? directDestination : mixDestination,
      );
      return {
        host: {
          getChannel: (userId) => channels.get(userId),
          getAudioContext: () => context,
          connectNodes: () => { /* not under test */ },
          getVoiceDestination: resolve,
        },
        resolve,
      };
    };

    it("defaults to the mix, keeping voice in what a Perform capture records", () => {
      const { host, resolve } = spiedHost();
      const controller = new VoiceVolumeController(host);
      channels.set(USER, makeChannel());

      expect(controller.getVoiceRouting()).toBe("mix");
      controller.routeVoiceToChannel(context.createGain(), USER);

      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }), "mix");
    });

    it("sends a peer joining an already-switched room straight to the post-tap stage", () => {
      const { host, resolve } = spiedHost();
      const controller = new VoiceVolumeController(host);
      controller.setVoiceRouting("direct");
      channels.set(USER, makeChannel());

      controller.routeVoiceToChannel(context.createGain(), USER);

      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }), "direct");
    });

    it("moves peers that were already wired when the room changes the mode", () => {
      const controller = new VoiceVolumeController(makeHost());
      channels.set(USER, makeChannel());
      controller.setVoiceVolume(USER, toDecibels(-3)); // registers the peer as known
      controller.routeVoiceToChannel(context.createGain(), USER);
      const voiceGain = channels.get(USER)?.voiceGain;
      if (!voiceGain) throw new Error("voice gain was not created");

      const disconnect = vi.spyOn(voiceGain, "disconnect");
      const connect = vi.spyOn(voiceGain, "connect");

      // MixerEngine is a singleton, so an Arrange mount inherits peers wired under Perform's
      // mode. Rewiring only future peers would leave those still leaking into the mixdown.
      controller.setVoiceRouting("direct");

      expect(disconnect).toHaveBeenCalled();
      expect(connect).toHaveBeenCalledWith(directDestination);
    });

    it("leaves the branch unconnected rather than falling back to the mix with no destination", () => {
      const controller = new VoiceVolumeController({
        getChannel: (userId) => channels.get(userId),
        getAudioContext: () => context,
        connectNodes: () => { /* not under test */ },
        getVoiceDestination: () => null,
      });
      channels.set(USER, makeChannel());

      // Silence is the safe failure: falling back to the channel would print voice into an
      // export, and an export is not something the user can un-hear afterwards. The gain is
      // still built, so the fader has a target and a later mode switch can wire it up.
      expect(() => {
        controller.routeVoiceToChannel(context.createGain(), USER);
      }).not.toThrow();
      expect(channels.get(USER)?.voiceGain).toBeDefined();
    });
  });

  it("drives the <audio> element when routing never happened, capped at unity", () => {
    const controller = new VoiceVolumeController(makeHost());
    const element = document.createElement("audio");
    controller.registerVoiceAudioElement(USER, element);

    controller.setVoiceVolume(USER, toDecibels(-6));
    expect(element.volume).toBeCloseTo(dbToGain(toDecibels(-6)), 5);

    controller.setVoiceVolume(USER, toDecibels(12));
    expect(element.volume).toBe(1);
  });
});

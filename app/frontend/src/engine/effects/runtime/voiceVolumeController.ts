import type { UserChannel } from "./audioEffectTypes";
import { dbToGain, toDecibels, type Decibels } from "@/shared/audio/gainUnits";
import { MIXER_VOLUME_MIN_DB, MIXER_VOLUME_MAX_DB } from "./mixerVolumeRange";

/**
 * Per-peer remote-voice volume routing + degraded direct-speaker fallback.
 *
 * Extracted from MixerEngine (TR-20 line cap). The voice feature registers its
 * remote-voice `<audio>` elements here (`registerVoiceAudioElement`) instead of the
 * engine querying the DOM for `audio[data-webrtc-user=…]` (TR-38: the engine stays
 * room-agnostic). The controller routes voice through a per-channel `voiceGain`
 * (bypassing the instrument channel's Tone.Channel volume/pan stage so instrument &
 * voice volumes are independent) and, when that routing never happened, drives the
 * registered `<audio>` element's own volume as a degraded fallback.
 *
 * **Unit: dB** (DEV-324 / TR-40). This was the last linear-gain holdout after the
 * DEV-303/304/305 migration, which is what made the two sliders in the user-volume control
 * read as if they meant different things — one converted, one branded. Both are dB in, dB out
 * now; the conversion to a linear multiplier happens only where an AudioParam is written.
 */

/**
 * Where a peer's voice branch lands (DEV-325).
 *
 * - `mix` — into the master sum, upstream of the master tap. Voice is part of what gets
 *   recorded, shadow-captured and broadcast. Perform: the room owner's mix *is* the broadcast
 *   (BR-14), so the conversation belongs in it. Deliberately the master sum and not the peer's
 *   own channel output: that node feeds the channel's meters and aux tap, so voice there would
 *   drive the avatar's instrument glow (speaking is shown by the amber speaking border) and
 *   contaminate anything keyed on that user's playing.
 * - `direct` — into the reserved post-tap stage. Voice is heard and never printed. Arrange: a
 *   mixdown should contain the project, not the conversation about the project. Landing after
 *   the tap also puts voice outside the master fader for free, which is what Arrange's master
 *   channel needs anyway.
 *
 * This is a capability, not a room name — `src/engine/` must not learn about Perform vs
 * Arrange (TR-38). The room layer picks the mode.
 */
export type VoiceRouting = "mix" | "direct";

export interface VoiceVolumeHost {
  getChannel(userId: string): UserChannel | undefined;
  getAudioContext(): AudioContext;
  connectNodes(source: unknown, destination: unknown): void;
  /** Resolved per channel because `mix` lands on that channel and `direct` lands globally. */
  getVoiceDestination(channel: UserChannel, routing: VoiceRouting): AudioNode | null;
}

const clampVoiceDb = (db: number): Decibels =>
  toDecibels(Math.max(MIXER_VOLUME_MIN_DB, Math.min(MIXER_VOLUME_MAX_DB, db)));

export class VoiceVolumeController {
  /** userId → registered remote-voice `<audio>` element (degraded direct-speaker path). */
  private readonly voiceAudioElements = new Map<string, HTMLAudioElement>();
  /**
   * userId → the volume the user asked for, whether or not anything exists to apply it to yet.
   *
   * A per-user fader is restored from sessionStorage the moment the member list renders, which
   * is routinely before that peer's WebRTC track arrives and its channel is built. Keeping the
   * request here (rather than only on the channel) is what lets `routeVoiceToChannel` open the
   * new gain at the user's setting instead of unity.
   */
  private readonly requestedVolumeDb = new Map<string, Decibels>();
  /**
   * Defaults to `mix`, the pre-DEV-325 behaviour: a room that never states a preference keeps
   * voice inside the recorded mix, which is the safe direction — voice missing from a capture
   * that wanted it is a lost take, while voice present in one that did not is re-renderable.
   */
  private routing: VoiceRouting = "mix";

  constructor(private readonly host: VoiceVolumeHost) {}

  /**
   * Set the routing mode and move every already-wired voice branch to match.
   *
   * Rewiring live branches (rather than only affecting future ones) is the point: `MixerEngine`
   * is a singleton that outlives a client-side room change, so peers routed under the previous
   * room's mode are still connected when the next room mounts.
   */
  setVoiceRouting(routing: VoiceRouting): void {
    if (this.routing === routing) return;
    this.routing = routing;
    for (const userId of this.requestedVolumeDb.keys()) this.rewireVoiceBranch(userId);
    for (const [userId] of this.voiceAudioElements) this.rewireVoiceBranch(userId);
  }

  getVoiceRouting(): VoiceRouting {
    return this.routing;
  }

  registerVoiceAudioElement(userId: string, element: HTMLAudioElement): void {
    this.voiceAudioElements.set(userId, element);
  }

  unregisterVoiceAudioElement(userId: string): void {
    this.voiceAudioElements.delete(userId);
  }

  clear(): void {
    this.voiceAudioElements.clear();
    this.requestedVolumeDb.clear();
  }

  /** Route remote WebRTC voice → voiceGain → wherever the current routing mode says (bypasses
   *  the instrument channel's inputGain + Tone.Channel volume/pan stage either way, so
   *  setUserVolume / setVoiceVolume stay independent). */
  routeVoiceToChannel(voiceSource: AudioNode, userId: string): void {
    const channel = this.host.getChannel(userId);
    if (!channel) return;

    // Adopt whatever the user asked for while there was no channel to ask — *before* the gain
    // node is built. Opening at unity and correcting a tick later would let one moment of
    // full-level voice through every time a peer connects, which is exactly the moment someone
    // who turned that peer down was trying to avoid.
    const pending = this.requestedVolumeDb.get(userId);
    if (pending !== undefined) channel.voiceVolumeDb = pending;

    if (!channel.voiceGain) {
      channel.voiceGain = this.host.getAudioContext().createGain();
      channel.voiceGain.gain.value = dbToGain(channel.voiceVolumeDb);
      const destination = this.host.getVoiceDestination(channel, this.routing);
      // The host hands back native nodes on both paths (a Tone Gain's `.input`, or the master
      // bus's post-tap GainNode) so this stays a native→native connect — routing a raw native
      // node through the general connectNodes bridge fails silently (FAILURE_PATTERNS
      // Pattern 12), and it failed here once already.
      if (destination) channel.voiceGain.connect(destination);
    } else if (pending !== undefined) {
      this.setVoiceVolume(userId, pending);
    }
    this.host.connectNodes(voiceSource, channel.voiceGain);
  }

  setVoiceVolume(userId: string, volumeDb: Decibels): void {
    const clamped = clampVoiceDb(volumeDb);
    this.requestedVolumeDb.set(userId, clamped);

    const channel = this.host.getChannel(userId);
    if (channel) {
      // Store unconditionally so a drag before voiceGain exists isn't dropped —
      // routeVoiceToChannel applies channel.voiceVolumeDb when it later creates the gain.
      channel.voiceVolumeDb = clamped;
      if (channel.voiceGain) {
        try {
          channel.voiceGain.gain.setValueAtTime(
            dbToGain(clamped),
            this.host.getAudioContext().currentTime,
          );
        } catch { /* ignore */ }
        return;
      }
    }
    // Degraded path: routing never happened (WebKit, or a failed graph route), so voice plays
    // via the raw <audio> element straight to the speakers. `element.volume` is a linear
    // multiplier capped at 1, so the boost half of the range is unreachable here — that
    // asymmetry is the whole reason `supportsRemoteStreamWebAudio` exists.
    const el = this.voiceAudioElements.get(userId);
    if (el) {
      try { el.volume = Math.min(1, dbToGain(clamped)); } catch { /* ignore */ }
    }
  }

  getVoiceVolume(userId: string): Decibels | null {
    const ch = this.host.getChannel(userId);
    if (ch?.voiceGain) return ch.voiceVolumeDb;
    return this.requestedVolumeDb.get(userId) ?? null;
  }

  private rewireVoiceBranch(userId: string): void {
    const channel = this.host.getChannel(userId);
    const voiceGain = channel?.voiceGain;
    if (!channel || !voiceGain) return;
    // Bare disconnect() is safe here and only here: voiceGain is a private branch node with
    // exactly one downstream, unlike the master tap where it would drop the speaker path.
    try { voiceGain.disconnect(); } catch { /* nothing attached */ }
    const destination = this.host.getVoiceDestination(channel, this.routing);
    if (destination) voiceGain.connect(destination);
  }
}

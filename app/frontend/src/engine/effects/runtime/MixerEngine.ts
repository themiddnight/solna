import { AudioContextManager } from "@/engine/audio";
import { Channel, Gain, Analyser, getContext, setContext } from "tone";
import type { AudioEffect, AuxBus, MasterSection, UserChannel } from "./audioEffectTypes";
import type { EffectType } from "./audioEffectTypes";
import { EffectsFactory } from "./EffectsFactory";
import { EFFECT_TYPE } from "./audioEffectTypes";
import { buildEffectChain } from "./effectChainBuilder";
import { connectNodes, patchEffectIntoChainEnd, patchEffectOutOfChain } from "./mixerChainWiring";
import type { EffectInstanceState } from "@/shared/types";
import { VoiceVolumeController, type VoiceRouting } from "./voiceVolumeController";
import { toDecibels, UNITY_DB, type Decibels } from "@/shared/audio/gainUnits";
import { MIXER_VOLUME_MIN_DB, MIXER_VOLUME_MAX_DB } from "./mixerVolumeRange";

/** Instrument/track channel fader range, dB. -Infinity (true mute) bypasses this floor — see setUserVolume. */
export { MIXER_VOLUME_MIN_DB, MIXER_VOLUME_MAX_DB };

/* eslint-disable @typescript-eslint/member-ordering */
export class MixerEngine {
  private readonly userChannels = new Map<string, UserChannel>();
  /** channelId → set of requester ids currently master-muting it (see setChannelMasterMuted). */
  private readonly masterMuteRequesters = new Map<string, Set<string>>();
  private readonly channelCreatedListeners = new Set<(channelId: string) => void>();
  private readonly auxBuses = new Map<string, AuxBus>();
  private readonly voiceVolume = new VoiceVolumeController({
    getChannel: (userId) => this.userChannels.get(userId),
    getAudioContext: () => this.context,
    connectNodes,
    getVoiceDestination: (channel, routing) => {
      const masterBus = AudioContextManager.getMasterBus();
      if (routing === "direct") {
        // Post-tap: heard, never printed. Null (no bus yet) leaves the branch unconnected
        // rather than falling back to the mix — silence beats a voice leak into an export.
        return masterBus?.getPostTapInput() ?? null;
      }
      // Mix mode lands on the master sum, NOT on the peer's own channel output. Both are
      // upstream of the capture tap, so a Perform capture gets the conversation either way —
      // but the channel output is also what `analyser`/`nativeAnalyser`/`monitorTap` read, so
      // routing voice there made talking light up the avatar's instrument glow and feed a
      // user's voice into any aux consumer keyed on their playing. The glow is an instrument
      // signal; speaking is shown by the amber speaking border instead.
      // Fallback keeps voice audible on the no-bus path, where channels also fall back to
      // `context.destination` (see createUserChannel) — a Tone Gain's `.input` is the native
      // GainNode underneath it (Pattern 12).
      return masterBus?.getMasterInput() ?? channel.stereoEffectOutput?.input ?? null;
    },
  });
  private masterSection: MasterSection | null = null;
  private readonly context: AudioContext;

  constructor(audioContext: AudioContext) {
    this.context = audioContext;
    this.ensureToneContext();
    this.initializeMasterSection();
    void this.initializeAsync(audioContext);
  }

  private async initializeAsync(audioContext: AudioContext): Promise<void> {
    await EffectsFactory.initialize(audioContext);
    // Ensure Tone uses the same context
    this.ensureToneContext();
  }

  private ensureToneContext(): void {
    try {
      const toneCtx = getContext();
      if (toneCtx.rawContext !== this.context) {
        setContext(this.context);
      }
    } catch (error) {
      console.warn("[MixerEngine] Failed to align Tone.js context", error);
    }
  }

  // Expose the underlying AudioContext for sanity checks
  public getAudioContext(): AudioContext {
    return this.context;
  }

  private initializeMasterSection(): void {
    const masterBus = AudioContextManager.getMasterBus();
    if (!masterBus) return;

    const nodePool = AudioContextManager.getNodePool();
    const inputGain = nodePool?.getGainNode() || this.context.createGain();
    const outputGain = nodePool?.getGainNode() || this.context.createGain();
    const analyser = this.context.createAnalyser();

    // Connect master section
    inputGain.connect(outputGain);
    outputGain.connect(analyser);
    analyser.connect(masterBus.getMasterInput());

    this.masterSection = {
      inputGain,
      effectChain: [],
      outputGain,
      analyser,
    };
  }

  /** Create a mono-to-stereo converter using Haas effect for natural stereo width. */
  private createMonoToStereoConverter(): { input: GainNode; output: GainNode } {
    const inputGain = this.context.createGain();
    const splitter = this.context.createChannelSplitter(2);
    const merger = this.context.createChannelMerger(2);

    // Haas-effect stereo widening: 0.5ms left, 1.5ms right, 0.95× right gain
    const leftDelay = this.context.createDelay(0.1);
    const rightDelay = this.context.createDelay(0.1);
    leftDelay.delayTime.value = 0.0005;
    rightDelay.delayTime.value = 0.0015;

    const leftGain = this.context.createGain();
    const rightGain = this.context.createGain();
    leftGain.gain.value = 1.0;
    rightGain.gain.value = 0.95;

    // Output gain with explicit stereo configuration (CRITICAL for preserving stereo)
    const outputGain = this.context.createGain();
    outputGain.channelCount = 2;
    outputGain.channelCountMode = 'explicit';
    outputGain.channelInterpretation = 'speakers';

    // Connect the chain:
    // Mono input -> split to two identical channels
    inputGain.connect(splitter);

    // Left channel path: split[0] -> leftDelay -> leftGain -> merger[0]
    splitter.connect(leftDelay, 0);
    leftDelay.connect(leftGain);
    leftGain.connect(merger, 0, 0);

    // Right channel path: split[0] -> rightDelay -> rightGain -> merger[1]
    splitter.connect(rightDelay, 0);
    rightDelay.connect(rightGain);
    rightGain.connect(merger, 0, 1);

    // Merge to stereo output
    merger.connect(outputGain);

    // console.log('[MixerEngine] Created mono-to-stereo converter with stereo output');

    return { input: inputGain, output: outputGain };
  }

  /**
   * Create a user channel
   */
  createUserChannel(userId: string, username: string): UserChannel {
    const nodePool = AudioContextManager.getNodePool();
    // Native preGain bridge for incoming sources
    const inputGain = nodePool?.getGainNode() || this.context.createGain();
    const monitorTap = nodePool?.getGainNode() || this.context.createGain();
    monitorTap.gain.value = 1;

    // Create mono-to-stereo converter for proper stereo effect processing
    // This ensures all instruments (which are mono) get converted to true stereo
    const monoToStereo = this.createMonoToStereoConverter();

    // Connect input to mono-to-stereo converter
    inputGain.connect(monoToStereo.input);

    this.ensureToneContext();

    // Live volume/pan stage. Tone's Channel gives dB-native volume (accepts -Infinity for true
    // mute) and equal-power pan for free (TR-34 — reuse the maintained library instead of
    // hand-rolling a pan law). This used to sit here muted and unused for anything but metering,
    // fed by a separate hand-rolled linear-taper L/R GainNode network that did the real volume/pan
    // work; that network is gone and this is now the live stage.
    // `channelCount: 2` is REQUIRED: Tone's Channel/Panner default to `channelCount: 1` +
    // `channelCountMode: "explicit"`, which silently down-mixes stereo input to mono before
    // panning at every pan position (verified via OfflineAudioContext) — destroying Haas stereo
    // width, PingPongDelay's L/R alternation, AutoPanner, StereoWidener, and Chorus, plus a quiet
    // ~3dB unity-gain loudness drop. See MixerEngine.stereo.test.ts for the regression test.
    const toneChannel = new Channel({ volume: 0, pan: 0, channelCount: 2 });

    // Create main stereo output (after the volume/pan stage)
    const stereoEffectOutput = new Gain(1);
    connectNodes(toneChannel, stereoEffectOutput);

    // Route stereo output to master bus THROUGH a dedicated master send gain, so the channel can
    // be silenced in the main mix (masterSendGain→0) while `monitorTap` — tapped from
    // stereoEffectOutput in parallel — still feeds aux consumers (e.g. a Vocoder-ext carrier).
    // See setChannelMasterMuted.
    const masterSendGain = this.context.createGain();
    // Honor a mute already requested for this channel id before it existed (e.g. a Vocoder-ext
    // carrier-mute requested before the carrier synth was first played, on the performer's own
    // client or on a peer that just created this remote user's channel). setChannelMasterMuted
    // records the requester even when the channel is absent; without this the send would come up
    // at unity and stay audible until the next reconcile.
    const isAlreadyMuted = (this.masterMuteRequesters.get(userId)?.size ?? 0) > 0;
    masterSendGain.gain.value = isAlreadyMuted ? 0 : 1;
    connectNodes(stereoEffectOutput, masterSendGain);
    const masterBus = AudioContextManager.getMasterBus();
    if (masterBus) {
      // getMasterInput(), not getMasterGain(): channels land ahead of the master inserts and
      // the fader (DEV-323). Connecting to the fader would bypass every master effect.
      connectNodes(masterSendGain, masterBus.getMasterInput());
    } else {
      masterSendGain.connect(this.context.destination);
    }

    // Connect mono-to-stereo output into the volume/pan stage (default, no-effects path).
    // rebuildChannelChain repoints this if effects are inserted, exactly as it did for the old
    // stereo-balance splitter.
    connectNodes(monoToStereo.output, toneChannel);

    // Tone analyser for metering (post-channel)
    const analyser = new Analyser({ type: "waveform", size: 256, smoothing: 0.85 });
    connectNodes(stereoEffectOutput, analyser);

    // Native AnalyserNode tap, parallel to the Tone analyser above — feeds useMeterLevel's
    // consumers that need a raw Web Audio AnalyserNode (DEV-297/298). Additive only; does not touch `analyser` above.
    const nativeAnalyser = this.context.createAnalyser();
    nativeAnalyser.fftSize = 256;
    connectNodes(stereoEffectOutput, nativeAnalyser);
    // Post-channel monitor tap (parallel to the master send) — connected HERE, at creation, not
    // only in rebuildChannelChain. A channel with no effects never rebuilds, so without this its
    // monitorTap would carry no signal — which silently broke aux consumers whose source is a
    // clean, effect-less track (e.g. a Vocoder-ext carrier on a bare instrument track). Survives
    // rebuildChannelChain (which never disconnects stereoEffectOutput), so it's wired exactly once.
    connectNodes(stereoEffectOutput, monitorTap);

    const channel: UserChannel = {
      userId,
      username,
      inputGain,
      monoToStereoOutput: monoToStereo.output,
      monitorTap,
      toneChannel,
      stereoEffectOutput,
      masterSendGain,
      targetVolume: UNITY_DB, // Default = unity (0 dB)
      targetPan: 0, // Default pan = center
      effectChain: [],
      sends: new Map(),
      analyser,
      nativeAnalyser,
      voiceVolumeDb: UNITY_DB, // Separate control from targetVolume — see Global Constraints
    };

    this.userChannels.set(userId, channel);
    for (const listener of this.channelCreatedListeners) listener(userId);
    return channel;
  }

  /**
   * Add effect to user channel
   */
  addEffectToChannel(
    userId: string,
    effectType: EffectType,
    preventRebuild = false,
  ): AudioEffect | null {
    const channel = this.userChannels.get(userId);
    if (!channel) return null;

    const effect = EffectsFactory.createEffect(effectType);
    if (!effect) return null;

    // Add effect to chain
    channel.effectChain.push(effect);

    // Default path: patch only the two edges around the new effect (DEV-347 Task 1).
    // preventRebuild=true skips the edge patch, leaving the chain unwired until the
    // caller runs the full rebuild.
    if (!preventRebuild) {
      patchEffectIntoChainEnd(channel);
    }

    return effect;
  }

  private resolveEffectType(effectType: string): EffectType | null {
    const normalized = effectType.toLowerCase();
    const match = Object.values(EFFECT_TYPE).find(
      (value) => value.toLowerCase() === normalized,
    );
    return match ?? null;
  }

  applyEffectChainState(
    userId: string,
    effects: EffectInstanceState[],
    options?: { username?: string; createIfMissing?: boolean },
  ): void {
    let channel = this.userChannels.get(userId);
    if (!channel) {
      if (options?.createIfMissing === false) {
        return;
      }
      const username = options?.username || userId;
      channel = this.createUserChannel(userId, username);
    } else if (options?.username && channel.username !== options.username) {
      channel.username = options.username;
    }

    if (!channel) return; // eslint-disable-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions

    // Release existing effects to pool before rebuilding
    channel.effectChain.forEach((effect) => EffectsFactory.releaseEffect(effect));
    channel.effectChain = buildEffectChain(
      effects,
      (type) => this.resolveEffectType(type),
      `user ${userId}`,
    );

    this.rebuildChannelChain(channel);
  }

  /**
   * Build the Arrange master channel's effect chain and hand it to the bus (DEV-323).
   *
   * Mirrors `applyEffectChainState` above — release, rebuild from the sorted state, then wire —
   * but the destination is the master bus's insert point rather than a per-user channel, so
   * there is no channel to create and no volume/pan stage to route around.
   *
   * Effects live on `masterSection.effectChain`, which existed but had never carried signal:
   * nothing was routed through `masterSection`, so its chain was always empty. It does now.
   */
  applyMasterEffectChainState(effects: EffectInstanceState[]): void {
    const masterBus = AudioContextManager.getMasterBus();
    if (!masterBus || !this.masterSection) return;

    for (const effect of this.masterSection.effectChain) EffectsFactory.releaseEffect(effect);
    this.masterSection.effectChain = buildEffectChain(
      effects,
      (type) => this.resolveEffectType(type),
      'the master chain',
    );

    masterBus.setMasterInserts(
      this.masterSection.effectChain.map((effect) => ({
        inputNode: effect.inputNode,
        outputNode: effect.outputNode,
      })),
    );
  }

  removeUserChannel(userId: string): void {
    const channel = this.userChannels.get(userId);
    if (!channel) return;

    channel.effectChain.forEach((effect) => EffectsFactory.releaseEffect(effect));

    try { channel.inputGain.disconnect(); } catch { /* ignore */ }
    try { channel.toneChannel?.disconnect(); channel.toneChannel?.dispose(); } catch { /* ignore */ }
    try { channel.analyser?.dispose(); } catch { /* ignore */ }
    try { channel.nativeAnalyser?.disconnect(); } catch { /* ignore */ }
    try { channel.masterSendGain?.disconnect(); } catch { /* ignore */ }
    try { channel.voiceGain?.disconnect(); } catch { /* ignore */ }

    // Drop any master-mute requests for this channel: its source is gone, so the mute is
    // meaningless. The aux reconciler re-establishes it if the channel (and a consumer) return.
    this.masterMuteRequesters.delete(userId);

    this.userChannels.delete(userId);
  }

  /**
   * Remove effect from user channel
   */
  removeEffectFromChannel(userId: string, effectId: string, preventRebuild = false): boolean {
    const channel = this.userChannels.get(userId);
    if (!channel) return false;

    const effectIndex = channel.effectChain.findIndex(fx => fx.id === effectId);
    if (effectIndex === -1) return false;

    // Remove effect from chain
    const [removedEffect] = channel.effectChain.splice(effectIndex, 1);
    if (!removedEffect) {
      return false;
    }

    // Edge-patch BEFORE cleanup: the patch's last step disconnects
    // `removedEffect.outputNode`, so it must run while the effect's nodes are
    // still alive — cleanup may tear the effect's graph down (DEV-347 M2).
    // Real effects' cleanups disconnect their own nodes inside try/catch, so
    // the cleanup re-disconnecting already-disconnected nodes is harmless.
    // Default path: patch only the two edges around the removed effect (DEV-347 Task 1).
    // preventRebuild=true skips the edge patch, leaving the chain unwired until the
    // caller runs the full rebuild.
    if (!preventRebuild) {
      patchEffectOutOfChain(channel, removedEffect, effectIndex);
    }

    // Clean up the removed effect
    try {
      removedEffect.cleanup();
    } catch (error) {
      console.warn('Error cleaning up effect:', error);
    }

    return true;
  }

  /**
   * Rebuild channel chain publicly for batch processing (F16)
   */
  rebuildChannel(userId: string): void {
    const channel = this.userChannels.get(userId);
    if (channel) {
      this.rebuildChannelChain(channel);
    }
  }

  /** Rebuild the audio chain for a channel using unified stereo routing. */
  private rebuildChannelChain(channel: UserChannel): void {
    try {
      // Disconnect monoToStereoOutput if exists (it's fed by inputGain which stays connected)
      if (channel.monoToStereoOutput) {
        try {
          channel.monoToStereoOutput.disconnect();
        } catch {
          // May not be connected yet
        }
      }

      // Disconnect all existing effect output nodes to prevent stale parallel
      // connections. When effects are added one at a time (e.g. via
      // effectsIntegration during project load), each addEffectToChannel
      // triggers a rebuild that wires the last effect's output directly to
      // toneChannel (the volume/pan stage). Adding a subsequent effect leaves
      // that old output→toneChannel connection intact, creating a dry bypass
      // path around the new effect that leaks unprocessed signal to the output.
      for (const effect of channel.effectChain) {
        try {
          effect.outputNode.disconnect();
        } catch {
          // May not be connected yet
        }
      }

      // Unified routing: all audio goes through the volume/pan stage
      // Chain: monoToStereoOutput -> [effects] -> toneChannel -> stereoEffectOutput

      if (channel.effectChain.length === 0) {
        // No effects: connect directly to the volume/pan stage
        if (channel.toneChannel && channel.monoToStereoOutput) {
          connectNodes(channel.monoToStereoOutput, channel.toneChannel);
        }
      } else {
        // With effects: route through effect chain first
        let current: AudioNode = channel.monoToStereoOutput || channel.inputGain;

        for (const effect of channel.effectChain) {
          try {
            connectNodes(current, effect.inputNode);
            current = effect.outputNode;
          } catch (error) {
            console.warn('Failed to connect effect in chain:', error);
          }
        }

        // Connect final effect output to the volume/pan stage
        if (channel.toneChannel) {
          try {
            connectNodes(current, channel.toneChannel);
          } catch (error) {
            console.warn('Failed to connect to volume/pan stage:', error);
          }
        }
      }

      // Monitor tap is NOT reconnected (wired once in createUserChannel; rebuild never disconnects
      // stereoEffectOutput — reconnecting stacked duplicate edges and doubled the tapped level).
    } catch (error) {
      console.error('Error rebuilding channel chain:', error);
    }
  }

  /**
   * Route instrument to user channel
   */
  routeInstrumentToChannel(instrumentOutput: AudioNode, userId: string): void {
    const channel = this.userChannels.get(userId);
    if (!channel) return;
    // Route instrument output into preGain bridge
    try {
      // Use helper to handle ToneAudioNode <-> AudioNode or native pairs
      connectNodes(instrumentOutput, channel.inputGain);
    } catch {
      try { (instrumentOutput as { connect?: (dest: unknown) => void }).connect?.(channel.inputGain); } catch { /* ignore */ }
    }
  }

  /**
   * Get channel for user
   */
  getChannel(userId: string): UserChannel | undefined {
    return this.userChannels.get(userId);
  }

  getChannelMonitorTap(userId: string): GainNode | null {
    return this.userChannels.get(userId)?.monitorTap ?? null;
  }

  /** Native AnalyserNode tap for useMeterLevel's consumers (DEV-297/298); null if absent. */
  getUserAnalyserNode(userId: string): AnalyserNode | null {
    return this.userChannels.get(userId)?.nativeAnalyser ?? null;
  }
  /**
   * Subscribe to channel creation — fired after `createUserChannel` registers the channel.
   * Used by aux consumers (e.g. Vocoder-ext) to re-drive when a source/carrier channel appears.
   * Returns an unsubscribe function.
   */
  onChannelCreated(listener: (channelId: string) => void): () => void {
    this.channelCreatedListeners.add(listener);
    return () => {
      this.channelCreatedListeners.delete(listener);
    };
  }

  /**
   * Ref-counted master-send mute: silences a channel's `masterSendGain` while ≥1 requester holds
   * a mute; `monitorTap` is unaffected so aux consumers (e.g. Vocoder-ext) still receive the
   * signal. Safe to call before the channel exists — state is re-applied on next call.
   */
  setChannelMasterMuted(channelId: string, requesterId: string, muted: boolean): void {
    const requesters = this.masterMuteRequesters.get(channelId) ?? new Set<string>();
    if (muted) requesters.add(requesterId);
    else requesters.delete(requesterId);
    if (requesters.size > 0) this.masterMuteRequesters.set(channelId, requesters);
    else this.masterMuteRequesters.delete(channelId);

    // Always drive the send to the resolved state (idempotent). This also re-applies mute to a
    // freshly (re)created channel whose masterSendGain defaults to 1 while a requester is still
    // active — the aux reconciler re-invokes this on roster changes.
    const sendGain = this.userChannels.get(channelId)?.masterSendGain;
    if (!sendGain) return; // channel not live yet; reconciler re-applies when it appears
    sendGain.gain.setTargetAtTime(requesters.size > 0 ? 0 : 1, this.context.currentTime, 0.02);
  }

  /**
   * Set per-user output volume in dB. -Infinity is a true, uncapped mute — it bypasses the
   * -60..+12 clamp so a muted channel is verifiably silent, not merely quiet (DEV-295: mute is
   * -Infinity, never 0).
   */
  setUserVolume(userId: string, volumeDb: Decibels): void {
    const channel = this.userChannels.get(userId);
    if (!channel) return;
    const clamped =
      volumeDb === -Infinity
        ? volumeDb
        : toDecibels(Math.max(MIXER_VOLUME_MIN_DB, Math.min(MIXER_VOLUME_MAX_DB, volumeDb)));
    channel.targetVolume = clamped;
    this.applyChannelGains(channel);
  }

  /**
   * Set per-user pan (-1 = left, 0 = center, 1 = right). Applied via Tone's Channel.pan
   * (equal-power law, built in) through applyChannelGains — see there for the live stage.
   */
  setUserPan(userId: string, pan: number): void {
    const channel = this.userChannels.get(userId);
    if (!channel) return;

    const clampedPan = Math.max(-1, Math.min(1, pan));
    // Store target pan
    channel.targetPan = clampedPan;
    // Apply L/R gains using stored target values
    this.applyChannelGains(channel);
  }

  /**
   * Apply stored targetVolume/targetPan to the channel's live volume/pan stage. Assignment is
   * immediate (not ramped) — matches the previous implementation's setValueAtTime-at-currentTime
   * behavior exactly; no new smoothing is introduced here.
   */
  private applyChannelGains(channel: UserChannel): void {
    if (!channel.toneChannel) return;
    try {
      channel.toneChannel.volume.value = channel.targetVolume;
      channel.toneChannel.pan.value = channel.targetPan;
    } catch (error) {
      console.warn('Failed to apply channel volume/pan:', error);
    }
  }

  /**
   * Get per-user output volume in dB.
   */
  getUserVolume(userId: string): Decibels | null {
    const channel = this.userChannels.get(userId);
    if (!channel) return null;
    return channel.targetVolume;
  }

  /**
   * Get per-user panning
   */
  getUserPan(userId: string): number | null {
    const channel = this.userChannels.get(userId);
    if (!channel) return null;
    return channel.targetPan;
  }

  // Per-peer voice routing + volume: delegated to VoiceVolumeController (extracted for
  // TR-20 headroom). The voice feature registers its <audio> elements via
  // registerVoiceAudioElement / unregisterVoiceAudioElement (TR-38: engine never queries DOM).
  routeVoiceToChannel(voiceSource: AudioNode, userId: string): void {
    this.voiceVolume.routeVoiceToChannel(voiceSource, userId);
  }

  registerVoiceAudioElement(userId: string, element: HTMLAudioElement): void {
    this.voiceVolume.registerVoiceAudioElement(userId, element);
  }

  unregisterVoiceAudioElement(userId: string): void {
    this.voiceVolume.unregisterVoiceAudioElement(userId);
  }

  /**
   * Where remote voice lands relative to the master capture tap (DEV-325). The room layer
   * chooses; the engine stays room-agnostic (TR-38). Rewires peers already connected — the
   * mixer is a singleton that outlives a room change.
   */
  setVoiceRouting(routing: VoiceRouting): void {
    this.voiceVolume.setVoiceRouting(routing);
  }

  getVoiceRouting(): VoiceRouting {
    return this.voiceVolume.getVoiceRouting();
  }

  /** Per-peer remote-voice fader, dB (DEV-324) — same unit as setUserVolume, separate control. */
  setVoiceVolume(userId: string, volumeDb: Decibels): void {
    this.voiceVolume.setVoiceVolume(userId, volumeDb);
  }

  getVoiceVolume(userId: string): Decibels | null {
    return this.voiceVolume.getVoiceVolume(userId);
  }

  /**
   * Get approximate output level (RMS) for user [0..1]
   */
  getUserOutputLevel(userId: string): number | null {
    const channel = this.userChannels.get(userId);
    if (!channel || !channel.analyser) return null;
    try {
      const values = channel.analyser.getValue();
      if (values.length === 0) return 0;
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === undefined) {
          continue;
        }
        sum += (v as number) * (v as number);
      }
      const rms = Math.sqrt(sum / values.length);
      return Math.max(0, Math.min(1, rms));
    } catch {
      return null;
    }
  }

  /**
   * Cleanup mixer resources
   */
  cleanup(): void {
    // Cleanup user channels
    this.userChannels.forEach((channel) => {
      channel.effectChain.forEach((effect) =>
        EffectsFactory.releaseEffect(effect),
      );
      try { channel.inputGain.disconnect(); } catch { /* ignore */ }
      try { channel.toneChannel?.dispose(); } catch { /* ignore */ }
      try { channel.analyser?.dispose(); } catch { /* ignore */ }
      try { channel.nativeAnalyser?.disconnect(); } catch { /* ignore */ }
    });

    // Cleanup aux buses
    this.auxBuses.forEach((bus) => {
      bus.effectChain.forEach((effect) => EffectsFactory.releaseEffect(effect));
      bus.inputGain.disconnect();
      bus.outputGain.disconnect();
    });

    // Cleanup master section
    if (this.masterSection) {
      this.masterSection.effectChain.forEach((effect) =>
        EffectsFactory.releaseEffect(effect),
      );
      this.masterSection.inputGain.disconnect();
      this.masterSection.outputGain.disconnect();
      this.masterSection.analyser.disconnect();
    }

    this.userChannels.clear();
    this.auxBuses.clear();
    this.masterSection = null;
    this.voiceVolume.clear();
  }
}

// Singleton accessors for app-wide mixer instance
// eslint-disable-next-line @typescript-eslint/naming-convention
let __globalMixer: MixerEngine | null = null;

export async function getOrCreateGlobalMixer(): Promise<MixerEngine> {
  const context = await AudioContextManager.getInstrumentContext();
  // If a mixer exists but its context differs (e.g., Safari recreated context), rebuild it
  if (__globalMixer) {
    try {
      if (__globalMixer.getAudioContext() !== context) {
        __globalMixer.cleanup();
        __globalMixer = new MixerEngine(context);
      }
    } catch {
      // If anything goes wrong, recreate
      __globalMixer = new MixerEngine(context);
    }
    return __globalMixer;
  }
  __globalMixer = new MixerEngine(context);
  return __globalMixer;
}

export function getGlobalMixer(): MixerEngine | null {
  return __globalMixer;
}

// Allow callers to force-recreate the mixer on next access
export function resetGlobalMixer(): void {
  if (__globalMixer) {
    try {
      __globalMixer.cleanup();
    } catch {
      // ignore cleanup errors during reset
    }
  }
  __globalMixer = null;
}

/**
 * Usage Example:
 *
 * // Initialize mixer
 * const audioContext = AudioContextManager.getInstrumentContext();
 * const mixer = new MixerEngine(audioContext);
 *
 * // Create user channels
 * const userChannel = mixer.createUserChannel('user1', 'Alice');
 *
 * // Add effects
 * const reverb = mixer.addEffectToChannel('user1', EFFECT_TYPE.REVERB);
 * reverb?.setParameter('wetLevel', 0.4);
 *
 * // Route instrument
 * mixer.routeInstrumentToChannel(toneJsSynth, 'user1');
 *
 * // The WebRTC voice remains separate and unprocessed for lowest latency
 */

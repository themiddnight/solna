import type { ActiveSynth, EnginePatch, LfoParams, SynthEngineId } from '@/types/synth';
import type { VoiceOwner } from '../voiceOwner';
import type { VoiceDiagnosticSnapshot } from '../diagnostics';
import type { LfoVoiceHandle } from './synthLfo';
import {
  createSubtractiveVoice,
  type SubtractiveVoiceDestinations,
  type SubtractiveVoiceEvent,
} from './subtractiveVoice';
import { createVoiceIdAllocator, type VoiceId } from './voiceId';

/**
 * Voice allocation: who holds which sounding voice, Mono legato, Poly
 * stealing, and the two-stage teardown a scheduled release needs (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "Engine and voice lifecycle").
 *
 * Four rules this file exists to keep:
 *
 * 1. **A voice is addressed by its own id, never by source and note.** The
 *    legacy engine keyed `activeVoices` by `` `${source}:${noteName}` ``, so
 *    the arp, the live keyboard and the melody sequencer cut each other's
 *    notes short whenever two of them sounded the same note on one bus —
 *    recorded in CLAUDE.md as a known deferred defect, and this module is the
 *    fix. `noteOn` returns a `VoiceId`; `noteOff` takes one.
 * 2. **Whole-bus reach requires calling a method whose name says so.**
 *    `noteOff` reaches one voice, `releaseOwner` reaches one player's voices
 *    on one bus, `stopSource` reaches the whole bus — and none of them is
 *    reachable by leaving an argument off another, which is the scar
 *    `stopOwnedVoices` and `applySynthVelocityScale` already carry.
 * 3. **Teardown is two stages, because `disconnect()` cannot be scheduled.**
 *    A release schedules the amp envelope and the source stop on the AUDIO
 *    clock, and cuts the graph only once the tail has actually elapsed in
 *    WALL time. Under an `OfflineAudioContext` the graph is never cut at all:
 *    an offline render may run slower than wall time, so a timer would
 *    disconnect a voice before the offline timeline reached it — the whole
 *    throwaway context is discarded when the render ends instead.
 * 4. **Every high-frequency thing here stays here.** Held notes, the mono
 *    stack and the per-source budget are audio-rate state; `src/audio/` may
 *    not import `src/store/`, and publishing any of this to a slice would
 *    re-render every mounted view on every key-down.
 *
 * 5. **There is no wall-clock voice-lifetime backstop, and that is a decision.**
 *    The flat engine armed a 30-second `setTimeout` per voice that forced it
 *    through the release path if no note-off ever arrived. It is not restored
 *    here. Most of the case it guarded is closed at the call sites: nearly
 *    every `triggerSynthNoteOn` in the app schedules its `triggerSynthNoteOff`
 *    inside the same synchronous block, on the audio clock — the arp
 *    (`arpPlayback.ts`), the preview (`presetPreview.ts`), all four sequencer
 *    bridges and the offline render — so for those there is no later event
 *    that can fail to arrive.
 *
 *    TWO paths are exceptions, not one, and only one of them is covered.
 *    Live keyboard input's note-off comes from a key-up, and that path carries
 *    its own purpose-built backstop: `useInputDeck.ts` releases every held note
 *    on `window` blur and on `visibilitychange`, which is the exact scenario
 *    the old timer named. The held chord preview does NOT.
 *    `playChordLegato` (`chordPlayback.ts`) strikes every note of a chord,
 *    schedules no note-off at all and DROPS the `VoiceId`s it is handed;
 *    release is `stopSource('chord')` from a pointer event
 *    (`useChordView.ts`), and `useInputDeck`'s backstop cannot help — it
 *    releases the notes the KEYBOARD is holding and knows nothing about a
 *    chord held with the mouse. What narrows it instead is that every surface
 *    binds `onMouseLeave` and `onTouchEnd` beside `onMouseUp`
 *    (`moduleFields.tsx`, `ProgressionCard.tsx`, `SortableChordCard.tsx`), and
 *    that `playChordLegato`'s own first statement is
 *    `stopSource('chord', 0.05)` — so anything a lost pointer-up did strand is
 *    cut by the next preview, and by any loop load, project install or vibe
 *    swap, all of which stop that bus. Narrowed and bounded, not closed: if it
 *    ever needs closing, the fix is a blur/`visibilitychange` backstop for the
 *    chord preview beside `useInputDeck`'s, NOT a timer in here.
 *
 *    Two further reasons a timer is not merely redundant but wrong here, and
 *    these hold whatever the call sites do. The defect that
 *    made a timer NECESSARY is gone: the flat engine keyed voices by
 *    `` `${source}:${noteName}` ``, so a note-off could address the wrong
 *    instance and strand the right one with nothing able to reach it, while a
 *    `VoiceId` addresses one instance and `forgetGroup` deregisters it. And the
 *    manager cannot tell a STUCK voice from a HELD one — nothing in here knows
 *    whether a bridge still intends to release — so any cap it applied would be
 *    as blunt as the old one and would cut a pad a player is legitimately
 *    holding past the timeout. What DOES bound this module is the per-source
 *    budget (`maxVoicesPerSource`), and that bounds the voice COUNT, not a
 *    voice's lifetime: do not read it as a leak guard. If a voice ever does
 *    drone, the bridge dropped its `VoiceId` — trace the bridge.
 *
 * Routing an LFO is NOT this module's job — `SynthLfoBank` owns destinations
 * and generators. What this module owns is WHEN a voice joins the bank and
 * when it leaves: at note-on, and at the same instant the graph is cut.
 */

/**
 * The slice of a voice the manager drives. Narrower than `SubtractiveVoice`
 * on purpose: the manager never touches an audio node, so a test can hand it
 * a recording double without building a graph, and a second engine's voice
 * only has to satisfy this to be allocatable. `SubtractiveVoice` satisfies it
 * structurally — `voiceFactoryFor` below is where that is checked.
 */
export interface ManagedVoice extends LfoVoiceHandle {
  readonly owner: VoiceOwner;
  readonly frequency: number;
  readonly startedAt: number;
  release(at: number, seconds: number): void;
  glideTo(frequency: number, at: number, seconds: number): void;
  update(previous: EnginePatch<'subtractive'>, next: EnginePatch<'subtractive'>, at: number): void;
  /** Ramps this voice's polyphony gain — see `SynthVoiceManager.setPolyphonyScale`. */
  setPolyphonyScale(scale: number, at: number): void;
  stopSources(at: number): void;
  disconnect(): void;
}

export type SynthVoiceFactory = (
  ctx: BaseAudioContext,
  patch: EnginePatch<'subtractive'>,
  event: SubtractiveVoiceEvent,
  destinations: SubtractiveVoiceDestinations,
) => ManagedVoice;

/**
 * The `SynthLfoBank` calls this manager owns: the two voice-lifecycle events,
 * plus the one channel-level live edit.
 *
 * `updateSource` is here because this manager is the only thing that sees a
 * patch CHANGE — a bus, the params before and the params after — and the bank
 * cannot reconfigure a running LFO without all three. Leaving it out is how
 * the LFO shipped with no live-edit path at all: a knob move reached the
 * patch, the patch reached `updatePatch`, and the LFO half of it stopped
 * there, so a rate or waveform edit took effect on no voice and on no
 * subsequent note either (a transport channel's generator is cached).
 */
interface VoiceLfoBank {
  connectVoice(voice: LfoVoiceHandle, params: LfoParams, at: number): void;
  disconnectVoice(voice: LfoVoiceHandle): void;
  retireVoiceOffline(voice: LfoVoiceHandle, at: number): void;
  updateSource(source: string, previous: LfoParams, next: LfoParams, at: number): void;
}

/**
 * Books `callback` `delayMs` from now and returns a cancel function. A cancel
 * FUNCTION rather than an opaque handle, so the manager never has to name a
 * timer type and a test's double is three lines.
 */
export type TeardownSchedule = (callback: () => void, delayMs: number) => () => void;

export interface SynthVoiceNoteOn {
  source: string;
  owner: VoiceOwner;
  /** The pitch to sound, in Hz, resolved by the caller — see `SubtractiveVoiceEvent.frequency`. */
  frequency: number;
  velocity: number;
  at: number;
  /**
   * Multiplies every envelope SEGMENT TIME, not the level — see
   * `SubtractiveVoiceEvent.scaleFactor`, which explains why the legacy
   * engine's argument of the same name meant the opposite thing. Every caller
   * passes 1 today.
   */
  scaleFactor?: number;
  synth: ActiveSynth;
}

export interface SynthVoiceManagerOptions {
  ctx: BaseAudioContext;
  /**
   * Where this bus's voices go, or `null` if the bus does not exist yet —
   * which is a normal state before the first user click creates the
   * `AudioContext`, not an error, so a note-on then returns `null` rather
   * than throwing.
   */
  destinationsFor(source: string): SubtractiveVoiceDestinations | null;
  createVoice?: SynthVoiceFactory;
  lfoBank?: VoiceLfoBank | null;
  maxVoicesPerSource?: number;
  schedule?: TeardownSchedule;
}

/**
 * How long a stolen or hard-stopped voice gets to reach silence. Not zero: a
 * gain cut to silence on the instant is a click, and the point of stealing is
 * to free a slot, not to announce it.
 */
const FAST_RELEASE_SECONDS = 0.02;

/**
 * The same per-source ceiling the legacy engine used. Per SOURCE rather than
 * global so a busy pad bus can never steal the bass line's voices.
 */
const DEFAULT_MAX_VOICES_PER_SOURCE = 24;

const defaultSchedule: TeardownSchedule = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

/**
 * `startRendering` is `OfflineAudioContext`'s defining member and the one
 * thing a realtime `AudioContext` does not have. Duck-typed rather than
 * `instanceof` because the offline mixdown render and the test doubles both
 * have to answer this the same way, and neither is a DOM class.
 */
function isOfflineContext(ctx: BaseAudioContext): boolean {
  return typeof (ctx as { startRendering?: unknown }).startRendering === 'function';
}

/**
 * The engine registry. One member today, and a `switch` rather than a record
 * so adding an engine is a compile error here until its factory exists.
 */
function voiceFactoryFor(engine: SynthEngineId): SynthVoiceFactory {
  switch (engine) {
    case 'subtractive':
      return createSubtractiveVoice;
  }
}

/**
 * Whether the voices sounding under `previous` could still be the right voices
 * under `next`. Two answers make them wrong, and both are in the design doc's
 * one-line rule: a different voice MODE (a Poly voice has no mono stack and a
 * mono voice is shared by every held note) and a different ENGINE (a different
 * graph entirely). The engine half is unreachable while `SynthEngineId` has one
 * member; it is written because the rule is about the engine as much as the
 * mode, and the day a second engine lands it must already be true.
 */
function changesTopology(previous: ActiveSynth, next: ActiveSynth): boolean {
  return (
    previous.engine !== next.engine ||
    previous.patch.common.voiceMode !== next.patch.common.voiceMode
  );
}

/**
 * One note-on's worth of physical voices — a unison stack is N voices under
 * one logical identity, so raising Voices never changes how many things a
 * note-off has to address.
 *
 * `stolen` is separate from `releasing` because the budget counts them
 * differently: a releasing voice still occupies its slot until its tail ends,
 * but a STOLEN one has already been told to get out of the way, and counting
 * it would have the next note-on steal a second voice for the same overflow.
 */
interface VoiceGroup {
  readonly id: VoiceId;
  readonly source: string;
  readonly owner: VoiceOwner;
  readonly startedAt: number;
  readonly voices: ManagedVoice[];
  /** This group's own amp release, the default `releaseOwner` falls back to. */
  readonly ampReleaseSeconds: number;
  frequency: number;
  releasing: boolean;
  stolen: boolean;
  cancelTeardown: (() => void) | null;
  /**
   * The AUDIO-clock instant the release tail ends, kept beside the wall-clock
   * timer that is waiting for it. The two measure different things and drift
   * apart whenever the context is suspended, so re-arming needs the audio time
   * the timer was derived from, not the timer's own remaining delay.
   */
  teardownAt: number | null;
}

/** One held note on a Mono channel. The ID is what makes the stack owner-safe. */
interface MonoEntry {
  id: VoiceId;
  frequency: number;
  owner: VoiceOwner;
}

/**
 * A Mono bus: ONE sounding group, and the stack of notes currently held on
 * it. Every entry carries its own `VoiceId`, so removing one is an exact
 * match on that id — a stack keyed by note name would let the arp's key-up on
 * C4 pop the live player's C4, which is the same defect at one level up.
 */
interface MonoChannel {
  group: VoiceGroup;
  stack: MonoEntry[];
  glideSeconds: number;
}

type Registration = { kind: 'poly'; group: VoiceGroup } | { kind: 'mono'; source: string };

export class SynthVoiceManager {
  private disposed = false;
  private ctx: BaseAudioContext | null;
  private readonly options: Omit<SynthVoiceManagerOptions, 'ctx'>;
  private readonly groups = new Map<string, Set<VoiceGroup>>();
  private readonly mono = new Map<string, MonoChannel>();
  private readonly registered = new Map<VoiceId, Registration>();
  private readonly nextVoiceId = createVoiceIdAllocator();
  private readonly schedule: TeardownSchedule;
  private readonly offline: boolean;

  constructor(options: SynthVoiceManagerOptions) {
    const { ctx, ...rest } = options;
    this.ctx = ctx;
    this.options = rest;
    this.schedule = rest.schedule ?? defaultSchedule;
    this.offline = isOfflineContext(ctx);
  }

  /** Hard-stops and detaches every physical voice owned by this generation. */
  dispose(at = this.ctx?.currentTime ?? 0): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sourceGroups of this.groups.values()) {
      for (const group of sourceGroups) {
        group.cancelTeardown?.();
        group.cancelTeardown = null;
        group.teardownAt = null;
        for (const voice of group.voices) {
          voice.stopSources(at);
          this.options.lfoBank?.disconnectVoice(voice);
          voice.disconnect();
        }
      }
    }
    this.mono.clear();
    this.registered.clear();
    this.groups.clear();
    this.ctx = null;
  }

  /** Whether this id still names a voice the manager holds. */
  has(id: VoiceId): boolean {
    return this.registered.has(id);
  }

  /**
   * Every PHYSICAL voice currently allocated, including those still in a
   * release tail — a dying voice is still costing a graph.
   */
  liveVoiceCount(): number {
    let total = 0;
    for (const groups of this.groups.values()) {
      for (const group of groups) total += group.voices.length;
    }
    return total;
  }

  diagnosticSnapshot(): VoiceDiagnosticSnapshot {
    const bySource: Record<string, number> = {};
    let groups = 0;
    let physicalVoices = 0;
    for (const [source, sourceGroups] of this.groups) {
      groups += sourceGroups.size;
      const sourceVoices = [...sourceGroups].reduce((total, group) => total + group.voices.length, 0);
      physicalVoices += sourceVoices;
      if (sourceVoices > 0) bySource[source] = sourceVoices;
    }
    return { groups, physicalVoices, registered: this.registered.size, bySource };
  }

  /**
   * Re-books every pending teardown against the audio clock as it reads NOW.
   *
   * A teardown is a WALL-clock timer waiting out an AUDIO-clock tail. Suspend
   * the context and the two diverge: wall time keeps running while
   * `currentTime` stands still, so on resume every pending timer is early by
   * however long the suspend lasted and would cut the graph in the middle of a
   * release ramp. Called on every resume — the engine's idle wake and
   * `init()`'s resume path, which covers a backgrounded tab the browser
   * suspended.
   *
   * Offline is exempt for the same reason teardown itself is: a render has no
   * wall clock and cuts no graph.
   */
  rearmTeardowns(): void {
    if (this.disposed || this.offline) return;
    for (const groups of this.groups.values()) {
      for (const group of groups) {
        if (!group.cancelTeardown || group.teardownAt === null) continue;
        this.scheduleTeardown(group, group.teardownAt);
      }
    }
  }

  noteOn(input: SynthVoiceNoteOn): VoiceId | null {
    if (this.disposed || !this.ctx) return null;
    const destinations = this.options.destinationsFor(input.source);
    if (!destinations) return null;
    return input.synth.patch.common.voiceMode === 'mono'
      ? this.monoNoteOn(input, destinations)
      : this.polyNoteOn(input, destinations);
  }

  noteOff(id: VoiceId, at: number, releaseSeconds: number): void {
    const registration = this.registered.get(id);
    if (!registration) return;
    this.registered.delete(id);
    if (registration.kind === 'poly') {
      this.releaseGroup(registration.group, at, releaseSeconds);
      return;
    }
    this.monoRelease(registration.source, at, releaseSeconds, (entry) => entry.id === id);
  }

  /**
   * Releases everything one player holds on one bus, leaving every other
   * player's voices sounding. `releaseSeconds` defaults per group to the amp
   * release its own patch was built with.
   */
  releaseOwner(source: string, owner: VoiceOwner, at: number, releaseSeconds?: number): void {
    const channel = this.mono.get(source);
    for (const group of [...(this.groups.get(source) ?? [])]) {
      if (group.releasing || group.owner !== owner || group === channel?.group) continue;
      this.registered.delete(group.id);
      this.releaseGroup(group, at, releaseSeconds ?? group.ampReleaseSeconds);
    }
    if (!channel) return;
    for (const entry of channel.stack) {
      if (entry.owner === owner) this.registered.delete(entry.id);
    }
    this.monoRelease(
      source,
      at,
      releaseSeconds ?? channel.group.ampReleaseSeconds,
      (entry) => entry.owner === owner,
    );
  }

  /**
   * Silences a whole bus whatever is on it — a project install, a loop load,
   * a vibe swap. Everything, every owner, including voices already in a
   * release tail.
   */
  stopSource(source: string, at: number, releaseSeconds = FAST_RELEASE_SECONDS): void {
    const channel = this.mono.get(source);
    if (channel) {
      for (const entry of channel.stack) this.registered.delete(entry.id);
      this.mono.delete(source);
    }
    for (const group of [...(this.groups.get(source) ?? [])]) {
      this.registered.delete(group.id);
      if (group.stolen) continue;
      this.stealGroup(group, at, releaseSeconds);
    }
  }

  /**
   * `stopSource` narrowed to one player: the voices that player has sounding
   * AND the hits it has already booked ahead of the transport, and nothing
   * else on the bus. What a melody grid's stop needs, since it shares its bus
   * with the live keyboard and the arp.
   *
   * Deliberately NOT `releaseOwner` with a different time argument.
   * `releaseOwner` skips a group that is already releasing — that is exactly
   * what keeps an arp key-up from cancelling notes the clock has planned —
   * and a transport stop has to reach those groups. Two different questions,
   * so two methods rather than one with a flag: whole-bus and whole-player
   * reach must each be named by the method that has it.
   */
  stopOwner(source: string, owner: VoiceOwner, at: number, releaseSeconds = FAST_RELEASE_SECONDS): void {
    const channel = this.mono.get(source);
    if (channel) this.stopOwnerOnChannel(source, channel, owner, at, releaseSeconds);
    for (const group of [...(this.groups.get(source) ?? [])]) {
      // The mono channel's own group is settled above and must not be reached
      // again here: it is SHARED, so stealing it because its builder stopped
      // would silence the notes every other player is still holding on the bus.
      if (group === channel?.group || group.owner !== owner || group.stolen) continue;
      this.stealGroup(group, at, releaseSeconds);
    }
  }

  /**
   * One owner's half of a mono channel, which is a SHARED instrument: several
   * players hold notes on one voice, and `group.owner` records only which of
   * them happened to build it.
   *
   * That is why the decision below is taken on the STACK and never on
   * `group.owner`. Two failures came from reading the owner instead. A channel
   * that had glided onto another player's note still reported its builder, so
   * stopping the player actually holding it emptied the stack and left a
   * sounding voice nothing could reach. And dropping the whole channel because
   * its builder stopped left every other player's id in `registered` — `has`
   * answering true for a voice `noteOff` can no longer resolve, which is the
   * one thing teardown exists to prevent.
   */
  private stopOwnerOnChannel(
    source: string,
    channel: MonoChannel,
    owner: VoiceOwner,
    at: number,
    releaseSeconds: number,
  ): void {
    const kept = channel.stack.filter((entry) => entry.owner !== owner);
    if (kept.length === channel.stack.length) return;
    for (const entry of channel.stack) {
      if (entry.owner === owner) this.registered.delete(entry.id);
    }
    if (kept.length > 0) {
      // Someone else is still holding the bus, so the voice plays on for them
      // and follows whatever note is now on top.
      channel.stack = kept;
      const top = kept[kept.length - 1];
      if (top.frequency !== channel.group.frequency) this.glideChannel(channel, top.frequency, at);
      return;
    }
    // Nothing holds it any more. Unlike `monoRelease`, this cuts a group that
    // is ALREADY releasing too — a transport stop has to reach the tail it
    // booked, which is the whole reason `stopOwner` is not `releaseOwner`.
    this.mono.delete(source);
    if (!channel.group.stolen) this.stealGroup(channel.group, at, releaseSeconds);
  }

  /**
   * Equal-power polyphony: holds one bus's total level flat as keys are added
   * to it, by ramping every sounding voice's dedicated polyphony gain.
   *
   * On a gain of its OWN, downstream of the amp envelope, because the envelope
   * cannot be re-planned mid-note without a click — the legacy engine folded
   * this into the envelope's peak and had to cancel and re-plan every held
   * voice's ramps to move it.
   *
   * A group already RELEASING is skipped, which is what keeps this a live-input
   * concern: every sequenced hit books its release at scheduling time, so a
   * key-down can never duck the notes the transport is playing, and a key-up
   * can never re-lift a tail that is already fading.
   *
   * `source` is required, and the whole method is per bus. A scale applied
   * across buses would duck the chord, bass and pad layers under a held
   * keyboard note — the exact reach the legacy method's own required `source`
   * was added to close.
   */
  setPolyphonyScale(source: string, scale: number, at: number): void {
    // A mono bus is exempt: `monoNoteOn` glides the ONE existing group instead
    // of building a second, so a second held key adds no voice and the scale
    // would be pure attenuation — three fingers legato on the Bass default
    // would duck the single sounding voice by 4.8 dB mid-phrase. The count
    // belongs to the caller (`useInputDeck` counts KEYS) and the mode belongs
    // here, because `src/components/` may not read a patch's topology.
    if (this.mono.has(source)) return;
    for (const group of this.groups.get(source) ?? []) {
      if (group.releasing || group.stolen) continue;
      for (const voice of group.voices) voice.setPolyphonyScale(scale, at);
    }
  }

  /**
   * Silences every voice on a bus whose note-on is at or after `time`,
   * whoever created it, and leaves everything already sounding alone.
   *
   * The seamless loop switch: the next loop's material is scheduled a bar
   * ahead, so a load at the boundary has to withdraw hits that have been
   * booked but not yet heard while the bar still playing runs out its own
   * notes. Addressed by SCHEDULED TIME rather than by owner, because a
   * boundary is a fact about the clock and not about who wrote the note.
   */
  dropScheduledFrom(source: string, time: number): void {
    const channel = this.mono.get(source);
    if (channel && channel.group.startedAt >= time) {
      for (const entry of channel.stack) this.registered.delete(entry.id);
      this.mono.delete(source);
    }
    for (const group of [...(this.groups.get(source) ?? [])]) {
      if (group.stolen || group.startedAt < time) continue;
      this.stealGroup(group, time);
    }
  }

  /**
   * Applies a patch change to every voice sounding on one bus.
   *
   * Two outcomes. A change of voice MODE or of ENGINE (`changesTopology`)
   * quickly releases the bus (design doc, "Engine and voice lifecycle"): the
   * voices sounding were allocated under the old topology, and neither a Poly
   * voice nor another engine's voice can be turned into a Mono one by moving a
   * parameter. A Mono bus also has a held-note stack that would otherwise
   * survive the change and have the next note glide a voice that no longer
   * exists under the new mode.
   *
   * **A preset install also stops the bus, and this is not where that is
   * decided** — `store/installSynthPreset.ts` stops it before the patch is ever
   * written. This method used to decide it here by comparing `sourcePresetId`,
   * which cannot work: every edit path preserves that id, so a knob move and a
   * re-pick of the preset being edited reach here identical in the only field
   * that was being read. Intent is only knowable at the caller. Do not
   * reintroduce a patch-comparing predicate for it.
   *
   * Either way the bus's LFO is reconfigured first — see the comment on the
   * call and on `VoiceLfoBank.updateSource`.
   *
   * Anything else is a live update: only the continuous controls move —
   * `SubtractiveVoice.update` decides which — so envelope timing and unison
   * count still take effect on the next note rather than rebuilding a graph
   * under a sounding envelope.
   */
  updatePatch(source: string, previous: ActiveSynth, next: ActiveSynth, at: number): void {
    // Ahead of the topology branch deliberately: an LFO edit that arrives in
    // the same patch change as a voice-mode change still has to land, and the
    // bank's own no-channel guard makes the call a no-op when this bus has no
    // LFO to reconfigure. The bank owns which of rate, waveform, depth and
    // target needs a rebuild and which needs only a rewrite.
    // Reference inequality, not a deep compare: every panel writes the patch
    // immutably and leaves the branches it did not touch by reference, so an
    // unchanged `synth.lfo` IS the same object. Without this guard a filter or
    // envelope drag — 7 of the 8 Pro modules — reached `updateSource` 60x a
    // second, which spreads the bank's whole cross-bus voice map and writes an
    // AudioParam event per sounding voice onto a gain whose value did not move.
    if (previous.patch.synth.lfo !== next.patch.synth.lfo) {
      this.options.lfoBank?.updateSource(source, previous.patch.synth.lfo, next.patch.synth.lfo, at);
    }
    if (changesTopology(previous, next)) {
      this.stopSource(source, at);
      return;
    }
    const channel = this.mono.get(source);
    if (channel) channel.glideSeconds = Math.max(0, next.patch.common.glideSeconds);
    for (const group of this.groups.get(source) ?? []) {
      for (const voice of group.voices) voice.update(previous.patch, next.patch, at);
    }
  }

  private polyNoteOn(input: SynthVoiceNoteOn, destinations: SubtractiveVoiceDestinations): VoiceId {
    const id = this.nextVoiceId();
    const group = this.createGroup(id, input, destinations);
    this.registered.set(id, { kind: 'poly', group });
    this.enforceBudget(group, input.at);
    return id;
  }

  /**
   * A note landing on a bus that is already sounding BENDS it: the same
   * physical voices glide to the new note and no envelope restarts. Only a
   * bus with nothing held builds a voice.
   */
  private monoNoteOn(input: SynthVoiceNoteOn, destinations: SubtractiveVoiceDestinations): VoiceId {
    const id = this.nextVoiceId();
    const entry: MonoEntry = { id, frequency: input.frequency, owner: input.owner };
    const glideSeconds = Math.max(0, input.synth.patch.common.glideSeconds);
    const channel = this.mono.get(input.source);
    if (channel && channel.stack.length > 0) {
      channel.glideSeconds = glideSeconds;
      channel.stack.push(entry);
      this.glideChannel(channel, input.frequency, input.at);
    } else {
      const group = this.createGroup(this.nextVoiceId(), input, destinations);
      this.mono.set(input.source, { group, stack: [entry], glideSeconds });
      this.enforceBudget(group, input.at);
    }
    this.registered.set(id, { kind: 'mono', source: input.source });
    return id;
  }

  private createGroup(
    id: VoiceId,
    input: SynthVoiceNoteOn,
    destinations: SubtractiveVoiceDestinations,
  ): VoiceGroup {
    const ctx = this.ctx;
    if (!ctx) throw new Error('SynthVoiceManager is disposed');
    const { patch } = input.synth;
    const create = this.options.createVoice ?? voiceFactoryFor(input.synth.engine);
    const scaleFactor = input.scaleFactor ?? 1;
    const unisonVoices = Math.max(1, Math.round(patch.common.unisonVoices));
    const voices: ManagedVoice[] = [];
    for (let unisonIndex = 0; unisonIndex < unisonVoices; unisonIndex += 1) {
      const event: SubtractiveVoiceEvent = {
        source: input.source,
        owner: input.owner,
        frequency: input.frequency,
        velocity: input.velocity,
        at: input.at,
        unisonIndex,
        scaleFactor,
      };
      const voice = create(ctx, patch, event, destinations);
      this.options.lfoBank?.connectVoice(voice, patch.synth.lfo, input.at);
      voices.push(voice);
    }
    const group: VoiceGroup = {
      id,
      source: input.source,
      owner: input.owner,
      startedAt: input.at,
      voices,
      ampReleaseSeconds: patch.synth.ampEnvelope.release * scaleFactor,
      frequency: input.frequency,
      releasing: false,
      stolen: false,
      cancelTeardown: null,
      teardownAt: null,
    };
    let groups = this.groups.get(input.source);
    if (!groups) {
      groups = new Set();
      this.groups.set(input.source, groups);
    }
    groups.add(group);
    return group;
  }

  private glideChannel(channel: MonoChannel, frequency: number, at: number): void {
    for (const voice of channel.group.voices) voice.glideTo(frequency, at, channel.glideSeconds);
    channel.group.frequency = frequency;
  }

  /**
   * Drops every stack entry `matches` accepts. An emptied stack releases the
   * voice; a stack with anything left bends back to the note most recently
   * held, which is what makes a trill on a mono lead sound like one.
   */
  private monoRelease(
    source: string,
    at: number,
    releaseSeconds: number,
    matches: (entry: MonoEntry) => boolean,
  ): void {
    const channel = this.mono.get(source);
    if (!channel) return;
    const kept = channel.stack.filter((entry) => !matches(entry));
    if (kept.length === channel.stack.length) return;
    channel.stack = kept;
    if (kept.length === 0) {
      this.mono.delete(source);
      this.releaseGroup(channel.group, at, releaseSeconds);
      return;
    }
    const top = kept[kept.length - 1];
    if (top.frequency !== channel.group.frequency) this.glideChannel(channel, top.frequency, at);
  }

  private releaseGroup(group: VoiceGroup, at: number, releaseSeconds: number): void {
    if (group.releasing) return;
    this.silenceGroup(group, at, Math.max(0, releaseSeconds));
  }

  /**
   * Takes a voice's slot back. Re-releasing a voice already in a long tail is
   * the point, not a redundancy: the tail is what is occupying the slot.
   * `stopSources` is idempotent in the voice, so a second, earlier stop does
   * NOT move the first one — the graph is cut at the earlier time instead,
   * which reaches silence just the same because the amp envelope is already
   * there.
   */
  private stealGroup(group: VoiceGroup, at: number, releaseSeconds = FAST_RELEASE_SECONDS): void {
    group.stolen = true;
    // Deregistered on the spot, not at teardown: from here the id names a
    // voice that is already on its way out, and leaving it registered would
    // have `has()` answer true for a voice nothing can address any more.
    this.registered.delete(group.id);
    this.silenceGroup(group, at, releaseSeconds);
  }

  private silenceGroup(group: VoiceGroup, at: number, releaseSeconds: number): void {
    for (const voice of group.voices) {
      voice.release(at, releaseSeconds);
      voice.stopSources(at + releaseSeconds);
    }
    group.releasing = true;
    this.scheduleTeardown(group, at + releaseSeconds);
  }

  private scheduleTeardown(group: VoiceGroup, endsAt: number): void {
    group.cancelTeardown?.();
    group.cancelTeardown = null;
    group.teardownAt = endsAt;
    if (this.offline) {
      // Rule 3 in this file's header: no timer and no disconnect offline. The
      // sources are already stopped on the audio clock, so forgetting the
      // group now is the whole of teardown — and it has to happen now, or a
      // long render would accumulate dead groups until the budget started
      // stealing voices that are still playing.
      //
      // The BANK still needs telling, and rule 3's reasoning does not cover
      // it. "The throwaway context is discarded whole" retires the voice's own
      // graph, but a note-triggered LFO's generator is built by the bank and
      // stopped nowhere else: `startNoteVoice` schedules no stop, so without
      // this the oscillator free-ran to the end of the render and the bank's
      // voice map — which its three lookups spread in full — grew one entry per
      // note ever played, climbing render cost with the square of song length.
      // `retireVoiceOffline` is the narrow form that is safe here: it drops the
      // bookkeeping and schedules the generator's stop at `endsAt`, and touches
      // no edge, because this branch runs while the render is still being
      // SCHEDULED and a disconnect would cut the graph before sample zero.
      for (const voice of group.voices) this.options.lfoBank?.retireVoiceOffline(voice, endsAt);
      this.forgetGroup(group);
      return;
    }
    const delayMs = Math.max(0, (endsAt - (this.ctx?.currentTime ?? endsAt)) * 1000);
    group.cancelTeardown = this.schedule(() => this.finishTeardown(group), delayMs);
  }

  private finishTeardown(group: VoiceGroup): void {
    group.cancelTeardown = null;
    group.teardownAt = null;
    for (const voice of group.voices) {
      // The bank first: it disconnects its own scale gain from a param on
      // THIS voice's graph, and a targeted disconnect of an edge that is
      // already gone throws on the real platform.
      this.options.lfoBank?.disconnectVoice(voice);
      voice.disconnect();
    }
    this.forgetGroup(group);
  }

  private forgetGroup(group: VoiceGroup): void {
    // The backstop for rule 1: a group that no longer exists must not be
    // reachable by id, and its registration is what would otherwise hold the
    // whole VoiceGroup -> ManagedVoice -> AudioNode chain alive until a bridge
    // happened to send a matching note-off. Every path that releases a group
    // also deregisters it, so this is normally a no-op — normally is not a
    // guarantee, and `has()` is about to be a bound engine API.
    this.registered.delete(group.id);
    const groups = this.groups.get(group.source);
    if (!groups) return;
    groups.delete(group);
    if (groups.size === 0) this.groups.delete(group.source);
  }

  private enforceBudget(incoming: VoiceGroup, at: number): void {
    const ceiling = this.options.maxVoicesPerSource ?? DEFAULT_MAX_VOICES_PER_SOURCE;
    while (this.budgetedVoiceCount(incoming.source) > ceiling) {
      const victim = this.pickVictim(incoming, at);
      if (!victim) return;
      this.stealGroup(victim, at);
    }
  }

  /** Physical voices on a bus that are not already on their way out. */
  private budgetedVoiceCount(source: string): number {
    let total = 0;
    for (const group of this.groups.get(source) ?? []) {
      if (!group.stolen) total += group.voices.length;
    }
    return total;
  }

  /**
   * A voice already releasing first, then the oldest voice still held. A
   * voice scheduled AHEAD of `at` is never eligible in either class: it has
   * not sounded yet, and stealing it would cancel an envelope the sequencer
   * has already planned.
   *
   * A bus's LIVE mono channel is never eligible either. It is the one group
   * the mono stack still points at, so stealing it would silence the
   * instrument the player is holding down and leave the next legato note
   * gliding a voice that has already been told to die.
   */
  private pickVictim(incoming: VoiceGroup, at: number): VoiceGroup | null {
    const monoGroup = this.mono.get(incoming.source)?.group;
    let releasing: VoiceGroup | null = null;
    let held: VoiceGroup | null = null;
    for (const group of this.groups.get(incoming.source) ?? []) {
      if (group === incoming || group === monoGroup || group.stolen || group.startedAt > at) continue;
      if (group.releasing) {
        if (!releasing || group.startedAt < releasing.startedAt) releasing = group;
      } else if (!held || group.startedAt < held.startedAt) {
        held = group;
      }
    }
    return releasing ?? held;
  }
}

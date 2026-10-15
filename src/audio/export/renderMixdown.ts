/**
 * The offline mixdown renderer.
 *
 * Binds a throwaway engine to an `OfflineAudioContext`, applies master state
 * through the engine's own public setters, and performs `walkSongTimeline`
 * item by item — the timeline (`plan/songTimeline.ts`) is where the
 * arrangement becomes events, not this file. The realtime singleton, the
 * shared clock and the transport are not involved and are not disturbed: an
 * export is a side effect on a file, not on the session.
 *
 * `renderSongBuffer` is the shared body — guards, context, seeded build,
 * walk, render; `renderMixdown` encodes its two channels and `renderStems.ts`
 * its `STEM_CHANNELS` (ADR-0038).
 *
 * Imports only src/data/, src/utils/ and src/audio/ — no store, no component,
 * not even a type: the eslint block covering src/audio/** has no
 * allowTypeImports exemption. Everything the render reads arrives in the
 * snapshot, which is why `MixdownLoop` (now `plan/songSnapshot.ts`) names the
 * fields the offline snapshot carries rather than importing the store's
 * `Loop`. The store enriches each project loop with its source-bus
 * mixer at that boundary; every other field remains the flat project-content
 * shape.
 *
 * Two consequences of the offline clock, both deliberate:
 *
 *  - Source-bus gain/mute and drum-filter cutoff/resonance are scheduled at
 *    every loop boundary, matching the per-loop state live song mode installs
 *    as it advances. Drum track faders are still applied once; BiquadFilter
 *    `type` is not an AudioParam and therefore cannot be time-automated.
 *  - `updateSynthPatch` is not called at all: it only reshapes voices that
 *    are already live, and there are none before the first note. Each voice
 *    gets its params at trigger time, which is where they come from anyway.
 */
import { createRenderEngine, type AudioEngine } from '../engine';
import {
  songTrackVoice,
  type MixdownBeatVoiceGain,
  type MixdownBusState,
  type MixdownSnapshot,
} from '../playback/plan/songSnapshot';
import {
  planArrangement,
  walkSongTimeline,
  type ArrangementPlan,
  type SongWalkItem,
  type TimelineEvent,
} from '../playback/plan/songTimeline';
import { MIXDOWN_SEED, mulberry32, withRandomSource, yieldPreservingRandomStream } from '../rng';
import { noteFrequency } from '@/utils/musicTheory';
import { stepDurationSec } from '@/utils/tempo';
import { getMeter } from '@/utils/timeSignature';
import { encodeWav } from '@/utils/encodeWav';
import { applyBeatParams } from '../beatAdapter';
import { SEND_EFFECTS, type BeatParams, type TrackSendLevels } from '@/types';
import { synthReleaseSeconds } from '@/utils/synthPatch';
import { EFFECT_LIMITS } from '../effectLimits';
import {
  RENDER_CANCELLED,
  WALK_YIELD_INTERVAL_STEPS,
  nextTask,
  renderFailed,
  safeProgressReporter,
  type MixdownProgressReporter,
  type RenderFailure,
} from './renderResult';

export const MIXDOWN_SAMPLE_RATE = 44100;
const MIXDOWN_CHANNELS = 2;
/** The floor on the tail: release + reverb. Never shorter than this. */
const MIXDOWN_TAIL_SEC = 2;
/**
 * Silent context time before the song's first sample, rendered and then
 * trimmed off (ADR-0062). A browser's DynamicsCompressorNode starts in a state
 * it releases from with context time, not with input: signal arriving at time
 * zero faded in over about the release time, even 17 dB under the threshold,
 * and was clean from one release time on. The longest release a project can
 * set is therefore enough, and it also outlasts the master chain's own 50 ms
 * glides from each node's default to the project's value.
 */
export const RENDER_WARMUP_SEC = Math.max(
  EFFECT_LIMITS.compressorRelease.max,
  EFFECT_LIMITS.limiterRelease.max,
);

/**
 * The buffer is returned BESIDE the blob, not instead of it: the spec's own
 * assertions (channel count, exact length, non-silence) are only writable
 * against samples, and the encode has to sit inside the same `try` that turns
 * a throw into a failed result.
 */
export type MixdownRenderResult = { ok: true; buffer: AudioBuffer; blob: Blob } | RenderFailure;

export interface LoopAudioAutomation {
  loopIndex: number;
  time: number;
  buses: MixdownBusState[];
  beatParams: BeatParams;
  beatVoiceGains: MixdownBeatVoiceGain[];
}

/**
 * Per-loop mixer/filter changes positioned on the offline audio timeline,
 * where the song starts at `songStartSec`.
 */
export function planLoopAudioAutomation(
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
  songStartSec: number,
): LoopAudioAutomation[] {
  const stepDur = stepDurationSec(snapshot.bpm);
  return plan.passes.map((pass) => {
    const { buses, beatParams, beatVoiceGains } = snapshot.loops[pass.loopIndex];
    const time = songStartSec + pass.startStep * stepDur;
    return { loopIndex: pass.loopIndex, time, buses, beatParams, beatVoiceGains };
  });
}

/**
 * Settles the graph from the snapshot, in the order `applySliceState`
 * (src/store/engineSync.ts) uses, so an export is configured by the same
 * call sequence a live session uses rather than a parallel one.
 *
 * At time zero an offline render has no prior sample to transition from, so
 * each source bus settles before the first event rather than ramping into it.
 */
function applyMasterState(engine: AudioEngine, snapshot: MixdownSnapshot): void {
  engine.setClockBpm(snapshot.bpm);
  engine.setMeter(getMeter(snapshot.meterId));
  engine.setMasterVolume(snapshot.masterVolume);
  for (const bus of snapshot.buses) {
    engine.setSourceState(bus.source, { gain: bus.gain, muted: bus.muted }, 0, 'settle');
    engine.setSourceSends(bus.source, bus.sends, 0, 'settle');
  }
  // No Beat here: every loop installs its own at its pass boundary below, so
  // there is nothing arrangement-wide left to settle.
  engine.updateEffects(snapshot.effects);
  engine.setReverbDecay(snapshot.effects.reverbDecay);
}

function sameSendLevels(a: TrackSendLevels, b: TrackSendLevels | undefined): boolean {
  return b !== undefined && SEND_EFFECTS.every((effect) => a[effect] === b[effect]);
}

/**
 * Install per-loop audio state at the same boundary where live song mode loads the loop.
 * `previous` is the pass before this one (undefined for the first pass).
 */
function applyLoopAudioState(
  engine: AudioEngine,
  state: LoopAudioAutomation,
  previous: LoopAudioAutomation | undefined,
): void {
  for (const bus of state.buses) {
    engine.setSourceState(
      bus.source,
      { gain: bus.gain, muted: bus.muted },
      state.time,
      previous === undefined ? 'settle' : 'transition',
    );
    // A per-loop send change lands on this pass's first sample, through its
    // own method, never setSourceState (C2). Unlike bus state it is pushed
    // after the first pass only when it differs from the previous pass: an
    // equal-value transition is silent but was observed not to be
    // byte-neutral: pushing it on every pass changed the golden WAV. The
    // cause is inferred, not confirmed — likely a held-at-0 ramp on the Beat
    // bus's delay send node.
    const before = previous?.buses.find((row) => row.source === bus.source)?.sends;
    if (previous === undefined || !sameSendLevels(bus.sends, before)) {
      engine.setSourceSends(
        bus.source,
        bus.sends,
        state.time,
        previous === undefined ? 'settle' : 'transition',
      );
    }
  }
  // The Beat patch, BEFORE this pass schedules a single hit: a drum voice is
  // built from the kit installed at the moment it is scheduled, so a patch
  // applied after the walk has passed is a patch nothing in this loop plays.
  // The bus filter inside it carries the pass time on every axis, INCLUDING
  // its response type: `BiquadFilterNode.type` is a plain field and cannot be
  // scheduled, so the filter is a three-lane bank of fixed-type biquads whose
  // GAINS (real AudioParams) crossfade — see `BeatFilterLane` in masterRack.ts.
  // Before that, every pass here wrote `.type` directly and the last one won
  // for the whole render, because these calls all happen before
  // `ctx.startRendering()`. The voices are plain fields, which is fine: they
  // are read by the next `triggerDrum`, and those run at schedule time too.
  applyBeatParams(engine, state.beatParams, state.time);
  for (const { voice, gain } of state.beatVoiceGains) {
    engine.setDrumTrackGain(voice, gain, state.time);
  }
}

/**
 * Plays one walk event exactly as the pre-timeline renderer did: the same
 * engine call, the same arguments. Patch and bus come from songTrackVoice;
 * the release is computed at perform time from the patch. Returns the engine
 * source the event played on — bookkeeping only, no engine call, no RNG.
 */
function performTimelineEvent(
  engine: AudioEngine,
  snapshot: MixdownSnapshot,
  e: TimelineEvent,
  songStartSec: number,
): string {
  if (e.kind === 'drum') {
    engine.triggerDrum(e.voice, e.velocity, songStartSec + e.timeSec);
    return 'sequencer';
  }
  const { params, source } = songTrackVoice(snapshot.loops[e.loopIndex], e.track);
  const voiceId = engine.triggerSynthNoteOn(
    noteFrequency(e.noteName), params, e.velocity, songStartSec + e.startSec, source, 1, 'sequencer',
  );
  if (voiceId) engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(params), songStartSec + e.endSec);
  return source;
}

/** The longest render span between two checkpoints. */
const MAX_CHECKPOINT_SPACING_SEC = 1;
/**
 * How far past the next checkpoint the walk is performed. Two spacings, so a
 * checkpoint the host fails to land (node-web-audio-api occasionally rejects
 * one) — even two in a row — still leaves every item built before its time:
 * the next checkpoint that does land finds its window already started ahead
 * of the render position. It also has to exceed how early an event can start
 * before its own step (no event does today).
 */
const SCHEDULE_LOOKAHEAD_SEC = 2 * MAX_CHECKPOINT_SPACING_SEC;
/**
 * How long after its sources stop a synth voice stays attached. Its filter
 * rings on past that instant; cutting it at the first checkpoint after would
 * make the cut, and so the bytes, depend on which checkpoints the host landed.
 */
const ENDED_VOICE_MARGIN_SEC = 1;
/** Progress lands at least this often, as a fraction of the render. */
const MIN_PROGRESS_FRACTION = 0.02;
/** Web Audio renders in 128-frame quanta. */
const RENDER_QUANTUM_FRAMES = 128;

interface ArrangementScheduler {
  /**
   * Performs walk items up to the first step that starts at or after
   * `horizonSec` on the render timeline. Resolves true when the signal
   * aborted mid-walk.
   */
  scheduleUntil(horizonSec: number): Promise<boolean>;
  /** Cuts the graph of every synth voice whose sources stopped at or before `renderedTo`. */
  disconnectEndedBefore(renderedTo: number): void;
  readonly sourcesWithEvents: ReadonlySet<string>;
}

/**
 * Performs the song walk item by item. Never collect the walk first (R288):
 * the planners (arp 'random') and the engine (drum noise offsets, lazy noise
 * and sample-and-hold buffers) draw from one seeded stream, and only
 * performing each item before resuming the walk keeps today's interleaving —
 * and so the WAV — unchanged. The walk is performed in windows (ADR-0061),
 * but one generator spans them all, so the item order does not change.
 */
function createArrangementScheduler(
  engine: AudioEngine,
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
  walk: Generator<SongWalkItem, void, undefined>,
  songStartSec: number,
  signal?: AbortSignal,
): ArrangementScheduler {
  const loopAutomation = planLoopAudioAutomation(snapshot, plan, songStartSec);
  const stepDur = stepDurationSec(snapshot.bpm);
  const sourcesWithEvents = new Set<string>();
  let stepsSinceYield = 0;

  async function scheduleUntil(horizonSec: number): Promise<boolean> {
    for (let next = walk.next(); !next.done; next = walk.next()) {
      const item = next.value;
      if (item.kind === 'pass') {
        applyLoopAudioState(engine, loopAutomation[item.passIndex], loopAutomation[item.passIndex - 1]);
      } else if (item.kind === 'stepEnd') {
        stepsSinceYield += 1;
        if (stepsSinceYield >= WALK_YIELD_INTERVAL_STEPS) {
          stepsSinceYield = 0;
          await yieldPreservingRandomStream();
          if (signal?.aborted) return true;
        }
        if (songStartSec + (item.step + 1) * stepDur >= horizonSec) return false;
      } else {
        sourcesWithEvents.add(performTimelineEvent(engine, snapshot, item, songStartSec));
      }
    }
    return false;
  }

  return {
    scheduleUntil,
    disconnectEndedBefore: (renderedTo) => engine.disconnectEndedVoices(renderedTo),
    sourcesWithEvents,
  };
}

/**
 * The render positions, in seconds, where the timeline pauses to perform the
 * next window of the walk and publish progress. A suspend lands on a quantum
 * boundary and two in one quantum reject, so each checkpoint sits in the
 * middle of its own quantum: a host that rounds the time down and one that
 * rounds it up (node-web-audio-api) both map distinct checkpoints to distinct
 * quanta.
 */
export function renderCheckpoints(lengthFrames: number, sampleRate: number): number[] {
  const durationSec = lengthFrames / sampleRate;
  const spacingSec = Math.min(MAX_CHECKPOINT_SPACING_SEC, durationSec * MIN_PROGRESS_FRACTION);
  const times: number[] = [];
  let lastFrame = 0;
  for (let i = 1; i * spacingSec < durationSec; i += 1) {
    const frame = Math.floor((i * spacingSec * sampleRate) / RENDER_QUANTUM_FRAMES) * RENDER_QUANTUM_FRAMES;
    if (frame <= lastFrame || frame >= lengthFrames) continue;
    lastFrame = frame;
    times.push((frame + RENDER_QUANTUM_FRAMES / 2) / sampleRate);
  }
  return times;
}

type WindowedRender = { cancelled: true } | { cancelled: false; buffer: AudioBuffer };

/**
 * Builds the graph just ahead of the render position instead of all of it
 * before sample zero (ADR-0061). A voice's chain is processed from the moment
 * it is built until it ends, so building the whole song first made every
 * quantum pay for every note still to come, and render time grew with the
 * square of the song's length.
 *
 * Each checkpoint suspends the timeline, publishes its position, performs the
 * walk up to the next checkpoint plus the lookahead, then resumes. The seeded
 * generator is installed only around those bursts, never across the render's
 * own awaits. A host without suspend/resume performs the whole walk first and
 * keeps the indeterminate spinner.
 */
async function renderInWindows(
  ctx: OfflineAudioContext,
  scheduler: ArrangementScheduler,
  rng: () => number,
  report: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<WindowedRender> {
  const perform = (horizonSec: number) => withRandomSource(rng, () => scheduler.scheduleUntil(horizonSec));
  const windowed = typeof ctx.suspend === 'function' && typeof ctx.resume === 'function';
  const durationSec = ctx.length / ctx.sampleRate;
  const checkpoints = windowed ? renderCheckpoints(ctx.length, ctx.sampleRate) : [];
  const horizonAt = (index: number) => windowed
    ? (checkpoints[index] ?? durationSec) + SCHEDULE_LOOKAHEAD_SEC
    : Infinity;

  if (await perform(horizonAt(0))) return { cancelled: true };
  if (signal?.aborted) return { cancelled: true };

  let cancelled = false;
  let failure: unknown = null;
  let lastPercent = 1;
  checkpoints.forEach((time, index) => {
    const onCheckpoint = async () => {
      try {
        const percent = Math.floor((time / durationSec) * 100);
        if (percent > lastPercent) {
          lastPercent = percent;
          report({ phase: 'rendering', percent });
        }
        cancelled ||= signal?.aborted === true;
        if (!cancelled && failure === null) {
          scheduler.disconnectEndedBefore(time - ENDED_VOICE_MARGIN_SEC);
          cancelled = await perform(horizonAt(index + 1));
        }
      } catch (err) {
        failure = err;
      } finally {
        await ctx.resume().catch((err: unknown) => {
          failure ??= err;
        });
      }
    };
    void ctx.suspend(time).then(onCheckpoint, () => {
      // A lost checkpoint costs one progress update; SCHEDULE_LOOKAHEAD_SEC covers its window.
    });
  });

  report({ phase: 'rendering', percent: 1 });
  const buffer = await ctx.startRendering();
  if (failure !== null) throw failure;
  return cancelled ? { cancelled: true } : { cancelled: false, buffer };
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** The rendered buffer without its first `warmupSamples` frames: the song from its first sample. */
function trimWarmup(ctx: OfflineAudioContext, rendered: AudioBuffer, warmupSamples: number): AudioBuffer {
  const trimmed = ctx.createBuffer(rendered.numberOfChannels, rendered.length - warmupSamples, rendered.sampleRate);
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    trimmed.copyToChannel(rendered.getChannelData(channel).subarray(warmupSamples), channel);
  }
  return trimmed;
}

/**
 * Keeps every object the render's context creates reachable until the render
 * ends, by wrapping each of its `create*` factories. The engine drops its
 * references to a voice once the voice is released and again once it is cut,
 * and node-web-audio-api (the test and golden context) frees a node's native
 * half when its JS wrapper is collected. Once voices are built and cut
 * mid-render, the collector runs between windows and the output depended on
 * when it did (ADR-0061). Every factory rather than a list, so a node type the
 * engine starts using later is held too. A browser keeps a scheduled node
 * alive by itself, so this costs it only the wrappers.
 */
function holdRenderNodes(ctx: OfflineAudioContext): unknown[] {
  const held: unknown[] = [];
  const factories = new Set<string>();
  for (let proto: object | null = Object.getPrototypeOf(ctx); proto; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name.startsWith('create')) factories.add(name);
    }
  }
  const target = ctx as unknown as Record<string, unknown>;
  for (const name of factories) {
    const create = target[name];
    if (typeof create !== 'function') continue;
    target[name] = (...args: unknown[]) => {
      const made: unknown = create.apply(ctx, args);
      held.push(made);
      return made;
    };
  }
  return held;
}

/**
 * The offline context constructor, or null. A capability probe, like the File
 * System Access API path: a device without one is a degraded state the UI
 * renders, never an exception path. Read off `globalThis` and tested for
 * presence rather than caught from a `new`, so nothing has to be constructed
 * to find out.
 */
function offlineContextCtor(): OfflineCtor | null {
  const g = globalThis as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

/**
 * How `renderSongBuffer` shapes its context. The mixdown passes
 * `{ channels: 2 }` and nothing else, so its graph and engine-call sequence are
 * exactly the golden's (R309).
 */
export interface SongRenderLayout {
  channels: number;
  /** Stems: the master rack's last stage connects to an unconnected sink instead of the destination. */
  detachMaster?: boolean;
  /** Runs inside the seeded block after applyMasterState, before the walk. Must not draw from the RNG. */
  wire?: (engine: AudioEngine, ctx: OfflineAudioContext) => void;
}

type SongBufferResult = { ok: true; buffer: AudioBuffer; sourcesWithEvents: ReadonlySet<string> } | RenderFailure;

/**
 * Renders the arrangement to an `AudioBuffer`. NEVER THROWS. Shared by the
 * mixdown and the stems (ADR-0038); `report` must already be guarded
 * (`safeProgressReporter`).
 *
 * The one `try` covers the context construction and the render itself, so a
 * failure anywhere becomes a failed result with a reason rather than an
 * unhandled rejection crossing into a click handler with no message for the user.
 *
 * One seeded generator spans the whole graph build: the engine construction
 * (`setupMasterChain` builds the reverb impulse at the DEFAULT decay 2.0), the
 * master-state settle, `layout.wire` and every window of the scheduling walk,
 * because the reverb impulse, the noise-voice buffers and the arp's `'random'`
 * note order all read from it as they are created. It is installed only
 * around those synchronous bursts and restored in a `finally` after each, so a
 * leaked source cannot make the rest of the session reproducible.
 *
 * `wire` runs AFTER `applyMasterState`, so the six buses already exist in the
 * mixdown's creation order (`setSourceState` in `snapshot.buses` order); a tap
 * only adds edges to existing nodes.
 */
export async function renderSongBuffer(
  snapshot: MixdownSnapshot,
  layout: SongRenderLayout,
  report: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<SongBufferResult> {
  try {
    if (signal?.aborted) return RENDER_CANCELLED;
    if (snapshot.loops.length === 0) {
      return { ok: false, reason: { kind: 'empty-arrangement' } };
    }
    const Offline = offlineContextCtor();
    if (!Offline) return { ok: false, reason: { kind: 'unsupported-context' } };

    report({ phase: 'preparing' });

    const stepDur = stepDurationSec(snapshot.bpm);
    const plan = planArrangement(snapshot);
    const bodySamples = Math.ceil(plan.totalSteps * stepDur * MIXDOWN_SAMPLE_RATE);
    // The tail has to cover the longest release AND the reverb it feeds, or a
    // song ending on a held chord is cut off mid-decay.
    const tailSec = Math.max(MIXDOWN_TAIL_SEC, snapshot.effects.reverbDecay + 1);
    const warmupSamples = Math.round(RENDER_WARMUP_SEC * MIXDOWN_SAMPLE_RATE);
    const ctx = new Offline(
      layout.channels,
      warmupSamples + bodySamples + Math.ceil(tailSec * MIXDOWN_SAMPLE_RATE),
      MIXDOWN_SAMPLE_RATE,
    );

    // Seeded BEFORE createRenderEngine: setupMasterChain (run inside
    // bindContext) builds the reverb impulse at the DEFAULT decay 2.0, and
    // setReverbDecay early-returns when the snapshot's decay equals that
    // default — so seeding only applyMasterState and the walk would leave an
    // unseeded impulse in the graph for the store's default project, and two
    // renders of it would differ.
    const heldNodes = holdRenderNodes(ctx);
    const rng = mulberry32(MIXDOWN_SEED);
    const scheduler = await withRandomSource(rng, () => {
      // The mixdown passes no options: createRenderEngine(ctx), as the golden recorded (R309).
      const engine = layout.detachMaster
        ? createRenderEngine(ctx, { masterOutput: ctx.createGain() })
        : createRenderEngine(ctx);
      applyMasterState(engine, snapshot);
      layout.wire?.(engine, ctx);
      const walk = walkSongTimeline(snapshot, plan);
      return createArrangementScheduler(engine, snapshot, plan, walk, warmupSamples / MIXDOWN_SAMPLE_RATE, signal);
    });
    const rendered = await renderInWindows(ctx, scheduler, rng, report, signal);
    heldNodes.length = 0;
    if (rendered.cancelled) return RENDER_CANCELLED;
    const buffer = trimWarmup(ctx, rendered.buffer, warmupSamples);
    // Yield between the terminal render state and encoding so both named
    // phases can be painted instead of collapsing into one React commit.
    report({ phase: 'rendering', percent: 100 });
    await nextTask();
    if (signal?.aborted) return RENDER_CANCELLED;
    return { ok: true, buffer, sourcesWithEvents: scheduler.sourcesWithEvents };
  } catch (err) {
    return renderFailed(err);
  }
}

/**
 * Renders the arrangement to a WAV. NEVER THROWS. The render is
 * `renderSongBuffer` with two channels and no options; this adds only the
 * encoding tail, in today's order.
 */
export async function renderMixdown(
  snapshot: MixdownSnapshot,
  onProgress?: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<MixdownRenderResult> {
  const report = safeProgressReporter(onProgress);
  try {
    const rendered = await renderSongBuffer(snapshot, { channels: MIXDOWN_CHANNELS }, report, signal);
    if (!rendered.ok) return rendered;
    const { buffer } = rendered;
    report({ phase: 'encoding' });
    await nextTask();
    if (signal?.aborted) return RENDER_CANCELLED;
    const blob = encodeWav(
      [buffer.getChannelData(0), buffer.getChannelData(1)],
      MIXDOWN_SAMPLE_RATE,
    );
    return { ok: true, buffer, blob };
  } catch (err) {
    return renderFailed(err);
  }
}

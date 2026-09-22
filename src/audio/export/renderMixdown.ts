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
 * `ProjectLoop`. The store enriches each project loop with its source-bus
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
import { MIXDOWN_SEED, withSeededRandom, yieldPreservingRandomStream } from '../rng';
import { noteFrequency, stepDurationSec } from '@/utils/musicTheory';
import { getMeter } from '@/utils/meter';
import { encodeWav } from '@/utils/encodeWav';
import { applyBeatParams } from '../beatAdapter';
import { SEND_EFFECTS, type BeatParams, type TrackSendLevels } from '@/types';
import { synthReleaseSeconds } from '@/utils/synthPatch';

export const MIXDOWN_SAMPLE_RATE = 44100;
const MIXDOWN_CHANNELS = 2;
/** The floor on the tail: release + reverb. Never shorter than this. */
const MIXDOWN_TAIL_SEC = 2;

/** How many total dwell-steps to schedule between yields. Chosen so a yield
 * lands roughly every few hundred AudioNode constructions on a dense
 * arrangement — frequent enough that Cancel feels responsive, rare enough
 * that the yield overhead (a macrotask hop) stays negligible next to the
 * scheduling work itself. */
const SCHEDULE_YIELD_INTERVAL_STEPS = 200;

/**
 * Why a render produced no file. A union rather than a string so the slice's
 * `projectNotice` sentence is a switch the compiler checks, and so a test can
 * assert the reason without matching prose.
 */
export type MixdownFailureReason =
  | { kind: 'empty-arrangement' }
  | { kind: 'unsupported-context' }
  | { kind: 'cancelled' }
  | { kind: 'render-failed'; detail: string };

/**
 * The buffer is returned BESIDE the blob, not instead of it: the spec's own
 * assertions (channel count, exact length, non-silence) are only writable
 * against samples, and the encode has to sit inside the same `try` that turns
 * a throw into a failed result.
 */
export type MixdownRenderResult =
  | { ok: true; buffer: AudioBuffer; blob: Blob }
  | { ok: false; reason: MixdownFailureReason };

export interface LoopAudioAutomation {
  loopIndex: number;
  time: number;
  buses: MixdownBusState[];
  beatParams: BeatParams;
  beatVoiceGains: MixdownBeatVoiceGain[];
}

/** Per-loop mixer/filter changes positioned on the offline audio timeline. */
export function planLoopAudioAutomation(
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
): LoopAudioAutomation[] {
  const stepDur = stepDurationSec(snapshot.bpm);
  return plan.passes.map((pass) => ({
    loopIndex: pass.loopIndex,
    time: pass.startStep * stepDur,
    buses: snapshot.loops[pass.loopIndex].buses,
    beatParams: snapshot.loops[pass.loopIndex].beatParams,
    beatVoiceGains: snapshot.loops[pass.loopIndex].beatVoiceGains,
  }));
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
      state.time === 0 ? 'settle' : 'transition',
    );
    // A per-loop send change lands on this pass's first sample, through its
    // own method, never setSourceState (C2). Unlike bus state it is pushed
    // after time zero only when it differs from the previous pass: an
    // equal-value transition is silent but was observed not to be
    // byte-neutral: pushing it on every pass changed the golden WAV. The
    // cause is inferred, not confirmed — likely a held-at-0 ramp on the Beat
    // bus's delay send node.
    const before = previous?.buses.find((row) => row.source === bus.source)?.sends;
    if (state.time === 0 || !sameSendLevels(bus.sends, before)) {
      engine.setSourceSends(
        bus.source,
        bus.sends,
        state.time,
        state.time === 0 ? 'settle' : 'transition',
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
function performTimelineEvent(engine: AudioEngine, snapshot: MixdownSnapshot, e: TimelineEvent): string {
  if (e.kind === 'drum') {
    engine.triggerDrum(e.voice, e.velocity, e.timeSec);
    return 'sequencer';
  }
  const { params, source } = songTrackVoice(snapshot.loops[e.loopIndex], e.track);
  const voiceId = engine.triggerSynthNoteOn(
    noteFrequency(e.noteName), params, e.velocity, e.startSec, source, 1, 'sequencer',
  );
  if (voiceId) engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(params), e.endSec);
  return source;
}

/**
 * Performs the song walk item by item. Never collect the walk first (R288):
 * the planners (arp 'random') and the engine (drum noise offsets, lazy noise
 * and sample-and-hold buffers) draw from one seeded stream, and only
 * performing each item before resuming the walk keeps today's interleaving —
 * and so the WAV — unchanged.
 */
async function scheduleArrangement(
  engine: AudioEngine,
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
  walk: Generator<SongWalkItem, void, undefined>,
  signal?: AbortSignal,
): Promise<{ cancelled: boolean; sourcesWithEvents: Set<string> }> {
  const loopAutomation = planLoopAudioAutomation(snapshot, plan);
  let stepsSinceYield = 0;
  const sourcesWithEvents = new Set<string>();
  for (let next = walk.next(); !next.done; next = walk.next()) {
    const item = next.value;
    if (item.kind === 'pass') {
      applyLoopAudioState(engine, loopAutomation[item.passIndex], loopAutomation[item.passIndex - 1]);
    } else if (item.kind === 'stepEnd') {
      stepsSinceYield += 1;
      if (stepsSinceYield >= SCHEDULE_YIELD_INTERVAL_STEPS) {
        stepsSinceYield = 0;
        await yieldPreservingRandomStream();
        if (signal?.aborted) return { cancelled: true, sourcesWithEvents };
      }
    } else {
      sourcesWithEvents.add(performTimelineEvent(engine, snapshot, item));
    }
  }
  return { cancelled: false, sourcesWithEvents };
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export type MixdownRenderProgress =
  | { phase: 'preparing' }
  | { phase: 'rendering'; percent: number }
  | { phase: 'encoding' };

export type MixdownProgressReporter = (progress: MixdownRenderProgress) => void;

/** A progress observer must never be able to turn a valid render into a failure. */
export function safeProgressReporter(reporter?: MixdownProgressReporter): MixdownProgressReporter {
  return (progress) => {
    try {
      reporter?.(progress);
    } catch {
      // Reporting is best-effort; the audio render remains authoritative.
    }
  };
}

/**
 * Pause the offline timeline at two-percent checkpoints, publish its position,
 * then immediately resume. Older implementations without suspend/resume simply
 * keep the indeterminate spinner shown by the caller.
 */
function scheduleProgressCheckpoints(
  ctx: OfflineAudioContext,
  report: MixdownProgressReporter,
): void {
  if (typeof ctx.suspend !== 'function' || typeof ctx.resume !== 'function') return;

  const duration = ctx.length / ctx.sampleRate;
  for (let timelinePercent = 2; timelinePercent < 100; timelinePercent += 2) {
    const ratio = timelinePercent / 100;
    void ctx
      .suspend(duration * ratio)
      .then(() => {
        report({ phase: 'rendering', percent: timelinePercent });
        return ctx.resume();
      })
      .catch(() => {
        // A rejected checkpoint is a progress degradation, not a render error.
      });
  }
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

type SongBufferResult =
  | { ok: true; buffer: AudioBuffer; sourcesWithEvents: ReadonlySet<string> }
  | { ok: false; reason: MixdownFailureReason };

function renderFailed(err: unknown): MixdownFailureReason {
  return { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) };
}

/**
 * Renders the arrangement to an `AudioBuffer`. NEVER THROWS. Shared by the
 * mixdown and the stems (ADR-0038); `report` must already be guarded
 * (`safeProgressReporter`).
 *
 * The one `try` covers the context construction and the render itself, so a
 * failure anywhere becomes a failed result with a reason rather than an
 * unhandled rejection crossing into a click handler with no message for the user.
 *
 * The seeded generator is installed for the whole graph-building phase — the
 * engine construction (`setupMasterChain` builds the reverb impulse at the
 * DEFAULT decay 2.0), the master-state settle, `layout.wire` and the
 * scheduling walk — because the reverb impulse, the noise-voice buffers and the
 * arp's `'random'` note order all read from it as they are created, which
 * happens while the graph is being built and not while it renders. It is
 * restored in a `finally` on every exit path, including the throwing one, so a
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
    if (signal?.aborted) {
      return { ok: false, reason: { kind: 'cancelled' } };
    }
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
    const ctx = new Offline(
      layout.channels,
      bodySamples + Math.ceil(tailSec * MIXDOWN_SAMPLE_RATE),
      MIXDOWN_SAMPLE_RATE,
    );

    // Seeded BEFORE createRenderEngine: setupMasterChain (run inside
    // bindContext) builds the reverb impulse at the DEFAULT decay 2.0, and
    // setReverbDecay early-returns when the snapshot's decay equals that
    // default — so seeding only applyMasterState + scheduleArrangement would
    // leave an unseeded impulse in the graph for the store's default project,
    // and two renders of it would differ.
    const scheduled = await withSeededRandom(MIXDOWN_SEED, async () => {
      // The mixdown passes no options: createRenderEngine(ctx), as the golden recorded (R309).
      const engine = layout.detachMaster
        ? createRenderEngine(ctx, { masterOutput: ctx.createGain() })
        : createRenderEngine(ctx);
      applyMasterState(engine, snapshot);
      layout.wire?.(engine, ctx);
      return scheduleArrangement(engine, snapshot, plan, walkSongTimeline(snapshot, plan), signal);
    });
    if (scheduled.cancelled) {
      return { ok: false, reason: { kind: 'cancelled' } };
    }

    report({ phase: 'rendering', percent: 1 });
    scheduleProgressCheckpoints(ctx, report);
    const buffer = await ctx.startRendering();
    // Yield between the terminal render state and encoding so both named
    // phases can be painted instead of collapsing into one React commit.
    report({ phase: 'rendering', percent: 100 });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) {
      return { ok: false, reason: { kind: 'cancelled' } };
    }
    return { ok: true, buffer, sourcesWithEvents: scheduled.sourcesWithEvents };
  } catch (err) {
    return { ok: false, reason: renderFailed(err) };
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) {
      return { ok: false, reason: { kind: 'cancelled' } };
    }
    const blob = encodeWav(
      [buffer.getChannelData(0), buffer.getChannelData(1)],
      MIXDOWN_SAMPLE_RATE,
    );
    return { ok: true, buffer, blob };
  } catch (err) {
    return { ok: false, reason: renderFailed(err) };
  }
}

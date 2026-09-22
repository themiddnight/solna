/**
 * The offline mixdown renderer.
 *
 * Binds a throwaway engine to an `OfflineAudioContext`, applies the snapshot
 * through the engine's own public setters, walks the arrangement driving the
 * SAME pure step functions the live clock drives, and hands back an encoded
 * WAV. The realtime singleton, the shared clock and the transport are not
 * involved and are not disturbed: an export is a side effect on a file, not
 * on the session.
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
import { emitStepEvents, playFullHoldChord } from '../playback/chordPlayback';
import { planPadArm } from '../playback/plan/padPlan';
import { planChordStep } from '../playback/plan/chordPlan';
import { planMelodyStep, type MelodyPlanSnapshot } from '../playback/plan/melodyPlan';
import {
  mixdownFxTrack,
  mixdownLeadTrack,
  padSnapshotForLoop,
  songTrackVoice,
  type MixdownBeatVoiceGain,
  type MixdownBusState,
  type MixdownLoop,
  type MixdownSnapshot,
} from '../playback/plan/songSnapshot';
import { buildLoopVoices, planArrangement, type ArrangementPlan } from '../playback/plan/songTimeline';
import { MIXDOWN_SEED, getRandomSource, setRandomSource, withSeededRandom } from '../rng';
import { DEFAULT_VELOCITY } from '../constants';
import { noteFrequency, stepDurationSec } from '@/utils/musicTheory';
import { TICKS_PER_SIXTEENTH } from '@/utils/stepResolution';
import { getMeter } from '@/utils/meter';
import { encodeWav } from '@/utils/encodeWav';
import { applyBeatParams } from '../beatAdapter';
import { planBeatStep } from '../playback/plan/beatPlan';
import type { BeatParams } from '@/types';
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

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Yields exactly like `yieldToMainThread`, but additionally protects the
 * seeded RNG stream `withSeededRandom` installed for this render from being
 * corrupted by a concurrent caller.
 *
 * `rng.ts`'s `randomSource` is a module GLOBAL, and this render's own draws
 * (a drum voice's noise start offset, a reverb impulse sample, an LFO's
 * random waveform sample) all go through the shared `random()` seam with no
 * argument identifying who is asking. Between two of THIS walk's own
 * synchronous bursts nothing else can run — JS has one thread — so the only
 * window where a foreign draw can land on our stream is the macrotask gap
 * `setTimeout(resolve, 0)` opens. If the user is ALSO playing the project
 * live while exporting (nothing pauses live playback for an export — see
 * `store/mixdownSlice.ts`), the live 16th-clock's `setInterval` tick is a
 * macrotask too, and a live note triggered in that gap would otherwise steal
 * a draw from this render's mulberry32 generator, silently shifting every
 * value the render reads after it resumes.
 *
 * The fix is to hand the generator itself, not just the intent to use it,
 * out of scope for the gap: capture whatever `withSeededRandom` installed,
 * swap the global to the ambient default so a foreign draw lands on
 * `Math.random` instead (harmless — live playback has no determinism
 * contract), then reassert this render's own generator before drawing from
 * it again. The generator's internal counter is therefore only ever
 * advanced by calls this render itself makes.
 *
 * Exported for `renderMixdownRngIsolation.test.ts` — proving this needs no
 * `OfflineAudioContext`, only a seeded generator and a foreign `random()`
 * call landing mid-yield, so the test drives this function directly rather
 * than a whole render.
 */
export async function yieldPreservingRandomStream(): Promise<void> {
  const ownRandomSource = getRandomSource();
  setRandomSource(null);
  try {
    await yieldToMainThread();
  } finally {
    setRandomSource(ownRandomSource);
  }
}

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
  }
  // No Beat here: every loop installs its own at its pass boundary below, so
  // there is nothing arrangement-wide left to settle.
  engine.updateEffects(snapshot.effects);
  engine.setReverbDecay(snapshot.effects.reverbDecay);
}

/** Install per-loop audio state at the same boundary where live song mode loads the loop. */
function applyLoopAudioState(engine: AudioEngine, state: LoopAudioAutomation): void {
  for (const bus of state.buses) {
    engine.setSourceState(
      bus.source,
      { gain: bus.gain, muted: bus.muted },
      state.time,
      state.time === 0 ? 'settle' : 'transition',
    );
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
 * One melody track's material at one PASS-RELATIVE step, at an explicit
 * absolute time.
 *
 * This used to be a transcription of the live hook's clock callback — the same
 * three-function chain written twice, free to diverge. Both now call
 * `planMelodyStep`; what is left here is the render's half: the time, the patch
 * and the engine.
 */
function scheduleMelodyStep(
  engine: AudioEngine,
  loop: MixdownLoop,
  trackId: 'lead' | 'fx',
  track: MelodyPlanSnapshot,
  stepInPass: number,
  stepsPerBar: number,
  tickDur: number,
  time: number,
): void {
  const { params, source } = songTrackVoice(loop, trackId);
  const planned = planMelodyStep(track, { stepInLoop: stepInPass, stepsPerBar, tickDurSec: tickDur });
  for (const note of planned) {
    const start = time + note.startOffsetSec;
    const voiceId = engine.triggerSynthNoteOn(
      noteFrequency(note.note), params, DEFAULT_VELOCITY, start, source, 1, 'sequencer',
    );
    if (voiceId) {
      engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(params), start + note.holdSec);
    }
  }
}

async function scheduleArrangement(
  engine: AudioEngine,
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
  signal?: AbortSignal,
): Promise<{ cancelled: boolean }> {
  const stepDur = stepDurationSec(snapshot.bpm);
  const tickDur = stepDur / TICKS_PER_SIXTEENTH;
  const { stepsPerBar, meterId } = snapshot;
  const loopAutomation = planLoopAudioAutomation(snapshot, plan);
  let stepsSinceYield = 0;

  for (let passIndex = 0; passIndex < plan.passes.length; passIndex += 1) {
    const pass = plan.passes[passIndex];
    const loop = snapshot.loops[pass.loopIndex];
    applyLoopAudioState(engine, loopAutomation[passIndex]);
    const voices = buildLoopVoices(loop, meterId, snapshot.bpm, stepsPerBar);
    // A chordless loop dwells its bar(s) and plays no chord, bass or pad: the
    // guard below reads this once per pass and skips that whole block, so the
    // walk never dereferences the chord arrays (which are empty for it).
    const chordless = loop.chords.length === 0;
    // Built once per pass, not once per step: the walk runs for every step of
    // every repeat, and two fresh objects per step is garbage the render pays
    // for and nobody reads.
    const leadTrack = mixdownLeadTrack(loop);
    const fxTrack = mixdownFxTrack(loop);
    const padSnapshot = padSnapshotForLoop(loop, snapshot.bpm, stepsPerBar);

    for (let i = 0; i < pass.dwellSteps; i += 1) {
      // Pass-relative, so repeats 2..n reset the chord plan exactly as a live
      // loop restart does. See planArrangement's docblock: the dwell already
      // counts the repeats, so this is NOT a repeat loop.
      const stepInPass = i % pass.passSteps;
      const step = pass.startStep + i;
      const time = step * stepDur;
      const stepInBar = stepInPass % stepsPerBar;
      const barInPass = Math.floor(stepInPass / stepsPerBar);

      // The Beat, through the SAME pure decision the live stepper uses: one
      // function answers "what sounds at this step" for both, so an export can
      // never disagree with what the grid played. The per-voice mute is
      // honoured inside it; solo is not, and must not be — solo is a
      // session-only monitoring gesture and never reaches an export.
      for (const event of planBeatStep({ pattern: loop.beatPattern, mix: loop.beatMix }, { stepInBar })) {
        engine.triggerDrum(event.voice, event.velocity, time);
      }

      if (!chordless) {
        const chordIndex = voices.chordsByBar[barInPass];
        const plan = voices.plans[chordIndex];
        const stepsIntoChord = stepInPass - voices.chordStartStep[chordIndex];
        const chordSteps = plan.totalBars * stepsPerBar;
        const chordEnd = time + (chordSteps - stepsIntoChord) * stepDur;
        const isLastBar = Math.floor(stepsIntoChord / stepsPerBar) === plan.totalBars - 1;

        // The full holds arm once, on the chord's own first step. Both lanes
        // report empty events when they hold, so the per-step emit below is a
        // no-op for them rather than a branch.
        if (stepsIntoChord === 0 && plan.chordFullHold) {
          playFullHoldChord(
            plan.chordFullHold.notes,
            loop.chordSynthParams,
            time,
            plan.chordFullHold.holdSec,
            'chord',
            engine,
          );
        }
        if (stepsIntoChord === 0 && plan.bassFullHold) {
          const voiceId = engine.triggerSynthNoteOn(
            noteFrequency(plan.bassFullHold.noteName), loop.bassSynthParams, plan.bassFullHold.velocity,
            time, 'bass', 1, 'sequencer',
          );
          if (voiceId) {
            engine.triggerSynthNoteOff(
              voiceId,
              synthReleaseSeconds(loop.bassSynthParams),
              time + plan.bassFullHold.holdSec,
            );
          }
        }

        // The SAME step decision the live scheduler makes, at the same
        // progression-relative step.
        const events = planChordStep(plan, {
          progressionStep: stepInPass,
          step,
          isLastBar,
          stepsPerBar,
          stepDurSec: stepDur,
          chordArp: loop.chordArpSettings,
          bassArp: loop.bassArpSettings,
          chordFeel: loop.chordFeel,
          bassFeel: loop.bassFeel,
        });
        emitStepEvents(events.chord, loop.chordSynthParams, 'chord', time, chordEnd, engine);
        emitStepEvents(events.bass, loop.bassSynthParams, 'bass', time, chordEnd, engine);

        // Pad, through the SAME planner the live hook arms with. `chordIndex`
        // carries what `isLoopStart` used to: the pad block only runs at
        // `stepsIntoChord === 0`, and chord 0 starts at step 0 of the pass, so
        // `chordIndex === 0` there is exactly the old `stepInPass === 0`.
        if (stepsIntoChord === 0) {
          const arm = planPadArm(padSnapshot, { chordIndex });
          if (arm) {
            playFullHoldChord(arm.notes, loop.padSynthParams, time, arm.holdSec, 'pad', engine);
          }
        }
      }

      // Melody tracks run whether or not the loop has chords: a lead over a
      // chordless loop is a real thing, and the grid's own loop length is what
      // decides its material. No `stepInBar < stepsPerBar` guard here —
      // `stepInBar` IS a modulo by `stepsPerBar`, so such a guard is a
      // tautology, and the melody's own windowing already happens inside
      // leadActivePosAt/leadSoundingNotes.
      scheduleMelodyStep(engine, loop, 'lead', leadTrack, stepInPass, stepsPerBar, tickDur, time);
      scheduleMelodyStep(engine, loop, 'fx', fxTrack, stepInPass, stepsPerBar, tickDur, time);

      stepsSinceYield += 1;
      if (stepsSinceYield >= SCHEDULE_YIELD_INTERVAL_STEPS) {
        stepsSinceYield = 0;
        await yieldPreservingRandomStream();
        if (signal?.aborted) return { cancelled: true };
      }
    }
  }
  return { cancelled: false };
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export type MixdownRenderProgress =
  | { phase: 'preparing' }
  | { phase: 'rendering'; percent: number }
  | { phase: 'encoding' };

export type MixdownProgressReporter = (progress: MixdownRenderProgress) => void;

/** A progress observer must never be able to turn a valid render into a failure. */
function safeProgressReporter(reporter?: MixdownProgressReporter): MixdownProgressReporter {
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
 * Renders the arrangement to a WAV. NEVER THROWS.
 *
 * The one `try` covers the context construction, the encode and the render
 * itself, so a failure anywhere becomes a failed result with a reason rather
 * than an unhandled rejection crossing into a click handler with no message
 * for the user.
 *
 * The seeded generator is installed for the whole graph-building phase — the
 * engine construction (`setupMasterChain` builds the reverb impulse at the
 * DEFAULT decay 2.0), the master-state settle and the scheduling walk —
 * because the reverb impulse, the noise-voice buffers and the arp's `'random'`
 * note order all read from it as they are created, which happens while the
 * graph is being built and not while it renders. It is restored in a `finally`
 * on every exit path, including the throwing one, so a leaked source cannot
 * make the rest of the session reproducible.
 */
export async function renderMixdown(
  snapshot: MixdownSnapshot,
  onProgress?: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<MixdownRenderResult> {
  const report = safeProgressReporter(onProgress);
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
      MIXDOWN_CHANNELS,
      bodySamples + Math.ceil(tailSec * MIXDOWN_SAMPLE_RATE),
      MIXDOWN_SAMPLE_RATE,
    );

    // Seeded BEFORE createRenderEngine: setupMasterChain (run inside
    // bindContext) builds the reverb impulse at the DEFAULT decay 2.0, and
    // setReverbDecay early-returns when the snapshot's decay equals that
    // default — so seeding only applyMasterState + scheduleArrangement would
    // leave an unseeded impulse in the graph for the store's default project,
    // and two renders of it would differ.
    const scheduleResult = await withSeededRandom(MIXDOWN_SEED, async () => {
      const engine = createRenderEngine(ctx);
      applyMasterState(engine, snapshot);
      return scheduleArrangement(engine, snapshot, plan, signal);
    });
    if (scheduleResult.cancelled) {
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
    return {
      ok: false,
      reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) },
    };
  }
}

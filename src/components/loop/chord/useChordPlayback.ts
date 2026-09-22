import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/store";
import {
  emitStepEvents,
  playFullHoldChord,
  scheduleWholeChord,
} from "@/audio/playback/chordPlayback";
import { buildChordEvents, chordPlanPosition } from "@/audio/playback/plan/chordEvents";
import type { RhythmPattern } from "@/data/chordRhythms";
import {
  cycleHoldScale,
  fullHoldDuration,
  isFullHoldBassCycle,
  isFullHoldRhythmCycle,
} from "@/audio/chordRhythms";
import type { PlaybackPatternCycle } from "@/audio/chordRhythms";
import {
  isApproachToken,
  resolveBassSteps,
} from "@/audio/bassPatterns";
import type { BassPattern } from "@/data/bassPatterns";
import {
  STEPS_PER_BAR,
  generateBlockChordNotes,
  stepDurationSec,
  barDurationSec,
} from "@/utils/musicTheory";
import {
  ACCOMPANIMENT_SOURCES,
  HARD_STOP_RELEASE,
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopOwnedVoices,
  subscribePlaybackClock,
} from "@/audio/playback/playbackEngine";
import type { AccompanimentSource } from "@/audio/playback/playbackEngine";
import { getMeter } from "@/utils/meter";
import { armOnBarLine, isSoftStopBoundary, shouldHardStopNow } from "@/components/playerStop";
import type { PlayerState } from "@/store/types";
import type { ChordItem } from "@/types";
import type { ActiveSynth } from "@/types/synth";
import { synthReleaseSeconds } from "@/utils/synthPatch";
import { publishStepAt, resetStep } from "@/components/playbackStep";
import { planPadArm } from "@/audio/playback/plan/padPlan";
import {
  planChordArm,
  planChordStep,
  type ArmedChordPlan,
} from "@/audio/playback/plan/chordPlan";
import { chordPlanSnapshot, padPlanSnapshot } from "@/store/playbackPlanSnapshots";

/**
 * Where the chord+bass scheduler currently is on the shared grid. Kept as a
 * plain object behind a ref so the pure step logic below can be tested
 * without React (the repo has no DOM test setup).
 */
export interface ChordArming {
  armed: boolean;
  chordIndex: number;
  nextBarStep: number;
  /** Previous clock step, tracked so a resetClock rewind (step going backwards) can be detected. */
  lastStep: number;
  /**
   * The clock step this playback RUN began on — the bar line the stopped
   * player armed on, set once and never re-set per chord. Every cycle column is
   * measured from it (`step - playbackOriginStep`), so a two-bar chord cycle
   * and a three-bar bass cycle keep phase across the chords that follow, and
   * the first tick of a run is column zero of both even when the shared clock
   * was already counting.
   */
  playbackOriginStep: number;
}

export function createChordArming(): ChordArming {
  return { armed: false, chordIndex: 0, nextBarStep: 0, lastStep: 0, playbackOriginStep: 0 };
}

/**
 * Rewind the scheduler. MUST run on every transition to 'stopped', including
 * the ones React never renders: the Instant Vibe swap hard-stops and replays
 * inside a single batched click, so `nextBarStep` (which counts absolute clock
 * steps) would survive while engineSync's `resetClock` rewinds the clock to 0
 * — every step then fails the `step < nextBarStep` gate until the clock counts
 * back up, i.e. the player goes silent for as long as it had been playing.
 */
export function resetChordArming(arming: ChordArming): void {
  arming.armed = false;
  arming.chordIndex = 0;
  arming.nextBarStep = 0;
  arming.lastStep = 0;
  // The origin goes with the rest of the arming, deliberately: the next run
  // must measure its cycles from ITS OWN first bar line, not from one the
  // outgoing run left behind.
  arming.playbackOriginStep = 0;
}

/**
 * Rewind the scheduler when the shared clock has jumped backwards. `nextBarStep`
 * counts ABSOLUTE steps, so after a loadLoop/instant-vibe swap resets the
 * clock to 0 mid-dispatch, the chord listener would otherwise re-arm on the
 * stale pre-reset step and leave `nextBarStep` pointing past the reset grid —
 * the progression then goes silent for the whole next loop. The sequencer
 * and lead are immune (they arm bar-relative); only the chord scheduler tracks
 * an absolute advance, so it alone needs this rewind.
 */
export function rewindChordOnClockReset(arming: ChordArming, step: number): void {
  if (step < arming.lastStep) resetChordArming(arming);
  arming.lastStep = step;
}

/**
 * The active bar length in 16th steps, read LIVE from the store.
 *
 * Exported so the pure-logic tests can reason about it without React, and used
 * everywhere the module previously leaned on the STEPS_PER_BAR default. Live,
 * not captured: the clock subscription outlives a React commit and one
 * clockTick dispatches several steps synchronously.
 */
export function activeStepsPerBar(): number {
  return getMeter(useAppStore.getState().meterId).stepsPerBar;
}

/**
 * Strikes the pad's voicing and schedules its release.
 *
 * The DECISION is `planPadArm`'s and is pure; this function is the controller
 * half — one store read, one engine call. The pad has no rhythm pattern, so one
 * arm is one note-on/note-off pair and there is no per-step emission:
 * ArmedChordPlan and emitChordPlanStep stay untouched by it.
 */
function armPad(chordIndex: number, time: number): void {
  const s = useAppStore.getState();
  const arm = planPadArm(padPlanSnapshot(s), { chordIndex });
  if (!arm) return;
  playFullHoldChord(arm.notes, s.padSynthParams, time, arm.holdSec, 'pad');
}

/**
 * Arms a chord: the pure plan, plus the one-shot voices of the full-hold
 * patterns.
 *
 * The DECISION is `planChordArm`'s — one read of the loop state per plan, with
 * neither lane's cycle re-read on a clock tick. What is left here is the
 * controller's half: the store read, the engine init, and firing the two full
 * holds (single long voices that `updateSynthPatch` can already re-shape live,
 * so they need no per-step work).
 */
function startChordPlan(
  chordIndex: number,
  startProgressionStep: number,
  time: number,
): ArmedChordPlan {
  initPlaybackEngine();
  const s = useAppStore.getState();
  const plan = planChordArm(chordPlanSnapshot(s), { chordIndex, startProgressionStep });

  if (plan.chordFullHold) {
    playFullHoldChord(
      plan.chordFullHold.notes,
      s.chordSynthParams,
      time,
      plan.chordFullHold.holdSec,
      "chord",
    );
  }
  if (plan.bassFullHold) {
    const voiceId = playbackNoteOn(
      plan.bassFullHold.noteName,
      s.bassSynthParams,
      plan.bassFullHold.velocity,
      time,
      "bass",
    );
    playbackNoteOff(
      voiceId,
      synthReleaseSeconds(s.bassSynthParams),
      time + plan.bassFullHold.holdSec,
    );
  }
  return plan;
}

/**
 * Fires the chord and bass voices that land on this clock step. The events are
 * `planChordStep`'s; the patches are read from the store at call time, so every
 * timbre knob is heard on the very next hit.
 */
function emitChordPlanStep(
  plan: ArmedChordPlan,
  progressionStep: number,
  pos: { isLastBar: boolean; stepsRemaining: number },
  step: number,
  time: number,
): void {
  const s = useAppStore.getState();
  const stepDur = stepDurationSec(s.bpm);
  const chordEnd = time + pos.stepsRemaining * stepDur;
  const events = planChordStep(plan, {
    progressionStep,
    step,
    isLastBar: pos.isLastBar,
    stepsPerBar: getMeter(s.meterId).stepsPerBar,
    stepDurSec: stepDur,
    chordArp: s.chordArpSettings,
    bassArp: s.bassArpSettings,
    chordFeel: s.chordFeel,
    bassFeel: s.bassFeel,
  });

  emitStepEvents(events.chord, s.chordSynthParams, "chord", time, chordEnd);
  emitStepEvents(events.bass, s.bassSynthParams, "bass", time, chordEnd);
}

export type ChordStepAction = 'idle' | 'soft-stop' | 'play';

/**
 * What the clock callback should do for `step`. Arms (mutating `arming`) on
 * the first bar line it sees, so the progression always enters on beat 1.
 *
 * `state` must be read LIVE from the store, never from a React ref: a stop
 * fired from inside this callback leaves the clock subscription live until
 * React commits, and one `clockTick` dispatches several steps synchronously
 * (lookahead 0.1s vs a 0.0625s step at 240 BPM) — a stale 'stopping' would
 * let a whole extra chord fire a sixteenth after the cut.
 */
export function chordStepAction(
  state: PlayerState,
  step: number,
  arming: ChordArming,
  stepsPerBar: number = STEPS_PER_BAR,
): ChordStepAction {
  if (state === 'stopped') return 'idle';
  if (isSoftStopBoundary(state, step, stepsPerBar)) return 'soft-stop';
  const wasArmed = arming.armed;
  if (!armOnBarLine(arming, step, stepsPerBar)) return 'idle';
  if (!wasArmed) {
    arming.chordIndex = 0;
    arming.nextBarStep = step;
    // The run's one origin, set here and nowhere else: this is the tick the
    // first chord is armed on, so it is also column zero of both cycles.
    arming.playbackOriginStep = step;
  }
  if (step < arming.nextBarStep) return 'idle';
  return 'play';
}

// Master playback loop hook. Moved here from audio/playback/chordPlayback.ts
// (layering rule 1: audio/ must not import store/) — the hook reads store
// state, so it is a component-layer concern; the engine is reached only
// through the audio-layer bridge in playbackEngine.ts (layering rule 3).

/** Everything this module reads out of the store, in one shape. */
interface ChordPlaybackState {
  chords: ChordItem[];
  bpm: number;
  chordSynthParams: ActiveSynth;
  chordOctave: number;
  chordFeel: number;
  bassSynthParams: ActiveSynth;
  bassOctave: number;
  bassFeel: number;
  scaleRoot: string;
  scaleType: string;
  playerState: PlayerState;
}

function useChordPlaybackState(): ChordPlaybackState {
  const chords = useAppStore((s) => s.chords);
  const bpm = useAppStore((s) => s.bpm);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const chordFeel = useAppStore((s) => s.chordFeel);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  // padSynthParams is deliberately NOT subscribed here: only `.release` is
  // ever read, and only at the soft-stop, which reads it live from getState()
  // exactly as armPad does. Subscribing would re-render this hook on every
  // frame of a pad knob drag for a value nothing renders.
  const playerState = useAppStore((s) => s.chordsPlayer);
  return { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, playerState };
}

/**
 * The chord layer's audition player: a card's hold-to-preview, and the
 * auto-preview that fires when a chord is picked.
 *
 * Pattern previews only. These are driven by a timer rather than the shared
 * clock, so they still lay the whole cycle down in one call; the transport
 * path arms an ArmedChordPlan and emits it step by step instead.
 *
 * The caller hands in the RESOLVED cycle, not a pattern: a preset's cycle is
 * one bar and a custom lane's is its own `loopLength * stepsPerBar`, and the
 * timer the caller loops at must be that same length. Deriving the walk from
 * the one-bar preview chord instead scheduled a single step for every preset.
 */
function useChordPatternPreview({
  bpm,
  chordSynthParams,
  chordOctave,
  chordFeel,
}: ChordPlaybackState) {
  return useCallback(
    (chord: ChordItem, startTime: number, cycle: PlaybackPatternCycle<RhythmPattern>) => {
      initPlaybackEngine();

      const stepsPerBar = activeStepsPerBar();
      const barDur = barDurationSec(bpm, stepsPerBar);
      const notes = generateBlockChordNotes(
        chord.quality,
        chord.root,
        chordOctave,
      );
      const stepDur = stepDurationSec(bpm);
      // Feel may only TIGHTEN a span the user drew, so the cycle's own custom
      // flag picks the scale — the same rule the transport lane follows.
      const holdScale = cycleHoldScale(cycle.custom, chordFeel);

      if (isFullHoldRhythmCycle(cycle)) {
        // A preset cycle is one bar, so this is the whole-chord fast path; a
        // custom span covering the cycle is a span and stays on the walk below.
        playFullHoldChord(
          notes,
          chordSynthParams,
          startTime,
          fullHoldDuration(cycle.cycleSteps / stepsPerBar, barDur, holdScale),
          "chord",
        );
        return;
      }

      scheduleWholeChord(
        buildChordEvents(cycle.pattern, notes, stepDur, holdScale),
        chordSynthParams,
        "chord",
        startTime,
        stepDur,
        cycle.cycleSteps,
        cycle.cycleSteps,
      );
    },
    [bpm, chordSynthParams, chordOctave, chordFeel],
  );
}

/**
 * The bass line's audition player, the bass half of the same preview pair.
 *
 * `chordContext` is what lets a caller audition against a progression other
 * than the one in the store (the library's own preview); omitted, it falls back
 * to the live `chords`, which is what the card's hold-to-preview passes.
 */
function useBassPatternPreview({
  chords,
  bassOctave,
  scaleRoot,
  scaleType,
  bpm,
  bassSynthParams,
  bassFeel,
}: ChordPlaybackState) {
  return useCallback(
    (
      chord: ChordItem,
      startTime: number,
      cycle: PlaybackPatternCycle<BassPattern>,
      chordContext?: ChordItem[],
    ) => {
      initPlaybackEngine();
      const stepsPerBar = activeStepsPerBar();
      const barDur = barDurationSec(bpm, stepsPerBar);
      const context = chordContext ?? chords;
      const chordIdx = Math.max(0, context.indexOf(chord));
      const stepDur = stepDurationSec(bpm);
      const holdScale = cycleHoldScale(cycle.custom, bassFeel);
      const resolveWithHold = (scale: number) =>
        resolveBassSteps(
          cycle.pattern,
          context,
          chordIdx,
          bassOctave,
          scaleRoot,
          scaleType,
          bpm,
          scale,
        );

      if (isFullHoldBassCycle(cycle)) {
        const rootEvent = resolveWithHold(1)[0];
        if (rootEvent) {
          const voiceId = playbackNoteOn(
            rootEvent.noteName,
            bassSynthParams,
            rootEvent.velocity,
            startTime,
            "bass",
          );
          playbackNoteOff(
            voiceId,
            synthReleaseSeconds(bassSynthParams),
            startTime + fullHoldDuration(cycle.cycleSteps / stepsPerBar, barDur, holdScale),
          );
        }
        return;
      }

      scheduleWholeChord(
        resolveWithHold(holdScale).map((ev) => ({
          step: ev.step,
          noteName: ev.noteName,
          velocity: ev.velocity,
          timeOffset: 0,
          hold: ev.holdSec,
          lastBarOnly: isApproachToken(ev.token),
        })),
        bassSynthParams,
        "bass",
        startTime,
        stepDur,
        cycle.cycleSteps,
        cycle.cycleSteps,
      );
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams, bassFeel],
  );
}

/**
 * The mutable state the two subscriptions below share: where the scheduler is,
 * the chord being emitted, and whether a soft stop still owes a release.
 *
 * Refs rather than state, and held together because the stop handler and the
 * clock callback reset the same three together — one reset site is what makes
 * that reset identical on both paths.
 */
function useChordScheduler() {
  const armingRef = useRef<ChordArming>(createChordArming());

  // The chord currently being emitted step by step. Cleared on every stop so a
  // restart never keeps emitting the chord that was cut.
  const planRef = useRef<ArmedChordPlan | null>(null);

  // The soft path also ends on 'stopped'. This ref tells the stop handler
  // that a release is already scheduled on the audio clock, so it must not
  // fire a second, immediate stopSource and clip the tail.
  const softStopPendingRef = useRef(false);

  return { armingRef, planRef, softStopPendingRef };
}

/**
 * The current release times of the two layers this player emits, mirrored into
 * a ref the clock callback reads.
 *
 * Via ref because the clock
 * effect's dep array must not gain chordSynthParams/bassSynthParams (that
 * would resubscribe on every param slide), but the soft-stop path must
 * still use whatever release is currently configured, not a stale one
 * captured when the clock subscription was created.
 */
function useChordReleases(chordRelease: number, bassRelease: number) {
  const releasesRef = useRef({ chord: chordRelease, bass: bassRelease });
  useEffect(() => {
    releasesRef.current = { chord: chordRelease, bass: bassRelease };
  });
  return releasesRef;
}

/** Everything that reads or resets the scheduler's shared refs. */
interface ChordSchedulerRefs {
  armingRef: { current: ChordArming };
  planRef: { current: ArmedChordPlan | null };
  softStopPendingRef: { current: boolean };
}

/**
 * Stop handling. Subscribed to the store directly instead of keyed on the
 * rendered `playerState`, because React cannot be relied on to SEE the
 * stop: the Instant Vibe swap hard-stops and restarts inside one batched
 * click handler, so the rendered value goes 'playing' -> 'playing' and an
 * effect keyed on it never re-runs (measured: one 'playing' render while
 * the store passed through 'stopped'). Zustand notifies synchronously on
 * every setState, so this sees every transition, in order.
 *
 * Cut ALL THREE sources: the Chords player drives the bass line and the pad
 * layer, so silencing 'chord' alone would leave the bass and the pad
 * droning — and a drone holds the longest note in the app.
 *
 * playbackStopOwnedVoices, not playbackStopSource: keyboard/arp input can
 * land on 'chord'/'bass'/'pad' too via focus routing, and a whole-bus stop
 * would cut a held key or arp note off that bus the moment this player
 * stops — the same bug per-voice provenance fixed for lead/FX. This
 * player's own hits all carry owner 'sequencer' (chordPlayback.ts), which
 * is what the wrapper pins.
 */
function useChordStopHandler(
  { armingRef, planRef, softStopPendingRef }: ChordSchedulerRefs,
  clearChordUi: () => void,
): void {
  useEffect(
    () =>
      useAppStore.subscribe(
        (s) => s.chordsPlayer,
        (next, prev) => {
          if (next === 'stopped') {
            // Rewind here, not in the clock effect's !isPlaying branch: that
            // branch is a render-time observation and a batched stop/restart
            // skips it, stranding nextBarStep ahead of a clock that
            // engineSync just reset to 0.
            resetChordArming(armingRef.current);
            planRef.current = null;
            clearChordUi();
          }
          if (!shouldHardStopNow(prev, next, softStopPendingRef.current)) {
            // Only 'stopping' means a soft stop is still pending its bar-line
            // release; any other state (including a jump straight back to
            // 'playing') means the pending release either already fired or was
            // superseded, so the flag must not survive it.
            if (next !== 'stopping') softStopPendingRef.current = false;
            // A soft stop with no chords has nothing to play out: the clock
            // effect below early-returns without subscribing when there are no
            // chords, so the bar-line check that would normally complete the
            // stop never runs. This handler sees every transition, so it is
            // the reliable place to catch that case and finish the stop
            // instead of stranding it in 'stopping'.
            else if (useAppStore.getState().chords.length === 0) {
              useAppStore.getState().hardStop('chords');
            }
            return;
          }
          for (const source of ACCOMPANIMENT_SOURCES) {
            playbackStopOwnedVoices(source, HARD_STOP_RELEASE);
          }
        },
      ),
    // The three scheduler refs and `clearChordUi` (a stable useCallback) are
    // not render inputs: nothing here changes identity for the life of the
    // hook, so depending on them would only re-subscribe on nothing. The
    // subscription must also outlive the commits that skip this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

/**
 * The clock subscription: arm a chord on a bar line, emit its plan step by
 * step, and cut all three sources on a soft-stop boundary.
 *
 * One effect owns both the subscription and its teardown, so nothing but
 * `isPlaying`/`chords` can ever leave a clock listener behind.
 */
function useChordClock({
  scheduler,
  releasesRef,
  isPlaying,
  chords,
  clearChordUi,
  showChord,
}: {
  scheduler: ChordSchedulerRefs;
  releasesRef: { current: { chord: number; bass: number } };
  isPlaying: boolean;
  chords: ChordItem[];
  clearChordUi: () => void;
  showChord: (index: number, chord: ChordItem) => void;
}): void {
  const { armingRef, planRef, softStopPendingRef } = scheduler;

  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      resetChordArming(armingRef.current);
      planRef.current = null;
      clearChordUi();
      return;
    }

    return subscribePlaybackClock((step, beat, time) => {
      const arming = armingRef.current;
      rewindChordOnClockReset(arming, step);
      // Live store read, not a ref: see chordStepAction's doc comment.
      const playerState = useAppStore.getState().chordsPlayer;
      const stepsPerBar = activeStepsPerBar();
      const action = chordStepAction(playerState, step, arming, stepsPerBar);

      // The run's step: one subtraction, and the ONLY place the origin is
      // applied. Everything below schedules from this number, and the publish
      // sits AFTER the arming transition above because that transition is what
      // sets the origin — the tick that arms reports 0, so both custom cycles
      // begin at column zero even when the shared clock was already counting.
      // The value stays absolute within the run, never reduced modulo a bar:
      // each timeline reader folds it by its own cycle width.
      const progressionStep = step - arming.playbackOriginStep;
      publishStepAt('chords', progressionStep, time);

      // Soft stop: schedule the release exactly on the bar line the clock is
      // handing us, then mark the player stopped. Using the clock's `time`
      // (not a timer) is what makes the cut land on the beat.
      if (action === 'soft-stop') {
        planRef.current = null;
        // The pad's release is read LIVE, the way armPad reads the rest of
        // the pad state: this hook does not subscribe to padSynthParams, so a
        // value mirrored into releasesRef on render would go stale the moment
        // a pad knob moved without re-rendering the hook. chord/bass stay on
        // the ref because they are already subscribed for other reads —
        // an inconsistency kept deliberately rather than widening either.
        const releases: Record<AccompanimentSource, number> = {
          ...releasesRef.current,
          pad: synthReleaseSeconds(useAppStore.getState().padSynthParams),
        };
        for (const source of ACCOMPANIMENT_SOURCES) {
          playbackStopOwnedVoices(source, releases[source], time);
        }
        softStopPendingRef.current = true;
        // Read the action live, the way the transition handler above does: the
        // clock subscription is torn down and rebuilt only on isPlaying/chords,
        // so a closed-over hardStop would have to join that dependency list and
        // resubscribe the clock for a value that never changes.
        useAppStore.getState().hardStop('chords');
        return;
      }

      if (action === 'play') {
        // Read the progression LIVE, not from the effect closure: on a loop
        // switch the old subscription still gets the boundary step before React
        // swaps it out, and a closure would play the OLD loop's chord against
        // the NEW loop's synth state. startChordPlan's own snapshot read then
        // resolves the index against the current loop's progression.
        const liveChords = useAppStore.getState().chords;
        if (liveChords.length === 0) return;
        const index = arming.chordIndex % liveChords.length;
        const chord = liveChords[index];
        planRef.current = startChordPlan(index, progressionStep, time);
        armPad(index, time);
        showChord(index, chord);
        // The beat the chord was triggered on is what every beat counter measures
        // its progress from — a multi-bar chord spans several bar lines.
        useAppStore.getState().setPlayheadChord(index, beat);
        arming.nextBarStep = step + (chord.bars || 1) * stepsPerBar;
        arming.chordIndex++;
      }

      // 'idle' also covers "mid-chord, keep playing" — a stopped player is the
      // only idle that must stay silent.
      if (playerState === 'stopped') return;
      const plan = planRef.current;
      if (!plan) return;
      const pos = chordPlanPosition(plan, progressionStep, stepsPerBar);
      if (!pos) {
        planRef.current = null;
        return;
      }
      emitChordPlanStep(plan, progressionStep, pos, step, time);
    });
    // Deliberately these two and no more. The scheduler refs and `releasesRef`
    // are stable, and `clearChordUi`/`showChord` are stable useCallbacks — a
    // clock subscription that rebuilt when any of them changed identity would
    // re-arm mid-bar. `chordSynthParams`/`bassSynthParams` are read live
    // through `releasesRef` for the same reason (see its docblock), and the
    // progression is read live inside the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, chords]);
}

export function useChordPlayback() {
  const state = useChordPlaybackState();
  const { chords, chordSynthParams, bassSynthParams, playerState } = state;
  const isPlaying = playerState !== 'stopped';

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [activeChordId, setActiveChordId] = useState<string | null>(null);

  const playChordWithRhythm = useChordPatternPreview(state);
  const playBassWithPattern = useBassPatternPreview(state);

  const scheduler = useChordScheduler();
  const releasesRef = useChordReleases(
    synthReleaseSeconds(chordSynthParams),
    synthReleaseSeconds(bassSynthParams),
  );

  // Both subscriptions clear the same three pieces of chord UI — the beat
  // markers, the highlighted card, and the transport's chord readout.
  const clearChordUi = useCallback(() => {
    setPlayingIndex(null);
    resetStep('chords');
    setActiveChordId(null);
    useAppStore.getState().setPlayheadChord(null);
  }, []);

  const showChord = useCallback((index: number, chord: ChordItem) => {
    setPlayingIndex(index);
    setActiveChordId(chord.id);
  }, []);

  useChordStopHandler(scheduler, clearChordUi);
  useChordClock({
    scheduler,
    releasesRef,
    isPlaying,
    chords,
    clearChordUi,
    showChord,
  });

  return { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId, isPlaying };
}

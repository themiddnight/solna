import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/store";
import {
  arpEventsForStep,
  buildChordEvents,
  chordPlanPosition,
  emitStepEvents,
  eventsForStep,
  playFullHoldChord,
  scheduleWholeChord,
} from "../../audio/playback/chordPlayback";
import type { BarInvariantEvent } from "../../audio/playback/chordPlayback";
import {
  RHYTHM_PATTERNS,
  RhythmPattern,
  feelToHoldScale,
  fullHoldDuration,
} from "../../audio/rhythmPatterns";
import {
  BASS_PATTERNS,
  BassPattern,
  isApproachToken,
  resolveBassSteps,
} from "../../audio/bassPatterns";
import {
  generateBlockChordNotes,
  stepDurationSec,
  barDurationSec,
} from "../../utils/musicTheory";
import {
  STEPS_PER_BAR,
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopSource,
  subscribePlaybackClock,
} from "../../audio/playback/playbackEngine";
import { armOnBarLine, isSoftStopBoundary, shouldHardStopNow } from "../playerStop";
import type { PlayerState } from "../../store/types";
import type { ChordItem } from "../../types";

/** Short enough to read as an instant cut, long enough not to click. */
const HARD_STOP_RELEASE = 0.02;

/**
 * Where the chord+bass scheduler currently is on the shared grid. Kept as a
 * plain object behind a ref so the pure step logic below can be tested
 * without React (the repo has no DOM test setup).
 */
export interface ChordArming {
  armed: boolean;
  chordIndex: number;
  nextBarStep: number;
}

export function createChordArming(): ChordArming {
  return { armed: false, chordIndex: 0, nextBarStep: 0 };
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
}

/**
 * A chord's playback shape, resolved once when the chord is armed and then
 * emitted one clock step at a time. The events are held here instead of being
 * pushed onto the audio clock upfront so nothing is ever scheduled more than
 * the clock's own lookahead ahead of now — which is what lets a knob tweak
 * reach the next hit rather than the next chord.
 *
 * The arp/pattern choice is fixed at arm time (flipping Arp mid-chord would
 * otherwise stack an arpeggio on top of a chord already sounding); every synth
 * param is read live at emit time.
 */
interface ChordPlan {
  startStep: number;
  totalBars: number;
  chordNotes: string[];
  bassNotes: string[];
  chordArp: boolean;
  bassArp: boolean;
  chordEvents: BarInvariantEvent[];
  bassEvents: BarInvariantEvent[];
}

/** Patterns that hold one voice across the whole chord instead of re-striking. */
function isFullHoldRhythm(pattern: RhythmPattern): boolean {
  return (
    pattern.id === "sustained" ||
    (pattern.hits.length === 1 &&
      pattern.hits[0].step === 0 &&
      (pattern.hits[0].holdSteps ?? 1) >= 16)
  );
}

function isFullHoldBass(pattern: BassPattern): boolean {
  return (
    pattern.id === "whole-note-root" ||
    (pattern.steps.length === 1 &&
      pattern.steps[0].step === 0 &&
      (pattern.steps[0].holdSteps ?? 1) >= 16)
  );
}

function resolveRhythmPattern(id: string): RhythmPattern {
  return RHYTHM_PATTERNS.find((p) => p.id === id) ?? RHYTHM_PATTERNS[0];
}

function resolveBassPattern(id: string): BassPattern {
  return BASS_PATTERNS.find((p) => p.id === id) ?? BASS_PATTERNS[0];
}

/**
 * Arms a chord: resolves its notes and pattern events, and fires the one-shot
 * voices of the full-hold patterns (those are single long voices that
 * updateSynthParams can already re-shape live, so they need no per-step work).
 */
function startChordPlan(chord: ChordItem, startStep: number, time: number): ChordPlan {
  initPlaybackEngine();
  const s = useAppStore.getState();
  const stepDur = stepDurationSec(s.bpm);
  const barDur = barDurationSec(s.bpm);
  const totalBars = chord.bars || 1;

  const chordNotes = generateBlockChordNotes(chord.quality, chord.root, s.chordOctave);
  const bassNotes = generateBlockChordNotes(chord.quality, chord.root, s.bassOctave);
  const chordArp = !!s.chordSynthParams.arpActive;
  const bassArp = !!s.bassSynthParams.arpActive;

  let chordEvents: BarInvariantEvent[] = [];
  if (!chordArp) {
    const pattern = resolveRhythmPattern(s.chordRhythmId);
    const holdScale = feelToHoldScale(s.chordFeel);
    if (isFullHoldRhythm(pattern)) {
      playFullHoldChord(
        chordNotes,
        s.chordSynthParams,
        time,
        fullHoldDuration(totalBars, barDur, holdScale),
      );
    } else {
      chordEvents = buildChordEvents(pattern, chordNotes, stepDur, holdScale);
    }
  }

  let bassEvents: BarInvariantEvent[] = [];
  if (!bassArp) {
    const pattern = resolveBassPattern(s.bassPatternId);
    const chordIdx = Math.max(0, s.chords.indexOf(chord));
    const resolveWithHold = (holdScale: number) =>
      resolveBassSteps(
        pattern,
        s.chords,
        chordIdx,
        s.bassOctave,
        s.scaleRoot,
        s.scaleType,
        s.bpm,
        holdScale,
      );

    if (isFullHoldBass(pattern)) {
      const rootEvent = resolveWithHold(1)[0];
      if (rootEvent) {
        playbackNoteOn(rootEvent.noteName, s.bassSynthParams, rootEvent.velocity, time, "bass");
        playbackNoteOff(
          rootEvent.noteName,
          s.bassSynthParams.release,
          time + fullHoldDuration(totalBars, barDur, feelToHoldScale(s.bassFeel)),
          "bass",
        );
      }
    } else {
      bassEvents = resolveWithHold(feelToHoldScale(s.bassFeel)).map((ev) => ({
        step: ev.step,
        noteName: ev.noteName,
        velocity: ev.velocity,
        timeOffset: 0,
        hold: ev.holdSec,
        // Approach tones lead into the NEXT chord, so they belong to the last bar.
        lastBarOnly: isApproachToken(ev.token),
      }));
    }
  }

  return { startStep, totalBars, chordNotes, bassNotes, chordArp, bassArp, chordEvents, bassEvents };
}

/**
 * Fires the chord and bass voices that land on this clock step. Params come
 * from the store at call time, so every timbre knob is heard on the very next
 * hit; the arp reads the ABSOLUTE step so it keeps stride across chords.
 */
function emitChordPlanStep(
  plan: ChordPlan,
  pos: { stepInBar: number; isLastBar: boolean; stepsRemaining: number },
  step: number,
  time: number,
): void {
  const s = useAppStore.getState();
  const stepDur = stepDurationSec(s.bpm);
  const chordEnd = time + pos.stepsRemaining * stepDur;

  emitStepEvents(
    plan.chordArp
      ? arpEventsForStep(plan.chordNotes, s.chordSynthParams, step, stepDur, feelToHoldScale(s.chordFeel))
      : eventsForStep(plan.chordEvents, pos.stepInBar, pos.isLastBar),
    s.chordSynthParams,
    "chord",
    time,
    chordEnd,
  );

  emitStepEvents(
    plan.bassArp
      ? arpEventsForStep(plan.bassNotes, s.bassSynthParams, step, stepDur, feelToHoldScale(s.bassFeel))
      : eventsForStep(plan.bassEvents, pos.stepInBar, pos.isLastBar),
    s.bassSynthParams,
    "bass",
    time,
    chordEnd,
  );
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
  }
  if (step < arming.nextBarStep) return 'idle';
  return 'play';
}

// Master playback loop hook. Moved here from audio/playback/chordPlayback.ts
// (layering rule 1: audio/ must not import store/) — the hook reads store
// state, so it is a component-layer concern; the engine is reached only
// through the audio-layer bridge in playbackEngine.ts (layering rule 3).
function useChordPlaybackState() {
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
  const playerState = useAppStore((s) => s.chordsPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  return { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, playerState, hardStop };
}

export function useChordPlayback() {
  const state = useChordPlaybackState();
  const { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, playerState, hardStop } = state;
  const isPlaying = playerState !== 'stopped';

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [activeChordId, setActiveChordId] = useState<string | null>(null);

  // Pattern previews only. These are driven by a bar timer rather than the
  // shared clock, so they still lay the whole chord down in one call; the
  // transport path arms a ChordPlan and emits it step by step instead.
  const playChordWithRhythm = useCallback(
    (chord: ChordItem, startTime: number, pattern: RhythmPattern) => {
      initPlaybackEngine();

      const notes = generateBlockChordNotes(
        chord.quality,
        chord.root,
        chordOctave,
      );
      const stepDur = stepDurationSec(bpm);
      const totalBars = chord.bars || 1;
      const holdScale = feelToHoldScale(chordFeel);

      if (isFullHoldRhythm(pattern)) {
        const barDur = barDurationSec(bpm);
        playFullHoldChord(
          notes,
          chordSynthParams,
          startTime,
          fullHoldDuration(totalBars, barDur, holdScale),
        );
        return;
      }

      scheduleWholeChord(
        buildChordEvents(pattern, notes, stepDur, holdScale),
        chordSynthParams,
        "chord",
        startTime,
        stepDur,
        totalBars,
      );
    },
    [bpm, chordSynthParams, chordOctave, chordFeel],
  );

  const playBassWithPattern = useCallback(
    (
      chord: ChordItem,
      startTime: number,
      pattern: BassPattern,
      chordContext?: ChordItem[],
    ) => {
      initPlaybackEngine();
      const context = chordContext ?? chords;
      const chordIdx = Math.max(0, context.indexOf(chord));
      const stepDur = stepDurationSec(bpm);
      const totalBars = chord.bars || 1;
      const resolveWithHold = (holdScale: number) =>
        resolveBassSteps(
          pattern,
          context,
          chordIdx,
          bassOctave,
          scaleRoot,
          scaleType,
          bpm,
          holdScale,
        );

      if (isFullHoldBass(pattern)) {
        const barDur = barDurationSec(bpm);
        const rootEvent = resolveWithHold(1)[0];
        if (rootEvent) {
          playbackNoteOn(
            rootEvent.noteName,
            bassSynthParams,
            rootEvent.velocity,
            startTime,
            "bass",
          );
          playbackNoteOff(
            rootEvent.noteName,
            bassSynthParams.release,
            startTime + fullHoldDuration(totalBars, barDur, feelToHoldScale(bassFeel)),
            "bass",
          );
        }
        return;
      }

      scheduleWholeChord(
        resolveWithHold(feelToHoldScale(bassFeel)).map((ev) => ({
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
        totalBars,
      );
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams, bassFeel],
  );

  const armingRef = useRef<ChordArming>(createChordArming());

  // The chord currently being emitted step by step. Cleared on every stop so a
  // restart never keeps emitting the chord that was cut.
  const planRef = useRef<ChordPlan | null>(null);

  // The soft path also ends on 'stopped'. This ref tells the stop handler
  // that a release is already scheduled on the audio clock, so it must not
  // fire a second, immediate stopSource and clip the tail.
  const softStopPendingRef = useRef(false);

  // Latest release values via ref: the clock
  // effect's dep array must not gain chordSynthParams/bassSynthParams (that
  // would resubscribe on every param slide), but the soft-stop path must
  // still use whatever release is currently configured, not a stale one
  // captured when the clock subscription was created.
  const releasesRef = useRef({
    chord: chordSynthParams.release,
    bass: bassSynthParams.release,
  });
  useEffect(() => {
    releasesRef.current = {
      chord: chordSynthParams.release,
      bass: bassSynthParams.release,
    };
  });

  // Stop handling. Subscribed to the store directly instead of keyed on the
  // rendered `playerState`, because React cannot be relied on to SEE the
  // stop: the Instant Vibe swap hard-stops and restarts inside one batched
  // click handler, so the rendered value goes 'playing' -> 'playing' and an
  // effect keyed on it never re-runs (measured: one 'playing' render while
  // the store passed through 'stopped'). Zustand notifies synchronously on
  // every setState, so this sees every transition, in order.
  //
  // Cut BOTH sources: the Chords player drives the bass line, so silencing
  // 'chord' alone would leave the bass droning.
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
            setPlayingIndex(null);
            setActiveChordId(null);
            useAppStore.getState().setPlayheadChord(null);
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
          playbackStopSource('chord', HARD_STOP_RELEASE);
          playbackStopSource('bass', HARD_STOP_RELEASE);
        },
      ),
    [],
  );

  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      resetChordArming(armingRef.current);
      planRef.current = null;
      setPlayingIndex(null);
      setActiveChordId(null);
      useAppStore.getState().setPlayheadChord(null);
      return;
    }

    return subscribePlaybackClock((step, beat, time) => {
      const arming = armingRef.current;
      // Live store read, not a ref: see chordStepAction's doc comment.
      const playerState = useAppStore.getState().chordsPlayer;
      const action = chordStepAction(playerState, step, arming);

      // Soft stop: schedule the release exactly on the bar line the clock is
      // handing us, then mark the player stopped. Using the clock's `time`
      // (not a timer) is what makes the cut land on the beat.
      if (action === 'soft-stop') {
        planRef.current = null;
        playbackStopSource('chord', releasesRef.current.chord, time);
        playbackStopSource('bass', releasesRef.current.bass, time);
        softStopPendingRef.current = true;
        hardStop('chords');
        return;
      }

      if (action === 'play') {
        const index = arming.chordIndex % chords.length;
        const chord = chords[index];
        planRef.current = startChordPlan(chord, step, time);
        setPlayingIndex(index);
        setActiveChordId(chord.id);
        // The beat the chord was triggered on is what every beat counter measures
        // its progress from — a multi-bar chord spans several bar lines.
        useAppStore.getState().setPlayheadChord(index, beat);
        arming.nextBarStep = step + (chord.bars || 1) * STEPS_PER_BAR;
        arming.chordIndex++;
      }

      // 'idle' also covers "mid-chord, keep playing" — a stopped player is the
      // only idle that must stay silent.
      if (playerState === 'stopped') return;
      const plan = planRef.current;
      if (!plan) return;
      const pos = chordPlanPosition(plan, step);
      if (!pos) {
        planRef.current = null;
        return;
      }
      emitChordPlanStep(plan, pos, step, time);
    });
  }, [isPlaying, chords]);

  return { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId };
}

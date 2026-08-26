import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/store";
import {
  buildChordEvents,
  playFullHoldChord,
  scheduleBarInvariantEvents,
} from "../../audio/playback/chordPlayback";
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
  sixteenthNoteMs,
} from "../../utils/musicTheory";
import {
  STEPS_PER_BAR,
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopSource,
  subscribePlaybackClock,
} from "../../audio/playback/playbackEngine";
import { isSoftStopBoundary, shouldHardStopNow } from "../playerStop";
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
  if (!arming.armed) {
    if (step % stepsPerBar !== 0) return 'idle';
    arming.armed = true;
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
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const playerState = useAppStore((s) => s.chordsPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  return { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, rhythmId, bassPatternId, playerState, hardStop };
}

export function useChordPlayback() {
  const state = useChordPlaybackState();
  const { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, rhythmId, bassPatternId, playerState, hardStop } = state;
  const isPlaying = playerState !== 'stopped';

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [activeChordId, setActiveChordId] = useState<string | null>(null);

  const rhythmPattern =
    RHYTHM_PATTERNS.find((p) => p.id === rhythmId) ?? RHYTHM_PATTERNS[0];
  const bassPattern =
    BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];

  // Schedule a whole chord across its bars using the selected rhythm pattern:
  // For sustained/legato full-bar chords, hold seamlessly across all bars without per-bar re-strikes.
  // For rhythmic grooves, schedule bar-invariant hits across each bar.
  const playChordWithRhythm = useCallback(
    (chord: ChordItem, startTime: number, pattern: RhythmPattern) => {
      initPlaybackEngine();

      const notes = generateBlockChordNotes(
        chord.quality,
        chord.root,
        chordOctave,
      );
      const stepDur = sixteenthNoteMs(bpm) / 1000;
      const totalBars = chord.bars || 1;
      const barDur = stepDur * STEPS_PER_BAR;
      const holdScale = feelToHoldScale(chordFeel);

      const isFullHoldPattern =
        pattern.id === "sustained" ||
        (pattern.hits.length === 1 &&
          pattern.hits[0].step === 0 &&
          (pattern.hits[0].holdSteps ?? 1) >= 16);

      if (isFullHoldPattern) {
        // Sustained/Legato full-bar chords: hold continuously across all totalBars without per-bar re-strikes
        const fullChordHold = fullHoldDuration(totalBars, barDur, holdScale);
        playFullHoldChord(notes, chordSynthParams, startTime, fullChordHold);
        return;
      }

      // Precompute the pattern's events once per chord trigger (bar-invariant)
      const events = buildChordEvents(pattern, notes, stepDur, holdScale);

      scheduleBarInvariantEvents(
        events,
        chordSynthParams,
        "chord",
        startTime,
        barDur,
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
      const stepDur = sixteenthNoteMs(bpm) / 1000;
      const barDur = stepDur * STEPS_PER_BAR;
      const totalBars = chord.bars || 1;

      const isFullHoldPattern =
        pattern.id === "whole-note-root" ||
        (pattern.steps.length === 1 &&
          pattern.steps[0].step === 0 &&
          (pattern.steps[0].holdSteps ?? 1) >= 16);

      if (isFullHoldPattern) {
        // Sustained whole-note bass root: hold continuously across all totalBars
        const fullBassHold = fullHoldDuration(
          totalBars,
          barDur,
          feelToHoldScale(bassFeel),
        );
        const resolved = resolveBassSteps(
          pattern,
          context,
          chordIdx,
          bassOctave,
          scaleRoot,
          scaleType,
          bpm,
          1,
        );
        const rootEvent = resolved[0];
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
            startTime + fullBassHold,
            "bass",
          );
        }
        return;
      }

      // Events are bar-invariant (the clock advances by barDur per bar); schedule
      // the resolved set at each bar's start. Approach tokens lead into the NEXT
      // chord, so they only play on the last bar.
      const events = resolveBassSteps(
        pattern,
        context,
        chordIdx,
        bassOctave,
        scaleRoot,
        scaleType,
        bpm,
        feelToHoldScale(bassFeel),
      ).map((ev) => ({
        noteName: ev.noteName,
        velocity: ev.velocity,
        timeOffset: ev.timeOffsetSec,
        hold: ev.holdSec,
        lastBarOnly: isApproachToken(ev.token),
      }));

      scheduleBarInvariantEvents(
        events,
        bassSynthParams,
        "bass",
        startTime,
        barDur,
        totalBars,
      );
    },
    [chords, bassOctave, scaleRoot, scaleType, bpm, bassSynthParams, bassFeel],
  );

  const armingRef = useRef<ChordArming>(createChordArming());

  // The soft path also ends on 'stopped'. This ref tells the stop handler
  // that a release is already scheduled on the audio clock, so it must not
  // fire a second, immediate stopSource and clip the tail.
  const softStopPendingRef = useRef(false);

  // Latest callbacks via ref so param slides (which re-create these callbacks
  // every tick) never resubscribe the clock. Resubscribing on every slider
  // event stops/restarts the shared clock interval faster than it can fire —
  // the scheduler stalls and the next chord arrives late.
  const playFnsRef = useRef({ playChordWithRhythm, playBassWithPattern });
  useEffect(() => {
    playFnsRef.current = { playChordWithRhythm, playBassWithPattern };
  });

  // Latest release values via ref, same reasoning as playFnsRef: the clock
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
            setPlayingIndex(null);
            setActiveChordId(null);
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
      setPlayingIndex(null);
      setActiveChordId(null);
      return;
    }

    return subscribePlaybackClock((step, _beat, time) => {
      const arming = armingRef.current;
      // Live store read, not a ref: see chordStepAction's doc comment.
      const action = chordStepAction(
        useAppStore.getState().chordsPlayer,
        step,
        arming,
      );
      if (action === 'idle') return;

      // Soft stop: schedule the release exactly on the bar line the clock is
      // handing us, then mark the player stopped. Using the clock's `time`
      // (not a timer) is what makes the cut land on the beat.
      if (action === 'soft-stop') {
        playbackStopSource('chord', releasesRef.current.chord, time);
        playbackStopSource('bass', releasesRef.current.bass, time);
        softStopPendingRef.current = true;
        hardStop('chords');
        return;
      }

      const index = arming.chordIndex % chords.length;
      const chord = chords[index];
      playFnsRef.current.playChordWithRhythm(chord, time, rhythmPattern);
      playFnsRef.current.playBassWithPattern(chord, time, bassPattern);
      setPlayingIndex(index);
      setActiveChordId(chord.id);
      arming.nextBarStep = step + (chord.bars || 1) * STEPS_PER_BAR;
      arming.chordIndex++;
    });
  }, [isPlaying, chords, rhythmPattern, bassPattern]);

  return { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId };
}

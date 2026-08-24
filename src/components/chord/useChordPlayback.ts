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
  subscribePlaybackClock,
} from "../../audio/playback/playbackEngine";
import type { ChordItem } from "../../types";

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
  const isPlaying = useAppStore((s) => s.isChordsPlaying);
  return { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, rhythmId, bassPatternId, isPlaying };
}

export function useChordPlayback() {
  const state = useChordPlaybackState();
  const { chords, bpm, chordSynthParams, chordOctave, chordFeel, bassSynthParams, bassOctave, bassFeel, scaleRoot, scaleType, rhythmId, bassPatternId, isPlaying } = state;

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

  const armedRef = useRef(false);
  const chordIndexRef = useRef(0);
  const nextBarStepRef = useRef(0);

  // Latest callbacks via ref so param slides (which re-create these callbacks
  // every tick) never resubscribe the clock. Resubscribing on every slider
  // event stops/restarts the shared clock interval faster than it can fire —
  // the scheduler stalls and the next chord arrives late.
  const playFnsRef = useRef({ playChordWithRhythm, playBassWithPattern });
  useEffect(() => {
    playFnsRef.current = { playChordWithRhythm, playBassWithPattern };
  });

  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      armedRef.current = false;
      setPlayingIndex(null);
      setActiveChordId(null);
      return;
    }

    return subscribePlaybackClock((step, _beat, time) => {
      // Start aligned to the next bar boundary so chord changes land on beat 1
      if (!armedRef.current) {
        if (step % STEPS_PER_BAR !== 0) return;
        armedRef.current = true;
        chordIndexRef.current = 0;
        nextBarStepRef.current = step;
      }
      if (step < nextBarStepRef.current) return;
      const chord = chords[chordIndexRef.current % chords.length];
      playFnsRef.current.playChordWithRhythm(chord, time, rhythmPattern);
      playFnsRef.current.playBassWithPattern(chord, time, bassPattern);
      setPlayingIndex(chordIndexRef.current % chords.length);
      setActiveChordId(chord.id);
      nextBarStepRef.current = step + (chord.bars || 1) * STEPS_PER_BAR;
      chordIndexRef.current++;
    });
  }, [isPlaying, chords, rhythmPattern, bassPattern]);

  return { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId };
}

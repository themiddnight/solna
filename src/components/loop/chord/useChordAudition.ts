import { useCallback } from 'react';
import { useAppStore } from '@/store/store';
import { playFullHoldChord, scheduleWholeChord } from '@/audio/playback/chordPlayback';
import { buildChordEvents } from '@/audio/playback/plan/chordEvents';
import type { RhythmPattern } from '@/data/chordRhythms';
import {
  cycleHoldScale,
  fullHoldDuration,
  isFullHoldBassCycle,
  isFullHoldRhythmCycle,
} from '@/audio/chordRhythms';
import type { PlaybackPatternCycle } from '@/audio/chordRhythms';
import { isApproachToken, resolveBassSteps } from '@/audio/bassPatterns';
import type { BassPattern } from '@/data/bassPatterns';
import { generateBlockChordNotes, stepDurationSec, barDurationSec } from '@/utils/musicTheory';
import { initPlaybackEngine, playbackNoteOff, playbackNoteOn } from '@/audio/playback/playbackEngine';
import type { ChordItem } from '@/types';
import { synthReleaseSeconds } from '@/utils/synthPatch';
import { activeStepsPerBar } from '@/components/playback/useChordClockPlayback';

/**
 * The chord view's audition players (DEV-422): the timer-driven pattern
 * previews, split from the transport controller, which now lives in
 * `PlaybackHost`. Nothing here subscribes the clock.
 */
export interface UseChordAudition {
  playChordWithRhythm(
    chord: ChordItem,
    startTime: number,
    cycle: PlaybackPatternCycle<RhythmPattern>,
  ): void;
  playBassWithPattern(
    chord: ChordItem,
    startTime: number,
    cycle: PlaybackPatternCycle<BassPattern>,
    chordContext?: ChordItem[],
  ): void;
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
function useChordPatternPreview() {
  const bpm = useAppStore((s) => s.bpm);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const chordFeel = useAppStore((s) => s.chordFeel);
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
function useBassPatternPreview() {
  const chords = useAppStore((s) => s.chords);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const bpm = useAppStore((s) => s.bpm);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const bassFeel = useAppStore((s) => s.bassFeel);
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

export function useChordAudition(): UseChordAudition {
  const playChordWithRhythm = useChordPatternPreview();
  const playBassWithPattern = useBassPatternPreview();
  return { playChordWithRhythm, playBassWithPattern };
}

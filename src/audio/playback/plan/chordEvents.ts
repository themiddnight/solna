import { cycleStepAt, equalPowerVelocityScale } from "@/audio/chordRhythms";
import type { RhythmPattern } from "@/data/chordRhythms";
import { buildArpSequence } from "@/audio/arpeggiator";
import { arpFiresOnStep, computeArpTriggers } from "@/audio/arpSchedule";
import { arpStepFor } from "@/utils/timeSignature";
import { shiftNoteOctave } from "@/utils/musicTheory";
import { STEPS_PER_BAR } from "@/utils/tempo";
import { DEFAULT_VELOCITY } from "@/audio/constants";
import type { ArpSettings } from "@/types/synth";

/**
 * One note of a chord's rhythm pattern, positioned on the 16th grid rather
 * than on an absolute timeline. `step` is what the scheduler matches against
 * the clock, so nothing is scheduled before the clock reaches it; `timeOffset`
 * is only the sub-step strum spread.
 */
export interface BarInvariantEvent {
  step: number;
  noteName: string;
  velocity: number;
  timeOffset: number;
  hold: number;
  lastBarOnly?: boolean;
}

/** A BarInvariantEvent already selected for the step being emitted. */
export type StepEvent = Omit<BarInvariantEvent, "step" | "lastBarOnly">;

// Precomputes one chord trigger's bar-invariant events from a rhythm pattern.
export function buildChordEvents(
  pattern: RhythmPattern,
  notes: string[],
  stepDur: number,
  holdScale: number,
): BarInvariantEvent[] {
  return pattern.hits.flatMap((hit) => {
    const hold = Math.max(0.05, (hit.holdSteps ?? 1) * stepDur * holdScale);
    const baseVelocity =
      (hit.velocity ?? DEFAULT_VELOCITY) * equalPowerVelocityScale(notes.length);
    const hitNotes = hit.note !== undefined ? [notes[hit.note]] : notes;
    const isStrum = hit.type === "strum";
    const orderedNotes =
      isStrum && hit.direction === "up" ? [...hitNotes].reverse() : hitNotes;
    const spreadMs = hit.spreadMs ?? 30;

    return orderedNotes.flatMap((n, i) => {
      if (!n) return [];
      const noteName = hit.octaveShift
        ? shiftNoteOctave(n, hit.octaveShift)
        : n;
      const timeOffset = isStrum ? (i * spreadMs) / 1000 : 0;
      const velocity = isStrum
        ? Math.max(0.1, baseVelocity * (1 - i * 0.08))
        : baseVelocity;
      return [{ step: hit.step, noteName, velocity, timeOffset, hold }];
    });
  });
}

/**
 * The one event-phase filter. `stepInCycle` has already been folded onto the
 * cycle the caller schedules, so this is a plain match; the folding is
 * `cycleStepAt`'s job and a second copy of it here is exactly how a preview and
 * the transport came to disagree about a bar line.
 *
 * A single pass avoids the intermediate array `.filter().map()` would allocate;
 * this runs twice per 16th step (chord + bass) for the session.
 */
function phaseEventsForStep(
  events: BarInvariantEvent[],
  stepInCycle: number,
  isLastBar: boolean,
): StepEvent[] {
  const out: StepEvent[] = [];
  for (const ev of events) {
    if (ev.step !== stepInCycle) continue;
    if (!isLastBar && ev.lastBarOnly) continue;
    out.push({
      noteName: ev.noteName,
      velocity: ev.velocity,
      timeOffset: ev.timeOffset,
      hold: ev.hold,
    });
  }
  return out;
}

/**
 * The events of one bar-invariant set that land on the cycle column a
 * progression-relative step falls on. Approach notes lead into the NEXT chord,
 * so `lastBarOnly` events are withheld until the active chord's final bar: a
 * preset's one-bar cycle repeats, but its approach still fires once.
 */
export function eventsForCycleStep(
  events: BarInvariantEvent[],
  progressionStep: number,
  cycleSteps: number,
  isLastBar: boolean,
): StepEvent[] {
  return phaseEventsForStep(events, cycleStepAt(progressionStep, cycleSteps), isLastBar);
}

/**
 * Where a PROGRESSION-relative step falls inside the chord armed at
 * `plan.startProgressionStep`, or null when the step is outside the chord's
 * span.
 *
 * Both the step and the plan's start are measured from the step the PLAYBACK
 * RUN began on (`playbackOriginStep`, held by the caller's arming state) —
 * never from a bar line, and never from the plan's own start. One plan is one
 * chord and a run spans many, so the count has to survive every chord after
 * it, and the plans tile the run exactly: each is armed one whole chord after
 * the last. That is what keeps a two-bar chord cycle and a three-bar bass
 * cycle in phase over a six-bar progression. Each lane folds this one number by
 * its own resolved `cycleSteps` with `eventsForCycleStep`; the fold is
 * deliberately not here, because the two widths differ and this function knows
 * neither.
 *
 * `stepInBar` used to be returned here, and its presence was the one-bar
 * assumption this signature removes: a bar-relative column cannot address
 * column 20 of a two-bar custom cycle, and every caller that wanted one had to
 * reconstruct the cycle it came from.
 */
export function chordPlanPosition(
  plan: { startProgressionStep: number; totalBars: number },
  progressionStep: number,
  stepsPerBar: number = STEPS_PER_BAR,
): { isLastBar: boolean; stepsRemaining: number } | null {
  const totalSteps = plan.totalBars * stepsPerBar;
  const stepInChord = progressionStep - plan.startProgressionStep;
  if (stepInChord < 0 || stepInChord >= totalSteps) return null;
  return {
    isLastBar: Math.floor(stepInChord / stepsPerBar) === plan.totalBars - 1,
    stepsRemaining: totalSteps - stepInChord,
  };
}

/** Arp velocity, matching the keyboard arpeggiator's fixed level. */
const ARP_VELOCITY = 0.9;

/**
 * The arpeggiator's take on a chord: instead of the rhythm pattern's hits,
 * `notes` are expanded by arpMode/arpOctaves and walked one note per trigger.
 * `step` is the ABSOLUTE clock step so the arp keeps its stride across bar and
 * chord boundaries rather than restarting on every chord — but it is bar-phased
 * through `arpStepFor` first, which is the identity in 4/4 and stops the arp
 * from sliding against the bar line in an odd meter.
 */
export function arpEventsForStep(
  notes: string[],
  arp: ArpSettings,
  step: number,
  stepDur: number,
  holdScale: number,
  stepsPerBar: number = STEPS_PER_BAR,
): StepEvent[] {
  const arpStep = arpStepFor(step, stepsPerBar);
  if (!arpFiresOnStep(arpStep, arp.rate)) return [];

  const sequence = buildArpSequence(
    notes,
    arp.mode,
    arp.octaves,
  );
  if (sequence.length === 0) return [];

  return computeArpTriggers(arpStep, sequence.length, arp.rate, stepDur).map(
    (t) => ({
      noteName: sequence[t.noteIndex],
      velocity: ARP_VELOCITY,
      timeOffset: t.timeOffsetSec,
      // Feel may only tighten the gate. computeArpTriggers already sizes
      // holdSec at 85% of the interval between triggers; scaling past 1 would
      // hold a note past the next one, and the bass is monophonic — the next
      // note then steals the voice while it is still above its sustain level
      // and cuts it off in the voice-steal's short fade, on every step.
      hold: t.holdSec * Math.min(1, holdScale),
    }),
  );
}

/**
 * Start and clipped note-off of one step event. The clamp to chordEnd stops a
 * long feel hold from overlapping the next chord; the 10 ms floor keeps a
 * strum's late note-off from preceding its own note-on at high bpm. One rule
 * for live (emitStepEvents) and offline (the song timeline). The expressions
 * are kept token for token — reordering them changes a double and the WAV.
 */
export function stepNoteWindow(
  time: number,
  ev: StepEvent,
  chordEnd: number,
): { startSec: number; endSec: number } {
  const startSec = time + ev.timeOffset;
  const endSec = Math.max(startSec + 0.01, Math.min(startSec + ev.hold, chordEnd));
  return { startSec, endSec };
}

/** The per-note velocity of a full-hold strike of `noteCount` notes (chord and pad holds). */
export function fullHoldVelocity(noteCount: number): number {
  return DEFAULT_VELOCITY * equalPowerVelocityScale(noteCount);
}

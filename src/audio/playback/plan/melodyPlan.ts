import type { ArpSettings } from '@/types/synth';
import {
  leadScheduleHits,
  leadSoundingNotes,
  resolveLeadStepTriggers,
  type LeadNote,
} from '@/audio/leadMelody';
import { arpStepFor } from '@/utils/meter';
import {
  TICKS_PER_SIXTEENTH,
  columnsPerBar,
  strideFor,
  type LeadStepResolutionId,
} from '@/utils/stepResolution';

/**
 * One melody track's material, as the planner reads it.
 *
 * `steps` is the RAW stored matrix at LEAD_TICKS_PER_BAR — never strided at
 * snapshot time. Striding it here would bake one resolution into the snapshot
 * and silently drop every note the current grid cannot draw, which is the exact
 * opposite of the non-destructive scheme: a dormant slot is quiet, not gone.
 *
 * Melody is the one lane with no arm-time half at all — the controller rebuilds
 * this every dispatch out of live state, which is what lets a note drawn mid-bar
 * sound on the next step. The patch and the bus stay out of it: they are the
 * controller's — `songTrackVoice` (`plan/songSnapshot.ts`) is the offline table
 * that pairs a track with its patch field and bus.
 *
 * `MELODY_TRACKS` is what makes one planner serve both Lead and FX: no field
 * here names a track, so nothing in this file can hardcode `'lead'`.
 */
export interface MelodyPlanSnapshot {
  steps: readonly LeadNote[][];
  /** The MELODY loop's own length in bars, not the chord loop's. */
  loopLength: number;
  stepResolution: LeadStepResolutionId;
  gate: number;
  /** Beside the patch, never inside it — Arp is performance state. */
  arp: ArpSettings;
}

/** One resolved note-on/note-off pair, relative to the dispatch's own time. */
interface PlannedMelodyNote {
  note: string;
  /** Seconds AFTER the dispatch's time: the on-grid tick offset plus the arp's own. */
  startOffsetSec: number;
  holdSec: number;
}

/**
 * Everything one clock dispatch of a melody track sounds.
 *
 * The three decisions stay exactly where they were and keep their own names —
 * `leadScheduleHits` decides which columns fire and when, `leadSoundingNotes`
 * decides what is held there, `resolveLeadStepTriggers` decides what sounds and
 * for how long. What this function adds is the ONE composition of them, so the
 * live hook and the offline renderer stop transcribing the same loop twice.
 *
 * `context.stepInLoop` is the LOOP-relative clock step (the live clock resets
 * to 0 at a loop boundary; the renderer passes its pass-relative step), and
 * `context.tickDurSec` is one tick at the current bpm. Neither is read from a
 * clock here: every time is an argument, which is what makes live and offline
 * the same computation.
 *
 * The second parameter is an object, not bare positional scalars, by the
 * binding convention every `plan<Lane>` function follows (see
 * `chordPlan.ts`'s `planChordLane`/`planBassLane`/`planChordArm` docblocks): a
 * later per-call addition is then a shape change to `context`, not a
 * signature change every call site must follow in argument order.
 */
export function planMelodyStep(
  snapshot: MelodyPlanSnapshot,
  context: { stepInLoop: number; stepsPerBar: number; tickDurSec: number },
): PlannedMelodyNote[] {
  const { stepInLoop, stepsPerBar, tickDurSec } = context;
  const stride = strideFor(snapshot.stepResolution);
  const columns = snapshot.loopLength * columnsPerBar(stepsPerBar, stride);
  const melodyTicks = snapshot.loopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
  // Bar-phased, the identity in 4/4: this stops the arp sliding against the bar
  // line in an odd meter.
  const arpStep = arpStepFor(stepInLoop, stepsPerBar);

  const planned: PlannedMelodyNote[] = [];
  for (const hit of leadScheduleHits(stepInLoop, stride, columns, snapshot.arp.active, tickDurSec)) {
    const sounding = leadSoundingNotes(snapshot.steps, hit.column, stepsPerBar, stride);
    const triggers = resolveLeadStepTriggers(
      sounding,
      snapshot.arp,
      arpStep,
      tickDurSec,
      snapshot.gate,
      stride,
      // The ACTIVE window in TICKS, so a note left overhanging by a METER
      // change is capped at read time instead of ringing over the loop seam.
      { tickInLoop: hit.column * stride, melodyTicks },
    );
    for (const trigger of triggers) {
      planned.push({
        note: trigger.note,
        startOffsetSec: hit.offsetSec + trigger.timeOffsetSec,
        holdSec: trigger.holdSec,
      });
    }
  }
  return planned;
}

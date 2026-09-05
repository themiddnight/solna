import { useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/store';
import { leadSoundingNotes, resolveLeadStepTriggers } from '../../../audio/leadMelody';
import {
  HARD_STOP_RELEASE,
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopSource,
  subscribePlaybackClock,
} from '../../../audio/playback/playbackEngine';
import { DEFAULT_VELOCITY } from '../../../audio/constants';
import { stepDurationSec } from '../../../utils/musicTheory';
import { arpStepFor, getMeter } from '../../../utils/meter';
import { TICKS_PER_SIXTEENTH, columnsPerBar, strideFor } from '@/utils/stepResolution';
import { armOnBarLine, isSoftStopBoundary, shouldHardStopNow } from '../../playerStop';
import { publishStepAt, resetStep } from '../../playbackStep';
import { clockStepToGridColumn, wrapColumn } from '@/audio/leadLiveRecord';
import type { PlayerState } from '../../../store/types';

export interface LeadArming {
  armed: boolean;
}

export type LeadStepAction = 'idle' | 'soft-stop' | 'play';

/**
 * The lead scheduler's step decision — identical in shape to the sequencer's:
 * arm on the first bar line, soft-stop on the next bar line, else play while
 * armed. `stepsPerBar` is the ACTIVE bar length.
 */
export function leadStepAction(
  state: PlayerState,
  step: number,
  arming: LeadArming,
  stepsPerBar: number,
): LeadStepAction {
  if (state === 'stopped') return 'idle';
  if (isSoftStopBoundary(state, step, stepsPerBar)) return 'soft-stop';
  if (!armOnBarLine(arming, step, stepsPerBar)) return 'idle';
  return 'play';
}

/**
 * The on-grid ticks one clock dispatch owns: the half-open range
 * [step * TICKS_PER_SIXTEENTH, step * TICKS_PER_SIXTEENTH + TICKS_PER_SIXTEENTH).
 *
 * One formula for every stride, not a case per resolution. An even stride
 * can never land on an odd tick, so 1/8 and 1/16 only ever see the tick the
 * clock itself is on, and only 1/32 produces two columns from one dispatch.
 */
export function leadDispatchTicks(clockStep: number, stride: number): number[] {
  const base = clockStep * TICKS_PER_SIXTEENTH;
  const step = stride > 0 ? stride : TICKS_PER_SIXTEENTH;
  const ticks: number[] = [];
  for (let t = base; t < base + TICKS_PER_SIXTEENTH; t++) {
    if (t % step === 0) ticks.push(t);
  }
  return ticks;
}

export interface LeadScheduleHit {
  /** The melody column to read the sounding notes at. */
  column: number;
  /** When to fire it, as an offset from the dispatch's own time. */
  offsetSec: number;
}

/**
 * Which column to read and when to fire it — the ONE place the melody grid's
 * question and the arpeggiator's question part company.
 *
 * arp OFF is COLUMN-driven: every on-grid tick this dispatch owns fires its
 * own age-0 notes at its own offset. Resolution decides which pitches are
 * held and when they start, which is precisely what resolution is for.
 *
 * arp ON is CLOCK-driven: one hit per dispatch, at the dispatch's own time,
 * on the column that is SOUNDING at the on-clock tick — the last column at
 * or before step * TICKS_PER_SIXTEENTH, which is exactly what
 * clockStepToGridColumn returns. The arp's rate lives in synthParams and its
 * stepMod is counted in clock 16ths; computeArpTriggers builds its own
 * holdSec and already subdivides the 16th for its 32nd rate, so it has never
 * needed the grid to be fine and must not be re-timed by it.
 *
 * Do NOT gate the arp on "does a column START inside this dispatch". It
 * looks right at 1/32 and 1/16, and at stride 4 an on-grid tick lands on
 * only every other clock step, so the arp would re-feed half as often merely
 * because the grid got coarser.
 */
export function leadScheduleHits(
  clockStep: number,
  stride: number,
  columns: number,
  arpActive: boolean,
  tickDurSec: number,
): LeadScheduleHit[] {
  if (arpActive) {
    return [{ column: clockStepToGridColumn(clockStep, columns, stride), offsetSec: 0 }];
  }
  const base = clockStep * TICKS_PER_SIXTEENTH;
  return leadDispatchTicks(clockStep, stride).map((t) => ({
    column: wrapColumn(Math.floor(t / stride), columns),
    offsetSec: (t - base) * tickDurSec,
  }));
}

/**
 * Drives the melody grid's notes into the synth voice on the shared clock.
 * The arp is a synth feature, not a note mode: `synthParams.arpActive` gates
 * arpeggiation (on = arp, off = block), never whether the melody runs. Notes
 * and params are read LIVE from the store inside the clock callback, so a
 * knob tweak reaches the next hit without re-subscribing.
 */
export function useLeadPlayback(): { isPlaying: boolean } {
  const playerState = useAppStore((s) => s.leadPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

  const armingRef = useRef<LeadArming>({ armed: false });
  const softStopPendingRef = useRef(false);

  // Rewind on every transition to 'stopped' (React may never render it: the
  // Instant Vibe swap hard-stops and restarts inside one batched click).
  useEffect(
    () =>
      useAppStore.subscribe(
        (s) => s.leadPlayer,
        (next, prev) => {
          if (next === 'stopped') {
            armingRef.current.armed = false;
            resetStep('lead');
          }
          if (!shouldHardStopNow(prev, next, softStopPendingRef.current)) {
            if (next !== 'stopping') softStopPendingRef.current = false;
            return;
          }
          playbackStopSource('synth', HARD_STOP_RELEASE);
        },
      ),
    [],
  );

  useEffect(() => {
    if (!isPlaying) {
      armingRef.current.armed = false;
      resetStep('lead');
      return;
    }

    initPlaybackEngine();

    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const playerState = s.leadPlayer;
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const stride = strideFor(s.leadStepResolution);
      const columns = s.leadLoopLength * columnsPerBar(stepsPerBar, stride);
      const melodyTicks = s.leadLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
      const action = leadStepAction(playerState, step, armingRef.current, stepsPerBar);
      const tickDur = stepDurationSec(s.bpm) / TICKS_PER_SIXTEENTH;
      // The marker is the GRID's playhead, so it always follows columns —
      // `false` here is "column-driven", not a claim about the arp.
      const marks = leadScheduleHits(step, stride, columns, false, tickDur);

      // Publish on EVERY dispatch while the transport runs, not only steps
      // that actually sound — this column is the marker AND the recorder's
      // write head (DEV-377), so a marker that stalls during pre-arm or
      // stop points at the wrong column while capture is already quantising
      // to the true clock step.
      //
      // One publish per fired column, each with its OWN audible time.
      // DEV-376's deferred publish already takes an audible time per call,
      // which is exactly what makes two publishes in one dispatch land at
      // two different moments rather than both jumping at once.
      for (const mark of marks) {
        publishStepAt('lead', mark.column, time + mark.offsetSec);
      }

      if (action === 'soft-stop') {
        playbackStopSource('synth', s.synthParams.release, time);
        softStopPendingRef.current = true;
        hardStop('lead');
        return;
      }
      if (action !== 'play') return;

      const arpStep = arpStepFor(step, stepsPerBar);
      // One clock, two questions. The grid answers "which pitches are held
      // right now" and resolution changes that answer; the arp answers
      // "when to strike them", and that answer comes off the clock's 16ths
      // via arpRate. leadScheduleHits is where the two part company, and
      // arpStep stays bar-phased by arpStepFor either way.
      const hits = leadScheduleHits(step, stride, columns, s.synthParams.arpActive, tickDur);

      for (const hit of hits) {
        const column = hit.column;
        const at = time + hit.offsetSec;
        const sounding = leadSoundingNotes(s.leadMelodySteps, column, stepsPerBar, stride);
        const triggers = resolveLeadStepTriggers(
          sounding,
          s.synthParams.arpActive,
          arpStep,
          s.synthParams,
          tickDur,
          s.leadGate,
          stride,
          // The ACTIVE window in TICKS, so a note left overhanging by a
          // METER change is capped at read time instead of ringing over
          // the loop seam. Unread on the arp path, which never asks a note
          // how long it is — only whether it is still held.
          { tickInLoop: column * stride, melodyTicks },
        );
        for (const trigger of triggers) {
          playbackNoteOn(trigger.note, s.synthParams, DEFAULT_VELOCITY, at + trigger.timeOffsetSec, 'synth');
          playbackNoteOff(
            trigger.note,
            s.synthParams.release,
            at + trigger.timeOffsetSec + trigger.holdSec,
            'synth',
          );
        }
      }
    });
  }, [isPlaying, hardStop]);

  return { isPlaying };
}

import { useEffect } from 'react';
import { useAppStore } from '@/store/store';
import { leadClockActive } from '@/store/leadRecord';
import { initPlaybackEngine, subscribePlaybackClock } from '@/audio/playback/playbackEngine';
import { stepDurationSec } from '@/utils/musicTheory';
import { getMeter } from '@/utils/meter';
import { TICKS_PER_SIXTEENTH, columnsPerBar, strideFor } from '@/utils/stepResolution';
import { publishStepAt, resetStep } from '@/components/playbackStep';
import { leadScheduleHits, type LeadScheduleHit } from './useLeadPlayback';

/**
 * Every (column, offset) the MARKER publishes for one clock dispatch.
 *
 * The marker is the grid's playhead, so it is always column-driven — a
 * named function rather than `leadScheduleHits(…, false, …)` with a comment
 * explaining the literal, because the arp path passes `true` two files over
 * and a boolean at a call site is the easiest thing in this area to flip by
 * accident.
 *
 * At 1/8 a column spans two clock 16ths, so an odd dispatch owns no on-grid
 * tick and publishes NOTHING. That is not a stall: the marker is already on
 * the column that step belongs to, put there by the previous dispatch, and
 * republishing it would be an identity-checked no-op anyway.
 */
export function leadMarkerPublishes(
  clockStep: number,
  stride: number,
  columns: number,
  tickDurSec: number,
): LeadScheduleHit[] {
  return leadScheduleHits(clockStep, stride, columns, false, tickDurSec);
}

/**
 * The lead's step producer, and the only one.
 *
 * Split out of useLeadPlayback because the two answer different questions
 * and are gated differently. The scheduler runs while the LEAD plays; the
 * marker must run whenever the shared clock does, because the column it
 * shows is also where live capture writes (leadClockActive is the
 * recorder's own gate, in store/leadRecord.ts) — and with the lead stopped
 * but the metronome or another section running, capture was in time while
 * the marker sat frozen on leadCursor, pointing at a column nothing was
 * being written to.
 *
 * Widening the CONSUMER alone does not work and was tried: useLeadMarker's
 * predicate without a producer behind it froze the marker at a stale zero,
 * a position the user never chose, which is worse than the cursor. Producer
 * and consumer move together — see useLeadMarker.ts.
 *
 * Gated, not permanent: subscribeClock starts the shared clock's 25 ms
 * timer, so a subscriber that never left would keep the clock alive for the
 * life of the app. leadClockActive is false exactly when nothing is
 * running, so this hook only ever joins a clock that is already ticking and
 * never starts one — which is also acceptance criterion 3, that no step is
 * published for the lead while nothing at all plays.
 *
 * Mounted beside useLeadPlayback in LeadMelodyGrid, which renders exactly
 * once. The cost is one more clock listener, not one more timer.
 */
export function useLeadStepPublisher(): void {
  const clockActive = useAppStore(leadClockActive);

  useEffect(() => {
    if (!clockActive) {
      // The marker owns this reset now. It fires when the CLOCK goes quiet,
      // not when the lead player stops: with the drums still running, a
      // rewind to 0 would park the marker somewhere the music is not.
      resetStep('lead');
      return;
    }

    initPlaybackEngine();

    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const stride = strideFor(s.leadStepResolution);
      const columns = s.leadLoopLength * columnsPerBar(stepsPerBar, stride);
      const tickDur = stepDurationSec(s.bpm) / TICKS_PER_SIXTEENTH;
      // One publish per on-grid tick, each with its OWN audible time, so at
      // 1/32 the two columns of a dispatch land half a 16th apart instead of
      // both jumping at once. Nothing here may sit behind a guard: this
      // callback exists only to publish, which is what makes the marker
      // honest during pre-arm and 'stopping' as well as while notes sound.
      for (const hit of leadMarkerPublishes(step, stride, columns, tickDur)) {
        publishStepAt('lead', hit.column, time + hit.offsetSec);
      }
    });
  }, [clockActive]);
}

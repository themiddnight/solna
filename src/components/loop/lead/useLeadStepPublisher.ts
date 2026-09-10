import { useEffect } from 'react';
import { useAppStore } from '@/store/store';
import { leadMarkerFollowsClock } from '@/store/leadRecord';
import { initPlaybackEngine, subscribePlaybackClock } from '@/audio/playback/playbackEngine';
import { stepDurationSec } from '@/utils/musicTheory';
import { getMeter } from '@/utils/meter';
import { TICKS_PER_SIXTEENTH, columnsPerBar, strideFor } from '@/utils/stepResolution';
import { publishStepAt, resetStep } from '@/components/playbackStep';
import { melodyTrack, type MelodyTrackId } from '@/store/melodyTracks';
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
 * Each track's step producer, and the only one for that track's slot.
 *
 * Split out of useLeadPlayback because the two answer different questions
 * and are gated differently. The scheduler runs while the TRACK's player
 * plays; the lead marker also has to run while capture is armed against
 * somebody else's clock, because the column it shows is where that capture
 * writes — with the lead stopped and the metronome or the drums running,
 * capture was in time while the marker sat frozen on leadCursor, pointing at
 * a column nothing was being written to. leadMarkerFollowsClock draws that
 * line, and store/leadRecord.ts says why it is not simply the recorder's own
 * gate. FX has no recorder, so its marker follows its own player state and
 * nothing else.
 *
 * Widening the CONSUMER alone does not work and was tried: useLeadMarker's
 * predicate without a producer behind it froze the marker at a stale zero,
 * a position the user never chose, which is worse than the cursor. Producer
 * and consumer move together — see useLeadMarker.ts.
 *
 * Gated, not permanent: subscribeClock starts the shared clock's 25 ms
 * timer, so a subscriber that never left would keep the clock alive for the
 * life of the app. The predicate is false whenever nothing is running, so
 * this hook only ever joins a clock that is already ticking and never
 * starts one — which is also acceptance criterion 3, that no step is
 * published while nothing at all plays.
 *
 * Mounted beside useLeadPlayback in LeadMelodyGrid, which renders once per
 * melody track. The cost of a second grid is one more clock listener, not one
 * more timer.
 */
export function useLeadStepPublisher(trackId: MelodyTrackId): void {
  const track = melodyTrack(trackId);
  // Lead follows the WIDER gate — its marker must also track somebody else's
  // clock while Rec is armed, because that column is where live capture writes
  // (store/leadRecord.ts says why that is not simply the recorder's own gate).
  // FX has no recorder, so its marker follows its own player and nothing else.
  const followsClock = useAppStore((s) =>
    trackId === 'lead' ? leadMarkerFollowsClock(s) : s.fxPlayer !== 'stopped',
  );

  useEffect(() => {
    if (!followsClock) {
      resetStep(track.stepPlayer);
      return;
    }

    initPlaybackEngine();

    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const stride = strideFor(s[track.stepResolution]);
      const columns = s[track.loopLength] * columnsPerBar(stepsPerBar, stride);
      const tickDur = stepDurationSec(s.bpm) / TICKS_PER_SIXTEENTH;
      for (const hit of leadMarkerPublishes(step, stride, columns, tickDur)) {
        publishStepAt(track.stepPlayer, hit.column, time + hit.offsetSec);
      }
    });
  }, [followsClock, track]);
}

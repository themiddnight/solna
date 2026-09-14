import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/store';
import { leadScheduleHits, leadSoundingNotes, resolveLeadStepTriggers } from '@/audio/leadMelody';
import {
  HARD_STOP_RELEASE,
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopOwnedVoices,
  subscribePlaybackClock,
} from '@/audio/playback/playbackEngine';
import { DEFAULT_VELOCITY } from '@/audio/constants';
import { stepDurationSec } from '@/utils/musicTheory';
import { arpStepFor, getMeter } from '@/utils/meter';
import { TICKS_PER_SIXTEENTH, columnsPerBar, strideFor } from '@/utils/stepResolution';
import { synthReleaseSeconds } from '@/utils/synthPatch';
import { armOnBarLine, isSoftStopBoundary, shouldHardStopNow } from '@/components/playerStop';
import { melodyTrack, type MelodyTrackId } from '@/store/melodyTracks';
import type { PlayerState } from '@/store/types';

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
 * Drives a melody track's notes into its synth voice on the shared clock.
 * The arp is a performance setting, not a note mode: `ArpSettings.active` gates
 * arpeggiation (on = arp, off = block), never whether the melody runs. Notes
 * and params are read LIVE from the store inside the clock callback, so a
 * knob tweak reaches the next hit without re-subscribing.
 *
 * NOTES ONLY. The marker's column is published by useLeadStepPublisher, on
 * the wider leadMarkerFollowsClock gate for this track's own id, because that
 * column is also where live capture writes and capture can be armed against
 * any section's clock (DEV-378). Do not publish a step
 * from here: two producers on one player id would fight whenever the track
 * plays. Rewinding the marker is that hook's job too, for the same reason —
 * the track stopping is not necessarily the marker stopping.
 */
export function useLeadPlayback(trackId: MelodyTrackId): { isPlaying: boolean } {
  const track = melodyTrack(trackId);
  const playerState = useAppStore((s) => s[track.player]);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

  const armingRef = useRef<LeadArming>({ armed: false });
  const softStopPendingRef = useRef(false);

  // Rewind on every transition to 'stopped' (React may never render it: the
  // Instant Vibe swap hard-stops and restarts inside one batched click).
  useEffect(
    () =>
      useAppStore.subscribe(
        (s) => s[track.player],
        (next, prev) => {
          if (next === 'stopped') armingRef.current.armed = false;
          if (!shouldHardStopNow(prev, next, softStopPendingRef.current)) {
            if (next !== 'stopping') softStopPendingRef.current = false;
            return;
          }
          playbackStopOwnedVoices(track.engineSource, HARD_STOP_RELEASE);
        },
      ),
    [track],
  );

  useEffect(() => {
    if (!isPlaying) {
      armingRef.current.armed = false;
      return;
    }

    initPlaybackEngine();

    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const playerState = s[track.player];
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const stride = strideFor(s[track.stepResolution]);
      const columns = s[track.loopLength] * columnsPerBar(stepsPerBar, stride);
      const melodyTicks = s[track.loopLength] * stepsPerBar * TICKS_PER_SIXTEENTH;
      const action = leadStepAction(playerState, step, armingRef.current, stepsPerBar);
      const tickDur = stepDurationSec(s.bpm) / TICKS_PER_SIXTEENTH;
      const params = s[track.synthParams];
      const arp = s[track.arpSettings];
      const releaseSeconds = synthReleaseSeconds(params);

      if (action === 'soft-stop') {
        playbackStopOwnedVoices(track.engineSource, releaseSeconds, time);
        softStopPendingRef.current = true;
        hardStop(track.module);
        return;
      }
      if (action !== 'play') return;

      const arpStep = arpStepFor(step, stepsPerBar);
      // One clock, two questions. The grid answers "which pitches are held
      // right now" and resolution changes that answer; the arp answers
      // "when to strike them", and that answer comes off the clock's 16ths
      // via arpRate. leadScheduleHits is where the two part company, and
      // arpStep stays bar-phased by arpStepFor either way.
      const hits = leadScheduleHits(step, stride, columns, arp.active, tickDur);

      for (const hit of hits) {
        const column = hit.column;
        const at = time + hit.offsetSec;
        const sounding = leadSoundingNotes(s[track.steps], column, stepsPerBar, stride);
        const triggers = resolveLeadStepTriggers(
          sounding,
          arp,
          arpStep,
          tickDur,
          s[track.gate],
          stride,
          // The ACTIVE window in TICKS, so a note left overhanging by a
          // METER change is capped at read time instead of ringing over
          // the loop seam. Unread on the arp path, which never asks a note
          // how long it is — only whether it is still held.
          { tickInLoop: column * stride, melodyTicks },
        );
        for (const trigger of triggers) {
          const start = at + trigger.timeOffsetSec;
          // The ID this hit started, released at the end of its own hold: a
          // melody grid shares its bus with the live keyboard and the arp, so
          // a release by note name would cut whichever of the three the
          // engine found first.
          const voiceId = playbackNoteOn(trigger.note, params, DEFAULT_VELOCITY, start, track.engineSource);
          playbackNoteOff(voiceId, releaseSeconds, start + trigger.holdSec);
        }
      }
    });
  }, [isPlaying, hardStop, track]);

  return { isPlaying };
}

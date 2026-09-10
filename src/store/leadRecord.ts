import { subscribeNoteInput } from '../audio/playback/noteInputBus';
import { clampLeadCursor, leadStoredIndexAt } from '../audio/leadMelody';
import { clockStepToGridColumn, heldStepLength } from '../audio/leadLiveRecord';
import { leadLiveInputStep, startLeadLiveClock } from '../audio/playback/leadLiveClock';
import { getMeter } from '../utils/meter';
import { columnsPerBar, strideFor } from '../utils/stepResolution';
import { isPlayerActive } from './transportSlice';
import { useAppStore } from './store';
import type { PlayerState } from './types';
import { MELODY_TRACKS, melodyTrack, type MelodyTrack, type MelodyTrackId } from './melodyTracks';

/**
 * Is there music to play along to?
 *
 * The DEV-370 guard was `leadPlayer !== 'stopped'`, which meant that playing
 * only the drums and then pressing a key wrote to a static cursor while the
 * beat ran. The rule should fit in one sentence: if music is playing, record
 * in time; if not, record at the cursor.
 *
 * The metronome was once counted here, on the reasoning that it runs the same
 * clock and is what a player counts against when nothing else is going. It no
 * longer runs a clock at all — it is a click on music that is already playing
 * (see setMetronomeEnabled in audio/engine.ts) — so counting it would put this
 * predicate in disagreement with whether a clock exists to quantise against.
 * To record in time to a click alone, press play on a melody track: an empty
 * melody makes no sound, and the click, the marker and capture all follow from
 * the one transport that is running.
 *
 * FX counts for the same reason the drums do, and this predicate takes NO
 * track id: the question is whether music is playing, not whose track it is,
 * so a per-track answer would tell a lead recorder there is nothing to play
 * along to while an FX riser is plainly sounding. An id it did not read would
 * also be an unused parameter, which `bun run eslint` reports.
 */
export function leadClockActive(state: {
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  leadPlayer: PlayerState;
  fxPlayer: PlayerState;
}): boolean {
  return (
    isPlayerActive(state.sequencerPlayer) ||
    isPlayerActive(state.chordsPlayer) ||
    isPlayerActive(state.leadPlayer) ||
    isPlayerActive(state.fxPlayer)
  );
}

/**
 * Does THIS track's marker follow the clock right now?
 *
 * Wider than the track's own player, narrower than leadClockActive, and
 * neither by accident. DEV-377 merged the playhead and the write cursor into
 * one mark, so it should track the clock when either of those meanings is
 * live: this track is sounding, or capture is armed ON THIS TRACK against a
 * clock that is running.
 *
 * The third case — a clock running with nothing armed and this track silent —
 * is what separates this from leadClockActive. The record action returns false
 * unless `recordingTrack` names this track, so nothing is written there at
 * all, and a mark sweeping the grid would be animating a write head that does
 * not exist. Turning the metronome on is not a transport start, and it should
 * not look like one.
 *
 * The `trackId` is what keeps two mounted grids honest: with one arm value and
 * a per-track question, the FX marker cannot start sweeping because LEAD is
 * armed. The track's own player field is read through MELODY_TRACKS rather
 * than by literal name, so a row rename moves this with it.
 *
 * The recorder keeps leadClockActive: its question is "is there music to
 * play along to", which is about time, not about whether the user armed
 * anything. Two questions, two predicates, sharing the one that answers the
 * first.
 */
export function leadMarkerFollowsClock(
  state: {
    sequencerPlayer: PlayerState;
    chordsPlayer: PlayerState;
    leadPlayer: PlayerState;
    fxPlayer: PlayerState;
    recordingTrack: MelodyTrackId | null;
  },
  trackId: MelodyTrackId,
): boolean {
  return (
    isPlayerActive(state[melodyTrack(trackId).player]) ||
    (state.recordingTrack === trackId && leadClockActive(state))
  );
}

/** The real live clock. Injectable so the bridge is testable without one. */
export interface LeadRecordDeps {
  inputStep: () => number | null;
  startClock: () => () => void;
}

const REAL_CLOCK: LeadRecordDeps = {
  inputStep: leadLiveInputStep,
  startClock: startLeadLiveClock,
};

interface HeldNote {
  /** The RAW clock step of the press — never wrapped, so a note held across
   *  the loop seam still yields a positive length. */
  onStep: number;
  /** Where the note went in, so note-off knows what to extend. */
  storedIndex: number;
  /** The stride the note was captured at, so a resolution change mid-hold cannot re-scale its length. */
  stride: number;
}

/**
 * The two ACTION names this bridge calls. MELODY_TRACKS carries state field
 * names only (see its docblock), so — exactly like leadSlice's `ACTIONS` and
 * LeadMelodyGrid's `GRID_ACTIONS` — the setter names are a small typo-checked
 * literal table here rather than a `record${Id}Note` template the compiler
 * cannot check against the store.
 */
const RECORD_ACTIONS: Record<
  MelodyTrackId,
  {
    record: 'recordLeadNote' | 'recordFxNote';
    setNoteLength: 'setLeadNoteLength' | 'setFxNoteLength';
  }
> = {
  lead: { record: 'recordLeadNote', setNoteLength: 'setLeadNoteLength' },
  fx: { record: 'recordFxNote', setNoteLength: 'setFxNoteLength' },
};

/**
 * The ONE anchor collector, for both melody tracks.
 *
 * Hoisted out of the per-track bridge on purpose. `startLeadLiveClock` is a
 * module singleton: a second start while one is live is a no-op that returns a
 * disposer which does nothing (audio/playback/leadLiveClock.ts), so two
 * bridges each holding "their" collector means the first to stop unsubscribes
 * and resets the anchors the other is still quantising against — silently, and
 * only when the two predicates disagree.
 *
 * Started and stopped with the music, never at boot: subscribing the shared
 * clock starts its 25 ms timer, so a permanent subscriber would keep it alive
 * for the life of the app. One holder, gated on the transport.
 *
 * It is NOT gated on the arm as well. Arming mid-playback would then start the
 * collector from cold, and inputStep() answers null until two anchors have
 * arrived — so the first notes after arming would land silently on the cursor
 * while the music played. The collector follows the transport; only writing
 * follows the arm.
 */
export function startLiveClockCollector(deps: LeadRecordDeps = REAL_CLOCK): () => void {
  let stopClock: (() => void) | null = null;

  const syncClock = (active: boolean): void => {
    if (active === (stopClock !== null)) return;
    if (active) {
      stopClock = deps.startClock();
      return;
    }
    stopClock?.();
    stopClock = null;
  };

  const unsubscribe = useAppStore.subscribe(leadClockActive, syncClock, { fireImmediately: true });

  return () => {
    unsubscribe();
    syncClock(false);
  };
}

/**
 * The bridge from performed notes to ONE melody track's grid.
 *
 * ONE subscriber per track, not a call bolted onto each input source. The bus
 * already settled which events count as somebody playing (see noteInputBus),
 * so this module only has to answer what to do with them — and answering it
 * once is why the computer keyboard, the on-screen keyboard and MIDI all
 * behave the same without three copies of this rule.
 *
 * Instantiated per MELODY_TRACKS row, the leadSlice precedent: every store
 * field is read through `track` and every action through RECORD_ACTIONS, so
 * Lead and FX are one implementation with two rows. Both bridges see every
 * note; the record action's `recordingTrack === track.id` guard is what makes
 * exactly one of them write.
 *
 * The cursor never moves, in either mode. Stopped, it IS the write head, so
 * notes played together land together and a key repeat writes nothing new.
 * Playing, the clock is the write head and the cursor is simply left where
 * the user put it — which is what makes "stop returns the marker to where
 * you put it" free, with no save-and-restore step to get wrong.
 */
export function startMelodyRecordBridge(
  track: MelodyTrack,
  deps: LeadRecordDeps = REAL_CLOCK,
): () => void {
  const held = new Map<string, HeldNote>();
  const actions = RECORD_ACTIONS[track.id];

  // A note still down when the transport stops has no length to compute
  // against, and its release must not extend anything later. Per bridge,
  // because the held map is per bridge — the CLOCK is not started here.
  const unsubscribeTransport = useAppStore.subscribe(leadClockActive, (active) => {
    if (!active) held.clear();
  });

  const unsubscribeInput = subscribeNoteInput((event) => {
    if (event.kind === 'off') {
      const entry = held.get(event.note);
      if (!entry) return;
      held.delete(event.note);
      const offStep = deps.inputStep();
      if (offStep === null) return;
      const len = heldStepLength(entry.onStep, offStep, entry.stride);
      // The track's setNoteLength owns all three length invariants, including
      // the clamp against the loop end — so a note held across the seam is
      // truncated rather than wrapped, with no special case here.
      //
      // The ARM is re-read here, not assumed from note-on: a press that
      // started while armed can still be held after Rec is switched off, or
      // after the arm has moved to the other melody track, and its release
      // must not reach back and lengthen a note that was never meant to grow
      // past its initial write.
      //
      // > stride, not > 1: a one-cell note is already at that length, and
      // calling the setter for it would be a write with nothing to write.
      if (len > entry.stride && useAppStore.getState().recordingTrack === track.id) {
        useAppStore.getState()[actions.setNoteLength](entry.storedIndex, event.note, len);
      }
      return;
    }

    const state = useAppStore.getState();
    const clockStep = deps.inputStep();
    if (clockStep === null) {
      // No running clock: the cursor is the write head, and there is no step
      // count to give the note a length with, so it stays one step long.
      state[actions.record](event.note);
      return;
    }
    // A key repeat must not re-date a press that is still down.
    if (held.has(event.note)) return;

    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    const stride = strideFor(state[track.stepResolution]);
    const columns = state[track.loopLength] * columnsPerBar(stepsPerBar, stride);
    const rawColumn = clockStepToGridColumn(clockStep, columns, stride);
    // Clamped HERE, once, and the same value reused below: the record action
    // clamps again internally (defence in depth for its other caller, the
    // stopped-cursor path), but that must not be the only place it happens —
    // two independent clamps of the same raw column agree today only because
    // the wrap already puts rawColumn in range, which is luck, not a
    // guarantee.
    const column = clampLeadCursor(rawColumn, state[track.loopLength], stepsPerBar, stride);
    // The note goes in at one cell immediately, so it appears on the grid the
    // moment it is played; note-off extends it.
    if (!state[actions.record](event.note, column)) return;
    held.set(event.note, {
      onStep: clockStep,
      storedIndex: leadStoredIndexAt(column, stepsPerBar, stride),
      stride,
    });
  });

  return () => {
    unsubscribeInput();
    unsubscribeTransport();
    held.clear();
  };
}

/**
 * Everything the recorder needs, started once from useEngineSync: the single
 * anchor collector plus one bridge per melody track. Returns one teardown.
 */
export function startMelodyRecordBridges(deps: LeadRecordDeps = REAL_CLOCK): () => void {
  const stops = [
    startLiveClockCollector(deps),
    ...MELODY_TRACKS.map((track) => startMelodyRecordBridge(track, deps)),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

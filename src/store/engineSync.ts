import { useEffect } from 'react';
import { startLeadRecordBridge } from './leadRecord';
import { shallow } from 'zustand/shallow';
import { audioEngine } from '../audio/engine';
import { DRUM_KITS } from '../audio/drumKits';
import { useAppStore } from './store';
import { isPlayerActive } from './transportSlice';
import { getMeter } from '../utils/meter';
import { startMidiInputBridge } from './midiInput';
import { createFrameCoalescer } from '../utils/frameCoalescer';
import { createTrailingDebounce } from '../utils/trailingDebounce';
import type { MasterEffects } from '../types';

/**
 * One-way bridge from the Zustand store into the audioEngine singleton,
 * rebuilt on Zustand's subscribeWithSelector middleware: one subscription per
 * engine-settable value with `fireImmediately` bootstrap, so the engine always
 * receives the current value the moment the bridge starts (setters no-op
 * before init — engine.ts guards on this.ctx — and applyEngineSnapshot
 * re-applies everything after the AudioContext exists).
 *
 * startEngineSync is idempotent; the returned stop() (and stopEngineSync)
 * unsubscribe every subscription. useEngineSync mounts it at the app root.
 */
type Stop = () => void;

let syncStarted = false;
let stopCurrent: Stop | null = null;

/**
 * Trailing-commit window for the reverb Decay knob. Long enough that a
 * continuous sweep rebuilds the impulse exactly once (on release), short
 * enough to read as immediate. The wet amount is a separate, continuous
 * AudioParam ramp, so the knob still sounds live while the tail length waits.
 */
export const REVERB_DECAY_COMMIT_MS = 180;

// Every MasterEffects field EXCEPT reverbDecay, which has its own debounced
// subscription below. Comparing on this list keeps a decay drag from also
// re-running updateEffects' seven setTargetAtTime calls for nothing.
const EFFECT_KEYS_EXCEPT_DECAY = [
  'reverbWet',
  'reverbBypass',
  'delayWet',
  'delayFeedback',
  'delayBypass',
  'distortionWet',
  'distortionBypass',
  'eqLow',
  'eqMid',
  'eqHigh',
  'eqBypass',
  'compressorThreshold',
] as const;

function effectsEqualExceptDecay(a: MasterEffects, b: MasterEffects): boolean {
  for (const key of EFFECT_KEYS_EXCEPT_DECAY) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function applySliceState(): void {
  const s = useAppStore.getState();
  audioEngine.setClockBpm(s.bpm);
  audioEngine.setMeter(getMeter(s.meterId));
  audioEngine.setMasterVolume(s.masterVolume);
  audioEngine.setMetronomeEnabled(s.metronomeActive);
  audioEngine.setSourceGain('synth', s.synthVolume);
  audioEngine.setSourceGain('chord', s.chordVolume);
  audioEngine.setSourceGain('bass', s.bassVolume);
  audioEngine.setSourceGain('sequencer', s.masterSequencerVolume);
  audioEngine.setSourceMuted('synth', s.synthMuted);
  audioEngine.setSourceMuted('chord', s.chordMuted);
  audioEngine.setSourceMuted('bass', s.bassMuted);
  audioEngine.setSourceMuted('sequencer', s.drumMuted);
  audioEngine.setDrumKit(DRUM_KITS[s.soundKit]);
  audioEngine.setDrumFilter(s.drumFilterCutoff, s.drumFilterResonance, s.drumFilterType);
  audioEngine.updateEffects(s.effects);
  // Applied DIRECTLY, not through the debounce: applyEngineSnapshot runs once
  // right after init(), when every earlier setter was a no-op, so the impulse
  // must exist before the first note.
  audioEngine.setReverbDecay(s.effects.reverbDecay);
  audioEngine.updateSynthParams(s.synthParams, 'synth');
  audioEngine.updateSynthParams(s.chordSynthParams, 'chord');
  audioEngine.updateSynthParams(s.bassSynthParams, 'bass');
}

export function startEngineSync(): Stop {
  if (syncStarted) return () => undefined;
  syncStarted = true;

  // MIDI input: the listener lives in a store-side module (layering rule 1
  // forbids audio/ from importing the store) and starts once with the sync.
  startMidiInputBridge();

  const subs: Array<() => void> = [];

  // The parameter bridge is capped at one engine call per key per animation
  // frame. updateSynthParams re-targets EVERY live voice with ~15-20
  // timeline-locking AudioParam operations, so an unthrottled knob drag with
  // 8 held voices is thousands of lock acquisitions a second on the same
  // thread as the 25 ms scheduler. The coalescer is leading-edge, so a
  // one-shot change (preset load, vibe apply, the fireImmediately bootstrap)
  // still reaches the engine in the same tick — only a REPEAT on the same key
  // inside one frame is deferred.
  const paramFrames = createFrameCoalescer();

  // transport slice
  subs.push(useAppStore.subscribe((s) => s.bpm, (bpm) => audioEngine.setClockBpm(bpm), { fireImmediately: true }));
  // Meter reaches the engine HERE and nowhere else: the metronome and the
  // dispatched beat index are bar-relative, and layering rule 3 forbids a
  // component calling an engine setter. Subscribed on the id (a primitive), so
  // the subscription fires only on a real change.
  subs.push(useAppStore.subscribe((s) => s.meterId, (id) => audioEngine.setMeter(getMeter(id)), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.masterVolume, (v) => audioEngine.setMasterVolume(v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.metronomeActive, (v) => audioEngine.setMetronomeEnabled(v), { fireImmediately: true }));

  // synth + chords + bass + sequencer buses
  subs.push(useAppStore.subscribe((s) => s.synthVolume, (v) => audioEngine.setSourceGain('synth', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.chordVolume, (v) => audioEngine.setSourceGain('chord', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassVolume, (v) => audioEngine.setSourceGain('bass', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.masterSequencerVolume, (v) => audioEngine.setSourceGain('sequencer', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.synthMuted, (v) => audioEngine.setSourceMuted('synth', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.chordMuted, (v) => audioEngine.setSourceMuted('chord', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.bassMuted, (v) => audioEngine.setSourceMuted('bass', v), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.drumMuted, (v) => audioEngine.setSourceMuted('sequencer', v), { fireImmediately: true }));

  // sequencer slice: kit + drum-bus filter. The filter is watched as one
  // derived object compared with `shallow`, so the subscription fires once
  // when any of the three values actually changes — and the listener gets all
  // three from the same snapshot instead of re-reading the store.
  subs.push(useAppStore.subscribe((s) => s.soundKit, (kit) => audioEngine.setDrumKit(DRUM_KITS[kit]), { fireImmediately: true }));
  subs.push(
    useAppStore.subscribe(
      (s) => ({
        cutoff: s.drumFilterCutoff,
        resonance: s.drumFilterResonance,
        type: s.drumFilterType,
      }),
      ({ cutoff, resonance, type }) => audioEngine.setDrumFilter(cutoff, resonance, type),
      { equalityFn: shallow, fireImmediately: true },
    ),
  );

  // effects + synth params: identity selectors compared with `shallow`, so the
  // subscription fires only on a real VALUE change. Keying on object identity
  // alone re-ran updateEffects / updateSynthParams for any action that merely
  // respread the object — and updateSynthParams re-targets every live voice,
  // cancelling and re-planning their ramps for nothing. Both types are flat
  // records of primitives (MasterEffects, SynthParams), so shallow equality is
  // exact — and unlike the JSON encoding it needs no assumption about key order.
  subs.push(
    useAppStore.subscribe(
      (s) => s.effects,
      (effects, prevEffects) => {
        // subscribeWithSelector's fireImmediately calls the listener with the
        // SAME reference twice (see its source), which is otherwise
        // impossible once the equality check above has already gated out a
        // no-op change. That is the one reliable signal that this call is the
        // startup bootstrap rather than a real edit, and the coalescer must
        // never see it: consuming the leading slot at boot would push the
        // very next genuine edit — however unrelated — into next frame.
        if (effects === prevEffects) audioEngine.updateEffects(effects);
        else paramFrames.push('effects', () => audioEngine.updateEffects(effects));
      },
      { equalityFn: effectsEqualExceptDecay, fireImmediately: true },
    ),
  );

  // Decay is STRUCTURAL: committing it rebuilds a multi-megabyte impulse and
  // re-partitions the ConvolverNode, and quantiseDecay's 0.1 s step equals the
  // knob's own step, so an unthrottled drag rebuilt on ~every pointer frame
  // and starved the 25 ms scheduler. Commit on gesture end instead; the wet
  // amount above stays continuous, so the knob is still audibly live.
  const decayCommit = createTrailingDebounce<number>(
    (decay) => audioEngine.setReverbDecay(decay),
    REVERB_DECAY_COMMIT_MS,
  );
  subs.push(
    useAppStore.subscribe(
      (s) => s.effects.reverbDecay,
      (decay) => decayCommit.push(decay),
      { fireImmediately: true },
    ),
  );

  const synthSources = [
    ['synthParams', 'synth'],
    ['chordSynthParams', 'chord'],
    ['bassSynthParams', 'bass'],
  ] as const;
  for (const [field, source] of synthSources) {
    subs.push(
      useAppStore.subscribe(
        (s) => s[field],
        (params, prevParams) => {
          if (params === prevParams) audioEngine.updateSynthParams(params, source);
          else paramFrames.push(source, () => audioEngine.updateSynthParams(params, source));
        },
        { equalityFn: shallow, fireImmediately: true },
      ),
    );
  }

  // Transport player states: init on EVERY transition — the old toggle actions
  // called audioEngine.init() unconditionally, and init()'s resume path is
  // load-bearing (the browser suspends the AudioContext when the tab is
  // backgrounded, so returning with chords playing and starting the sequencer
  // must resume audio). resetClock stays restricted to the fully-stopped ->
  // active transition, which keeps all three players counting the SAME bars: a
  // player joining while the others run must not restart the grid.
  //
  // "Fully stopped" means ALL three players are 'stopped'. A 'stopping' player
  // is still active — otherwise a soft stop followed by a restart would reset
  // the grid mid-flight. Encoded 1/2/4 so the subscription fires only on real
  // transitions.
  subs.push(
    useAppStore.subscribe(
      (s) =>
        (isPlayerActive(s.sequencerPlayer) ? 1 : 0) +
        (isPlayerActive(s.chordsPlayer) ? 2 : 0) +
        (isPlayerActive(s.leadPlayer) ? 4 : 0),
      (flags, prevFlags) => {
        audioEngine.init();
        if (flags !== 0 && prevFlags === 0) {
          audioEngine.resetClock();
        }
      },
    ),
  );

  stopCurrent = () => {
    for (const unsub of subs) unsub();
    subs.length = 0;
    // Drop, don't flush: stopping the bridge means the engine must stop
    // receiving store values, and a flush would fire a call after the last
    // subscription was already torn down.
    paramFrames.cancel();
    decayCommit.cancel();
    syncStarted = false;
    stopCurrent = null;
  };
  return stopCurrent;
}

export function stopEngineSync(): void {
  stopCurrent?.();
}

export function useEngineSync(): void {
  useEffect(() => startEngineSync(), []);
  // Started beside the engine bridge because it has the same shape: one
  // subscription, for the whole life of the app, owned by nothing on screen.
  useEffect(() => startLeadRecordBridge(), []);
}

/**
 * Push the full audio-relevant snapshot into the engine. Called once from the
 * app's first-user-interaction handler right after `audioEngine.init()` —
 * every engine setter is a no-op before the AudioContext exists, so the values
 * hydrated from storage or set by pre-init actions (e.g. instant vibes) are
 * re-applied once the engine is live.
 */
export function applyEngineSnapshot(): void {
  applySliceState();
}

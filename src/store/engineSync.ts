import { useEffect } from 'react';
import { startMelodyRecordBridges } from './leadRecord';
import { audioEngine } from '../audio/engine';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { applyBeatParams } from '../audio/beatAdapter';
import { useAppStore } from './store';
import { isPlayerActive } from './transportSlice';
import { getMeter } from '../utils/timeSignature';
import { startMidiInputBridge } from './midiInput';
import { createFrameCoalescer } from '../utils/frameCoalescer';
import { createTrailingDebounce } from '../utils/trailingDebounce';
import type { BeatMix, BeatParams, MasterEffects } from '../types';
import { faderDbToGain } from './levelUnits';
import { isTrackAudible } from './trackAudibility';
import { SOURCE_BUSES, SYNTH_PARAM_FIELD, SYNTH_PARAM_TARGETS, type SourceBus } from './sourceBuses';
import { sourceTransitionTime } from './sourceTransition';
import type { AppStore } from './types';
import type { ActiveSynth } from '@/types/synth';
import type { SourceBusState } from '../audio/masterRack';
import type { SourceBusApplyMode } from '../audio/automation/sourceBusAutomation';

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
const REVERB_DECAY_COMMIT_MS = 180;

/**
 * Every MasterEffects field EXCEPT reverbDecay, which has its own debounced
 * subscription below. Comparing on this list keeps a decay drag from also
 * re-running updateEffects' AudioParam writes for nothing.
 *
 * Exported so engineSync.test.ts can pin it: a field added to MasterEffects
 * and forgotten HERE is a knob the engine never hears — the equalityFn calls
 * the two objects equal and the listener simply does not run, with no error.
 */
export const EFFECT_KEYS_EXCEPT_DECAY = [
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
  'compressorEnabled',
  'compressorThreshold',
  'compressorRatio',
  'compressorAttack',
  'compressorRelease',
  'limiterEnabled',
  'limiterThreshold',
  'limiterRatio',
  'limiterAttack',
  'limiterRelease',
] as const;

type EffectKeyExceptDecay = (typeof EFFECT_KEYS_EXCEPT_DECAY)[number];

/**
 * Compile-time exhaustiveness guard: EFFECT_KEYS_EXCEPT_DECAY is a
 * hand-maintained subset of MasterEffects, and it has already gone stale
 * once — silently, since a missing key throws nothing and fails no test on
 * its own. If a field is ever added to MasterEffects (other than
 * reverbDecay) and not added to the array above, the assignment below stops
 * typechecking: the target Record requires a property the source, built only
 * from EffectKeyExceptDecay, does not have. Deliberately typed off
 * MasterEffects itself rather than derived from INITIAL_EFFECTS at runtime —
 * the optional `*Bypass` keys have no entry in INITIAL_EFFECTS and so would
 * be invisible to a runtime-derived check.
 *
 * Expressed as a type, not as a value. It used to be a `Record<…, true>` const
 * built by `Object.fromEntries(EFFECT_KEYS_EXCEPT_DECAY.map(…))` and then
 * discarded with `void` — an object materialised at module load whose only
 * purpose was to be the left-hand side of an assignability check the compiler
 * could have made without it. `Exclude` states the same thing directly: any
 * MasterEffects key (other than reverbDecay) that the array does not list
 * survives the subtraction, and `AssertNoMissingEffectKey`'s `extends never`
 * constraint then rejects it BY NAME in the error text, which the assignment
 * form never did. Nothing here survives compilation.
 */
type AssertNoMissingEffectKey<T extends never> = T;
// The alias is never referenced on purpose — instantiating it IS the check, and
// there is nothing at runtime left to reference it from.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type MissingEffectKey = AssertNoMissingEffectKey<
  Exclude<Exclude<keyof MasterEffects, 'reverbDecay'>, EffectKeyExceptDecay>
>;

function effectsEqualExceptDecay(a: MasterEffects, b: MasterEffects): boolean {
  for (const key of EFFECT_KEYS_EXCEPT_DECAY) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * The bus table lives in `store/sourceBuses.ts`, not here. This module retains
 * only the `SourceBusId` type re-export used by its callers.
 *
 * It moved because `components/mixLayers.ts` carries the same bus↔store-field
 * mapping in its own rows and nothing checked that the two agree — a row
 * pairing the wrong volume key with a bus name compiles, and shows up only as
 * a mixer fader and the meter beside it describing different buses. A module
 * with no `audio/engine` import can be read at runtime from `components/`
 * (this one cannot, per layering rule 4), which is what lets
 * `mixLayers.test.ts` assert the two tables row for row.
 */
export type {
  SourceBusId,
} from './sourceBuses';

/**
 * THE audibility read, and the only one: solo beats mute, and the formula lives
 * in store/trackAudibility.ts because src/components/ may not import
 * audio/engine and so may not compute it.
 *
 * `bus.solo` is checked against SoloTrack by isTrackAudible's own signature, so
 * a typo in the table above is a compile error rather than a bus that silently
 * never solos.
 */
function busAudible(s: AppStore, bus: SourceBus): boolean {
  return isTrackAudible(bus.solo, s.soloTracks, bus.selectMuted(s));
}

/** The complete state of one source bus, derived from one consistent store read. */
function sourceState(s: AppStore, bus: SourceBus): SourceBusState {
  return {
    gain: faderDbToGain(bus.selectLevelDb(s)),
    muted: !busAudible(s, bus),
  };
}

function sourceStateEqual(a: SourceBusState, b: SourceBusState): boolean {
  return a.gain === b.gain && a.muted === b.muted;
}

function pushSourceState(
  state: SourceBusState,
  bus: SourceBus,
  mode: SourceBusApplyMode,
  time?: number,
): void {
  audioEngine.setSourceState(bus.source, state, time, mode);
}

/**
 * Every bus's complete state AND its sends, settled at one instant — the
 * snapshot pass and a transport start from full stop both need exactly this.
 * Sends read no audibility (R160): the bus they tap is already zeroed by mute
 * and solo, so a muted or unsoloed track sends nothing.
 */
function settleSourceBuses(s: AppStore): void {
  for (const bus of SOURCE_BUSES) {
    pushSourceState(sourceState(s, bus), bus, 'settle');
    audioEngine.setSourceSends(bus.source, s.trackSends[bus.source], undefined, 'settle');
  }
}

/**
 * One subscription per bus on its own `trackSends` row. `setTrackSends`
 * replaces only the row it writes, so the default `Object.is` compare fires
 * for that bus alone. `sourceTransitionTime()` puts a song seam's new sends on
 * the boundary where that seam's fader and mute changes land.
 */
function subscribeTrackSends(): Array<() => void> {
  return SOURCE_BUSES.map((bus) =>
    useAppStore.subscribe(
      (s) => s.trackSends[bus.source],
      (sends) => audioEngine.setSourceSends(bus.source, sends, sourceTransitionTime(), 'transition'),
      { fireImmediately: true },
    ));
}

/**
 * Every Beat voice's fader, as the engine's linear per-voice gain.
 *
 * ONE of the two mute layers, and the other one is `planBeatStep`, which
 * skips a muted voice's scheduled hits so no silent voice is ever built. They
 * are the same decision expressed where each consumer can act on it: a gain of
 * 0 also covers what the step walk cannot reach — a drum PAD hit, a live MIDI
 * trigger — so a muted voice is silent from every surface, live and exported.
 * Neither cancels the other; both mean silence.
 *
 * `faderDbToGain`, never `dbToGain`: a voice pulled to the bottom of its fader
 * passes exactly nothing, the same boundary rule the source buses follow.
 *
 * Every voice is written on every push. The roster is fixed and complete
 * (eleven voices, always present in `beatMix`), so there is no stale-voice
 * reset to do — the case the old drum-track ARRAY needed, where a vanished
 * row would otherwise keep its attenuation forever.
 */
function pushBeatVoiceGains(voices: BeatMix['voices']): void {
  for (const voice of BEAT_VOICE_IDS) {
    const { levelDb, muted } = voices[voice];
    audioEngine.setDrumTrackGain(voice, muted ? 0 : faderDbToGain(levelDb));
  }
}

/**
 * The patch each bus was last given, so the next push can tell the engine what
 * actually MOVED.
 *
 * `updateSynthPatch` diffs previous against next and writes only the
 * continuous controls that changed. The subscription cannot simply hand over
 * zustand's own `previousValue`: knob moves are coalesced to one engine call
 * per animation frame, so the intermediate patches never reach the engine, and
 * diffing against one of them would leave everything that moved in the dropped
 * frames unapplied. Diffing against what was last APPLIED is exact under any
 * amount of coalescing.
 *
 * Module scope, and cleared when the bridge stops: a new bridge on a new
 * engine must start from "nothing applied yet".
 */
const appliedPatches = new Map<string, ActiveSynth>();

function pushSynthPatch(source: string, next: ActiveSynth): void {
  const previous = appliedPatches.get(source) ?? next;
  // The engine call FIRST: `createFrameCoalescer.runThunk` swallows a throw so
  // the key does not count as applied and is retried on the next frame. Marking
  // it applied before the call would make that retry a no-op — `previous` would
  // already be `next`, the diff would be empty, and every knob turn made before
  // the throw would be lost from the sounding voices with nothing to show it.
  audioEngine.updateSynthPatch(previous, next, source);
  appliedPatches.set(source, next);
}

function applySliceState(): void {
  const s = useAppStore.getState();
  audioEngine.setClockBpm(s.bpm);
  audioEngine.setMeter(getMeter(s.meterId));
  // The store speaks dB; src/audio/ speaks linear gain and its setter
  // signatures do not change. THIS is the conversion boundary, and it goes
  // through faderDbToGain rather than dbToGain so the bottom of the fader is
  // an exact 0 — a bus a user pulled all the way down passes nothing.
  audioEngine.setMasterVolume(faderDbToGain(s.masterVolume));
  audioEngine.setMetronomeEnabled(s.metronomeActive);
  settleSourceBuses(s);
  // The Beat instrument: one patch — voices, trim and bus filter — and the
  // per-voice faders beside it. Both halves go through the same calls the
  // subscriptions below use, so an engine settled by the snapshot and one
  // settled by a store write are settled identically.
  applyBeatParams(audioEngine, s.beatParams);
  pushBeatVoiceGains(s.beatMix.voices);
  audioEngine.updateEffects(s.effects);
  // Applied DIRECTLY, not through the debounce: applyEngineSnapshot runs once
  // right after init(), when every earlier setter was a no-op, so the impulse
  // must exist before the first note.
  audioEngine.setReverbDecay(s.effects.reverbDecay);
  // No trim pass here: a patch carries its own `common.outputGainDb`, so
  // there is no per-source map to seed and no window in which a bus can be
  // playing a patch the engine has not been told about.
  //
  // Off SYNTH_PARAM_FIELD, like the subscription block below: a hand-listed
  // copy here and a table there is how a new bus reaches one and not the other.
  //
  // Arp is absent from this loop and from the subscription block below on
  // purpose: it is performance state consumed by the Arp player, never a DSP
  // parameter, so an Arp toggle must not reach `updateSynthPatch` at all.
  for (const target of SYNTH_PARAM_TARGETS) {
    pushSynthPatch(target, s[SYNTH_PARAM_FIELD[target]]);
  }
}

export function startEngineSync(): Stop {
  if (syncStarted) return () => undefined;
  syncStarted = true;

  // MIDI input: the listener lives in a store-side module (layering rule 1
  // forbids audio/ from importing the store) and starts once with the sync.
  startMidiInputBridge();

  const subs: Array<() => void> = [];

  // The parameter bridge is capped at one engine call per key per animation
  // frame. updateSynthPatch re-targets EVERY live voice with a dozen or more
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
  subs.push(useAppStore.subscribe((s) => s.masterVolume, (db) => audioEngine.setMasterVolume(faderDbToGain(db)), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.metronomeActive, (v) => audioEngine.setMetronomeEnabled(v), { fireImmediately: true }));

  // synth + chords + bass + pad + FX + sequencer buses
  // Each selector derives its complete gain/mute state from one store snapshot,
  // so a combined edit cannot schedule a gain against the old mute value (or
  // vice versa). faderDbToGain rather than dbToGain: a bus pulled to the
  // bottom passes exactly nothing.
  for (const bus of SOURCE_BUSES) {
    subs.push(
      useAppStore.subscribe(
        (s) => sourceState(s, bus),
        (state) => pushSourceState(state, bus, 'transition', sourceTransitionTime()),
        { equalityFn: sourceStateEqual, fireImmediately: true },
      ),
    );
  }
  subs.push(...subscribeTrackSends());

  // The Beat instrument: the whole patch on one subscription, because
  // `beatParams` is replaced as a unit by every writer (a preset pick, a vibe,
  // a committed knob release) and installing it is two engine calls that
  // belong together. Transient drag audio does NOT come through here — it goes
  // to `store/beatPreview.ts`, which writes no store state at all.
  subs.push(
    useAppStore.subscribe(
      (s) => s.beatParams,
      (params: BeatParams) => applyBeatParams(audioEngine, params),
      { fireImmediately: true },
    ),
  );
  // The per-voice faders, watched on `beatMix.voices` alone: the bus level and
  // bus mute beside it are the source-bus loop's business (the 'sequencer' row
  // above reads them), and a bus fader drag must not re-push eleven voices.
  subs.push(
    useAppStore.subscribe(
      // The selector narrows to `voices`, so the contract is ENFORCED rather
      // than remembered: handing the whole `BeatMix` in while gating on
      // `a.voices === b.voices` passed two fields — the bus level and bus mute
      // — that this subscription will never fire for, inviting a reader to
      // fold `mix.muted` into the gain where it would then apply only on the
      // next per-voice edit and stay stale otherwise.
      (s) => s.beatMix.voices,
      (voices) => pushBeatVoiceGains(voices),
      { fireImmediately: true },
    ),
  );

  // effects: an identity selector compared with `shallow`, so the subscription
  // fires only on a real VALUE change. Keying on object identity alone re-ran
  // updateEffects for any action that merely respread the object.
  // `MasterEffects` is a flat record of primitives, so shallow equality is
  // exact — and unlike a JSON encoding it needs no assumption about key order.
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

  // One subscription per synth bus's PATCH. Reference equality, not `shallow`:
  // an `ActiveSynth` is a tree (common block, engine params, oscillator array,
  // route list), and a shallow compare of its three top-level keys would call
  // two patches equal whenever only something nested changed — which is every
  // knob on the panel. Every writer replaces the object immutably, so identity
  // is exactly "something in this patch changed".
  //
  // What the engine is told the patch WAS comes from `appliedPatches`, not
  // from zustand's previous selected value — see that map's docblock for why
  // coalescing makes the two different questions. There is no Arp
  // subscription here at all: Arp is read by the Arp player off the store.
  for (const source of SYNTH_PARAM_TARGETS) {
    const field = SYNTH_PARAM_FIELD[source];
    subs.push(
      useAppStore.subscribe(
        (s) => s[field],
        (synth, previousSelected) => {
          // subscribeWithSelector's fireImmediately calls the listener with the
          // SAME reference twice, which is the one reliable signal that this is
          // the bootstrap rather than an edit — and the coalescer must never
          // see it, or the next genuine edit is pushed into the following frame.
          if (synth === previousSelected) pushSynthPatch(source, synth);
          else paramFrames.push(source, () => pushSynthPatch(source, synth));
        },
        { fireImmediately: true },
      ),
    );
  }

  // Transport player states: init on EVERY transition — the old toggle actions
  // called audioEngine.init() unconditionally, and init()'s resume path is
  // load-bearing (the browser suspends the AudioContext when the tab is
  // backgrounded, so returning with chords playing and starting the sequencer
  // must resume audio). resetClock stays restricted to the fully-stopped ->
  // active transition, which keeps all four players counting the SAME bars: a
  // player joining while the others run must not restart the grid.
  //
  // "Fully stopped" means ALL four players are 'stopped'. A 'stopping' player
  // is still active — otherwise a soft stop followed by a restart would reset
  // the grid mid-flight. Encoded 1/2/4/8 so the subscription fires only on
  // real transitions.
  subs.push(
    useAppStore.subscribe(
      (s) =>
        (isPlayerActive(s.sequencerPlayer) ? 1 : 0) +
        (isPlayerActive(s.chordsPlayer) ? 2 : 0) +
        (isPlayerActive(s.leadPlayer) ? 4 : 0) +
        (isPlayerActive(s.fxPlayer) ? 8 : 0),
      (flags, prevFlags) => {
        audioEngine.init();
        if (flags !== 0 && prevFlags === 0) {
          settleSourceBuses(useAppStore.getState());
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
    // A later bridge may be pointed at a different engine, and every voice on
    // the old one is gone; "what this engine has already been told" cannot
    // survive that.
    appliedPatches.clear();
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
  // subscription set, for the whole life of the app, owned by nothing on
  // screen. One anchor collector and one bridge per melody track.
  useEffect(() => startMelodyRecordBridges(), []);
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

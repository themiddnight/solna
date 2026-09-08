import { useEffect } from 'react';
import { startLeadRecordBridge } from './leadRecord';
import { shallow } from 'zustand/shallow';
import { audioEngine } from '../audio/engine';
import { DRUM_KITS, DRUM_TYPES } from '@/data/drumKits';
import { useAppStore } from './store';
import { isPlayerActive } from './transportSlice';
import { getMeter } from '../utils/meter';
import { startMidiInputBridge } from './midiInput';
import { createFrameCoalescer } from '../utils/frameCoalescer';
import { createTrailingDebounce } from '../utils/trailingDebounce';
import type { MasterEffects, SequencerTrack } from '../types';
import { DEFAULT_FADER_DB, faderDbToGain } from './levelUnits';
import { isTrackAudible } from './trackAudibility';
import type { AppStore } from './types';

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
 * Every source bus the store owns, as `[volume field, mute field, engine
 * source, solo track]`. Both the snapshot pass and the subscription block
 * below are driven from this one table, on the `synthSources` precedent
 * further down — the two used to be ten hand-written lines each, and a bus
 * added to one and forgotten in the other is silent until the first apply.
 *
 * The field names are table data rather than a `${source}Volume` convention on
 * purpose: 'sequencer' is irregular (`masterSequencerVolume` / `drumMuted`),
 * and encoding that as a special case in the loop would cost more than
 * spelling all ten names out.
 *
 * `solo` is the same irregularity in the other direction: the ENGINE calls the
 * drum bus 'sequencer' and the lead bus 'synth', while the USER-facing solo
 * vocabulary (store/trackAudibility.ts) calls them 'drums' and 'lead'. The
 * translation is written once, here, because this table is already the place
 * that owns the per-bus name mapping.
 */
const SOURCE_BUSES = [
  { source: 'synth', volume: 'synthVolume', muted: 'synthMuted', solo: 'lead' },
  { source: 'chord', volume: 'chordVolume', muted: 'chordMuted', solo: 'chord' },
  { source: 'bass', volume: 'bassVolume', muted: 'bassMuted', solo: 'bass' },
  { source: 'pad', volume: 'padVolume', muted: 'padMuted', solo: 'pad' },
  { source: 'sequencer', volume: 'masterSequencerVolume', muted: 'drumMuted', solo: 'drums' },
] as const;

/**
 * THE audibility read, and the only one: solo beats mute, and the formula lives
 * in store/trackAudibility.ts because src/components/ may not import
 * audio/engine and so may not compute it.
 *
 * `bus.solo` is checked against SoloTrack by isTrackAudible's own signature, so
 * a typo in the table above is a compile error rather than a bus that silently
 * never solos.
 */
function busAudible(s: AppStore, bus: (typeof SOURCE_BUSES)[number]): boolean {
  return isTrackAudible(bus.solo, s.soloTracks, s[bus.muted]);
}

/**
 * The track gains reach the engine on a selector over `sequencerTracks`, not
 * one subscription per track: the roster is data, tracks can be added, and a
 * per-track subscription would have to be torn down and rebuilt whenever it
 * changed. The equality function compares only (instrument, volume) pairs and
 * short-circuits on reference identity, so an unrelated `set()` costs one
 * reference compare — which matters, because subscribeWithSelector runs every
 * selector on every set().
 */
function drumTrackGainsEqual(
  a: readonly SequencerTrack[],
  b: readonly SequencerTrack[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].instrument !== b[i].instrument || a[i].volume !== b[i].volume) return false;
  }
  return true;
}

function pushDrumTrackGains(tracks: readonly SequencerTrack[]): void {
  const named = new Set<string>();
  for (const track of tracks) {
    // dB in the store, linear in the engine — the same boundary rule the
    // source buses follow, through the same faderDbToGain, so a track pulled
    // to the bottom of its fader is silent rather than 60 dB down.
    audioEngine.setDrumTrackGain(track.instrument, faderDbToGain(track.volume));
    named.add(track.instrument);
  }
  // Every canonical voice the incoming roster does NOT name is reset to
  // unity. The engine's drumTrackGains map outlives any one roster, so a
  // voice whose track disappears — a loop switch, or a persisted/imported
  // roster with a row sanitizeSequencerTracks dropped — would otherwise keep
  // the vanished track's attenuation forever, and its drum pad would play
  // 30 dB down with no fader anywhere on screen explaining why.
  //
  // Skipped outright when the roster already covers the roster: this runs on
  // every (instrument, volume) change, so a fader drag walks it once per
  // detent, and a full roster can leave nothing stale by definition. The
  // guard is on `named.size`, not `tracks.length` — `named` is a Set, so it
  // counts DISTINCT instruments, where two rows on one instrument would clear
  // a length check while a voice went unnamed. It is exact rather than
  // merely conservative because `sanitizeSequencerTracks` drops any row whose
  // instrument is outside DRUM_TYPES on every read path, so a name in `named`
  // is always one of the names this loop would look for; if that ever stops
  // being true, this must count canonical coverage instead of set size.
  // Stateless by construction — no remembered previous roster — so it cannot
  // go stale the way a diff against a cached list would.
  if (named.size < DRUM_TYPES.length) {
    for (const voice of DRUM_TYPES) {
      if (!named.has(voice)) audioEngine.setDrumTrackGain(voice, faderDbToGain(DEFAULT_FADER_DB));
    }
  }
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
  for (const bus of SOURCE_BUSES) {
    audioEngine.setSourceGain(bus.source, faderDbToGain(s[bus.volume]));
    audioEngine.setSourceMuted(bus.source, !busAudible(s, bus));
  }
  audioEngine.setDrumKit(DRUM_KITS[s.soundKit], s.soundKit);
  pushDrumTrackGains(s.sequencerTracks);
  audioEngine.setDrumFilter(s.drumFilterCutoff, s.drumFilterResonance, s.drumFilterType);
  audioEngine.updateEffects(s.effects);
  // Applied DIRECTLY, not through the debounce: applyEngineSnapshot runs once
  // right after init(), when every earlier setter was a no-op, so the impulse
  // must exist before the first note.
  audioEngine.setReverbDecay(s.effects.reverbDecay);
  // No setPresetTrim pass here any more. These four calls used to be paired
  // with one, precisely because setPresetTrim did NOT no-op before init() and
  // a snapshot taken before the first click would otherwise leave a source
  // without a trim until its own subscription next fired. That ordering
  // hazard is gone rather than handled: triggerSynthNoteOn now derives the
  // trim from the `params.preset` it is handed, so there is no map to seed and
  // no window in which a source can be playing a patch the engine has not been
  // told about.
  audioEngine.updateSynthParams(s.synthParams, 'synth');
  audioEngine.updateSynthParams(s.chordSynthParams, 'chord');
  audioEngine.updateSynthParams(s.bassSynthParams, 'bass');
  audioEngine.updateSynthParams(s.padSynthParams, 'pad');
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
  subs.push(useAppStore.subscribe((s) => s.masterVolume, (db) => audioEngine.setMasterVolume(faderDbToGain(db)), { fireImmediately: true }));
  subs.push(useAppStore.subscribe((s) => s.metronomeActive, (v) => audioEngine.setMetronomeEnabled(v), { fireImmediately: true }));

  // synth + chords + bass + pad + sequencer buses
  // The volume field is dB in the store and a linear gain in the engine. The
  // conversion lives HERE, on both the snapshot and the subscription, which
  // is why no engine setter signature had to change for DEV-386. faderDbToGain
  // rather than dbToGain: a bus pulled to the bottom passes exactly nothing.
  for (const bus of SOURCE_BUSES) {
    subs.push(useAppStore.subscribe((s) => s[bus.volume], (db) => audioEngine.setSourceGain(bus.source, faderDbToGain(db)), { fireImmediately: true }));
    // Audibility, not the raw mute flag — solo beats mute. The selector returns
    // a BOOLEAN, so the default === equality fires this listener only when the
    // bus actually flips: a solo toggle re-runs five selectors and calls the
    // engine only for the buses whose state really changed.
    subs.push(useAppStore.subscribe((s) => busAudible(s, bus), (audible) => audioEngine.setSourceMuted(bus.source, !audible), { fireImmediately: true }));
  }

  // sequencer slice: kit + drum-bus filter. The filter is watched as one
  // derived object compared with `shallow`, so the subscription fires once
  // when any of the three values actually changes — and the listener gets all
  // three from the same snapshot instead of re-reading the store.
  subs.push(useAppStore.subscribe((s) => s.soundKit, (kit) => audioEngine.setDrumKit(DRUM_KITS[kit], kit), { fireImmediately: true }));
  subs.push(
    useAppStore.subscribe(
      (s) => s.sequencerTracks,
      (tracks) => pushDrumTrackGains(tracks),
      { equalityFn: drumTrackGainsEqual, fireImmediately: true },
    ),
  );
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
    ['padSynthParams', 'pad'],
  ] as const;
  for (const [field, source] of synthSources) {
    subs.push(
      useAppStore.subscribe(
        (s) => s[field],
        (params, prevParams) => {
          // The preset trim used to be pushed here, ahead of the params and
          // deliberately outside the frame coalescer, because it is a scalar the
          // NEXT voice reads and a debounced push would have let one note sound
          // at the previous patch's trim. The engine derives it from
          // `params.preset` at the moment it builds a voice now, so a trim can no
          // longer lag the params it belongs to — there is nothing left to order.
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

import { FADER_MAX_DB, SILENCE_DB, UNITY_DB, dbToGain, toDecibels } from '../utils/gainUnits';

/**
 * The store layer's dB vocabulary — the bounds, the default and the two
 * coercions that `sanitize.ts`, `store.ts` and `projectFile.ts` read. It
 * exists so those readers cannot drift: the linear ranges they replaced were
 * six hand-written literals (0..1 in three places, 0..1.5 in eight), and two
 * of them already disagreed about the drum bus.
 *
 * Every value here is DECIBELS, relative, unity at 0 — never dBFS.
 */

/**
 * Every fader starts at unity. See decision 3 in the DEV-386 plan.
 *
 * DEV-388 deleted both per-version migration chains that used to read this
 * constant as their fallback for a value that failed to coerce — there is no
 * guard left to keep in step with it. If a later issue (DEV-387, level
 * calibration) turns this into a MEASURED default instead of unity, that is
 * simply the new fallback `asFaderDb`/`sanitizeLoops` substitute for an
 * invalid stored value from then on; nothing needs to be revisited, because
 * validation runs on every hydration rather than once per stored version.
 */
export const DEFAULT_FADER_DB: number = UNITY_DB;

/**
 * DEV-383: the measured default for the five SOURCE buses — `synthVolume`,
 * `chordVolume`, `bassVolume`, `padVolume`, `masterSequencerVolume` — as
 * distinct from `DEFAULT_FADER_DB`, which still means UNITY and stays the
 * default for `masterVolume` and `SequencerTrack.volume`. The two constants
 * now mean different things: unity is "untouched", this is "how much headroom
 * a fresh project needs so its five buses don't sum past full scale before a
 * user has touched a single fader" — the compressor still defaults OFF, and
 * even with the limiter defaulting ON (DEV-383) it only catches occasional
 * peaks at -3 dB, not a sustained unheadroomed sum, so this trim is still
 * load-bearing.
 *
 * MEASURED (`scripts/calibration/busHeadroom.smoke.ts`, DEV-383): one drum
 * kit ("Club Standard", trim applied) through the calibration reference
 * backbeat, summed with three trimmed factory synth-engine voices
 * ("factory-cosmic-lead", "factory-dream-keys", "factory-808-deep-bass") each
 * playing independently — a proxy for simultaneous worst case, not a real
 * mix; the four renders are not rhythmically aligned. At 0 dB (today's
 * unity default) the sum peaks at +3.25 dBFS true peak, clipping outright.
 * -3 dB of uniform bus trim is NOT enough — the sum still peaks at +0.25
 * dBFS. -6 dB is: the sum peaks at -2.75 dBFS (short-term LUFS -16.5),
 * 2.75 dB of margin below full scale, close to the "-3 dBFS or better"
 * target. `padVolume` was not rendered as a fifth simultaneous source (the
 * measurement brief named exactly four), so a project with an active pad
 * layer on top has less margin than this number implies — see the
 * calibration script's own comment.
 */
export const DEFAULT_BUS_TRIM_DB: number = -6;

/**
 * The bottom of the fader AND the stored representation of silence.
 *
 * murva's canonical `SILENCE_DB` is `-Infinity`, which survives its Zod
 * socket boundary. These values cross `JSON.stringify` twice — the persist
 * payload and the `.solna` body — and `JSON.stringify(-Infinity)` is `null`.
 * So silence is stored as a finite -60 dB: `dbToGain(-60)` is 0.001, which is
 * inaudible, and it coincides with `DISPLAY_FLOOR_DBFS`, so the fader bottom
 * and the silence value are the same place.
 */
export const FADER_MIN_DB: number = SILENCE_DB;

/**
 * The `<input type="range">` step, in POSITION (0..1), not in dB. A fixed dB
 * step is wrong on a tapered control — it is coarse at the bottom and absurd
 * at the top. 200 detents is ~0.4 dB below unity and ~0.24 dB above it.
 */
export const FADER_POSITION_STEP = 0.005;

/**
 * Validate an unknown as a stored fader dB value: default-on-invalid, not
 * clamp-on-invalid. What is unknown about an out-of-range number is its
 * UNIT, not its magnitude — a stored `70` is not "very loud on this scale",
 * it is a number from some other scale (a pre-DEV-388 linear reading, a
 * hand-edited file), and pulling it to +12 dB is a confident, loud, WRONG
 * guess. murva's `normalizeCompanionVolumeDb` reaches the same conclusion
 * independently. A value that IS in range passes through untouched — only
 * the bound is ever in question there, never the unit.
 *
 * Every caller reads from storage or an imported file (persisted state, a
 * `.solna` body, a per-loop/per-track value nested in either), so every
 * caller wants this direction. A value the app computes for itself — a UI
 * drag position, an arithmetic result already known to be in dB — would want
 * clamping instead, but no such caller exists here today.
 */
export function asFaderDb(value: unknown, fallback: number = DEFAULT_FADER_DB): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < FADER_MIN_DB || value > FADER_MAX_DB) return fallback;
  return value;
}

/**
 * THE STORE -> ENGINE CONVERSION. `engineSync.ts` calls this and nothing else;
 * it is not `dbToGain` with extra steps.
 *
 * At the bottom of the fader it returns EXACTLY 0, where `dbToGain(-60)` would
 * return 0.001. Every DAW's fader bottom is silence, not "very quiet", and a
 * bus a user has pulled all the way down must not still pass a thousandth of
 * its signal. The stored value stays the finite SILENCE_DB so it survives
 * JSON.stringify twice; this is the audio half of that same decision.
 *
 * The -59.9 -> -60 discontinuity is inaudible and clickless: both values are
 * ~60 dB below anything the ear resolves in context, and every consumer ramps
 * with setTargetAtTime, so the step is a ramp between two silences.
 *
 * A non-finite value is silence rather than NaN, because NaN written to an
 * AudioParam poisons the node for the rest of the session.
 */
export function faderDbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= FADER_MIN_DB) return 0;
  return dbToGain(toDecibels(Math.min(FADER_MAX_DB, db)));
}


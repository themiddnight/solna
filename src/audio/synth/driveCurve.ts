import { dbToGain } from '@/utils/synthPatch';

/**
 * The pre-filter drive stage's transfer curve (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "pre-filter drive dB").
 *
 * Deterministic by construction — the same `driveDb` always builds the same
 * `Float32Array`, with no RNG and no context state — which is what lets the
 * offline mixdown render produce the same samples as the realtime engine. It
 * is also why the curve is a pure function in its own module
 * rather than a method on the voice: a voice has a lifetime, a transfer curve
 * does not.
 */

/**
 * ODD on purpose. A `WaveShaperNode` maps the input range -1..+1 evenly onto
 * the curve's indices, so an even sample count has no index sitting exactly at
 * x = 0 — silence would then read one of the two samples straddling zero and
 * the stage would apply a small DC offset to every voice that passes through
 * it, drive or no drive. 1025 is 1024 + the center sample.
 */
export const DRIVE_CURVE_SAMPLES = 1025;

/**
 * Builds the waveshaper curve for `driveDb`.
 *
 * At 0 dB the curve is EXACTLY the identity `y = x` — not approximately, and
 * not a saturator that happens to be gentle: the drive control's zero position
 * must be bit-transparent, because it is the default in every shipped patch
 * and a stage that colours the signal at its neutral setting is a stage no
 * user can turn off.
 *
 * Above 0 dB it blends the identity towards a normalized `tanh` saturator.
 * The blend weight `1 - 1/drive` is 0 at exactly 0 dB and rises continuously
 * with drive, so nudging the knob off zero nudges the sound off clean; a bare
 * `tanh(drive * x) / tanh(drive)` would have jumped to a visibly bent curve
 * the instant the knob left zero, because that expression is the identity only
 * in the limit as drive approaches 0, never at drive = 1.
 *
 * `tanh` is odd, so the curve stays odd: the stage generates odd harmonics
 * only and adds no DC, whatever the drive. A NEGATIVE `driveDb` is the
 * identity too — drive saturates, it does not trim, and a level control that
 * hid inside a distortion stage would make the patch's own levels lie.
 */
/**
 * The last curve built, shared with the next caller that asks for the same one.
 *
 * One entry, not a keyed cache. A curve is a pure function of `driveDb`, and
 * the two paths that build them both ask for the SAME `driveDb` several times
 * in a row: `createGroup` loops once per unison voice (presets ship up to 6),
 * and a drive drag re-runs `updateTail` for every sounding voice inside one
 * coalesced frame. A single slot catches both runs completely, while a keyed
 * Map would grow one 4 KB entry per distinct value a drag passes through and a
 * quantized key would mean a curve subtly unlike the number on the knob.
 *
 * Safe to share: nothing mutates a curve after it is built, and `WaveShaperNode`
 * only reads the array it is handed. Plain module state rather than a WeakMap
 * keyed by context — a `Float32Array` is not bound to an `AudioContext`, so the
 * live engine and an offline render can hold the same one.
 */
let lastCurve: { driveDb: number; samples: number; curve: Float32Array<ArrayBuffer> } | null = null;

export function driveCurve(driveDb: number, samples = DRIVE_CURVE_SAMPLES): Float32Array<ArrayBuffer> {
  if (lastCurve && lastCurve.driveDb === driveDb && lastCurve.samples === samples) {
    return lastCurve.curve;
  }
  const curve = new Float32Array(samples);
  const drive = dbToGain(driveDb);
  const blend = drive > 1 ? 1 - 1 / drive : 0;
  const last = samples - 1;
  const normalize = blend > 0 ? Math.tanh(drive) : 1;
  for (let i = 0; i <= last; i++) {
    const x = (i / last) * 2 - 1;
    curve[i] = blend > 0 ? x + (Math.tanh(drive * x) / normalize - x) * blend : x;
  }
  lastCurve = { driveDb, samples, curve };
  return curve;
}

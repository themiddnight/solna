/**
 * Verifies that the 13 drum kits in DRUM_KITS are audibly distinguishable:
 *  1. Every kit overrides EVERY drum type (no type left at DEFAULT_DRUM_KIT values).
 *  2. Each listed parameter has enough spread (max >= factor * min) across merged kits.
 *
 * Run with: bun scripts/check-drum-kit-separation.ts
 * Exit code 1 if any check fails.
 */
import {
  DEFAULT_DRUM_KIT,
  DRUM_KITS,
  DRUM_TYPES,
  type DrumKit,
} from '../src/data/drumKits.ts';
import { mergeDrumKit } from '../src/audio/drumKits.ts';

let failures = 0;

function report(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!pass) failures += 1;
}

const kits = Object.entries(DRUM_KITS).map(([name, partial]) => ({
  name,
  kit: mergeDrumKit(partial),
}));

// --- Check 1: every kit overrides every drum type ---
for (const { name, kit } of kits) {
  for (const type of DRUM_TYPES) {
    const merged = kit[type] as Record<string, unknown>;
    const defaults = DEFAULT_DRUM_KIT[type] as Record<string, unknown>;
    const differingParams = Object.keys(merged).filter((key) => merged[key] !== defaults[key]);
    const pass = differingParams.length > 0;
    const detail = pass
      ? `differs in ${differingParams.length} of ${Object.keys(merged).length} params`
      : `NO override: ${type} equals DEFAULT_DRUM_KIT`;
    report(`kit "${name}" overrides ${type}`, pass, detail);
  }
}

// --- Check 2: spread requirements (min/max across merged kits) ---
/**
 * A spread over an OPTIONAL parameter: only the kits that define it count.
 * `minCount` is what stops the check passing vacuously - two kits with a
 * click and ten without would otherwise satisfy any factor.
 */
function spreadDefined(
  label: string,
  pick: (kit: DrumKit) => number | undefined,
  factor: number,
  minCount: number,
) {
  const values = kits.map((k) => pick(k.kit)).filter((v): v is number => v !== undefined);
  if (values.length < minCount) {
    report(`${label} spread`, false, `only ${values.length} of ${kits.length} kits define it, need ${minCount}`);
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const required = factor * min;
  report(
    `${label} spread`,
    max >= required,
    `${values.length} kits define it, max=${max}, min=${min}, required max >= ${factor}*min=${required.toFixed(3)}` +
      // A failure here means one kit's value is too close to another's, not
      // that the factor is too strict. Say so, or the cheapest-looking fix
      // is lowering the factor, which is the one response this gate forbids.
      (max >= required ? '' : ' -- retune a kit to widen this spread; do not lower the factor'),
  );
}

/**
 * A spread over a REQUIRED parameter: exactly `spreadDefined` with every kit
 * counted, so a value that goes missing at runtime fails the count instead of
 * shrinking the sample the factor is measured over.
 */
function spread(label: string, pick: (kit: DrumKit) => number, factor: number) {
  spreadDefined(label, pick, factor, kits.length);
}

spread('hihat.filter', (k) => k.hihat.filter, 2.5);
spread('kick.decay', (k) => k.kick.decay, 3);
spread('kick.freqEnd', (k) => k.kick.freqEnd, 1.5);
spread('snare.noiseFilter', (k) => k.snare.noiseFilter, 2.8);
spread('snare.bodyFreqEnd', (k) => k.snare.bodyFreqEnd, 1.5);

// --- Check 2d: the second snare partial and the rimshot (spec decision 31) ---
// 1.5, not the 2.5 an earlier draft carried. Calibration of a new check, not
// relaxation of an old one: this field does not exist until step 1 of this
// task, so the factor has never run in CI and has never been green. The 2.5
// was derived from a 4.26 ratio that was itself an artefact of Warm Riddim's
// 900 Hz snare - the outlier step 4 removes - so it never measured the library.
// 1.5 mirrors spread('snare.bodyFreqEnd'), because a partial that tracks the
// fundamental cannot spread wider than the fundamental does. From the commit
// that lands it, Constraint 8 protects this floor like any other.
spread('snare.bodyFreqEnd2', (k) => k.snare.bodyFreqEnd2, 1.5);
// 1.6 was chosen after the thirteen bodyGain2 values were authored (measured
// 1.83, 0.18-0.33) and is a FLOOR from this commit, like every other spread().
spread('snare.bodyGain2', (k) => k.snare.bodyGain2, 1.6);
// 1.7 was chosen after the thirteen rimshot.bodyFreqEnd values were authored
// (measured 2.11, 415-875) and is a FLOOR from this commit.
spread('rimshot.bodyFreqEnd', (k) => k.rimshot.bodyFreqEnd, 1.7);
// 1.4 was chosen after the thirteen rimshot.bodyFreqEnd2 values were authored
// (measured 1.79, 1310-2350) and is a FLOOR from this commit.
spread('rimshot.bodyFreqEnd2', (k) => k.rimshot.bodyFreqEnd2, 1.4);
// 2.0 was chosen after the thirteen rimshot.bodyDecay values were authored
// (measured 2.44, 0.045-0.11) and is a FLOOR from this commit.
spread('rimshot.bodyDecay', (k) => k.rimshot.bodyDecay, 2.0);
spread('clap.filter', (k) => k.clap.filter, 1.8);
spread('openhat.filter', (k) => k.openhat.filter, 2.2);
spread('crash.filter', (k) => k.crash.filter, 1.5);

// --- Check 2b: the parameters that let the collapse through (spec decision 19) ---
// check:drums never looked at any of these, which is how hihat.decay sat in a
// 2.0x band and snare.bodyTime was one copy-pasted number in all 13 entries.
spread('hihat.decay', (k) => k.hihat.decay, 3.0);
spread('hihat.gain', (k) => k.hihat.gain, 1.5);

// --- Check 2c: the new hat/cymbal axis (spec decision 30, ruling R5) ---
// metal is the second hat axis. If these spreads pass with thirteen equal
// values the axis does not exist, which is the failure this landed to prevent.
// 3.0 and 2.5 were calibrated after authoring the table, not reasoned in
// advance: measured hihat.metal/openhat.metal is 0.15->0.90 (6.0x) and
// crash.metal is 0.25->0.92 (3.68x), so both factors sit under the measured
// ratio with margin. From the commit that landed them, both are floors this
// check protects like any other spread() entry — retune a kit to widen the
// spread if one of these ever goes red, never lower the factor.
spread('hihat.metal', (k) => k.hihat.metal, 3.0);
spread('openhat.metal', (k) => k.openhat.metal, 3.0);
spread('crash.metal', (k) => k.crash.metal, 2.5);

spread('snare.bodyTime', (k) => k.snare.bodyTime, 2.5);
spread('kick.pitchTime', (k) => k.kick.pitchTime, 3.0);
spreadDefined('kick.clickLevel', (k) => k.kick.clickLevel, 2.0, 8);

// --- Check 2c: the routing parameters (spec decision 25) ---
// Every kit's value is > 0 by construction (asserted in audio/drumKits.test.ts):
// a single kit at 0 would make `factor * min` zero and this check vacuous.
// The 3.0 factor is CALIBRATION, not a prior constraint the values were tuned
// to meet: the thirteen reverbSend values (and their measured ratios, kick
// 9.00x / tom 6.25x) were fixed by the brief before this factor was chosen,
// with headroom picked after the fact so a later retune has room to move.
// It was still added before the values were authored in this file, and it
// was observed to fail at the values' 1.0x starting point (every kit
// inheriting the one default) before being satisfied — so the check itself
// was exercised, even though the factor was not a constraint on the numbers.
// From this commit it is a FLOOR: do not lower it to dodge a future failure.
spread('kick.reverbSend', (k) => k.kick.reverbSend, 3.0);
spread('lowtom.reverbSend', (k) => k.lowtom.reverbSend, 3.0);

// --- Check 2d: the hat's second axis (spec decision 26) ---
// One highpass buys about 2.5 hat characters and four kit groups share a hat
// because of it. topCut is the axis that separates them, so it gets a floor of
// its own rather than riding on hihat.filter's.
// The 2.0 factor is CALIBRATION, not a prior constraint the values were tuned
// to meet: the thirteen topCut values (and their measured ratios, hihat.topCut
// 2.40x / openhat.topCut 2.43x) were fixed by the brief before this factor was
// chosen, with headroom picked after the fact. From this commit it is a
// FLOOR: do not lower it to dodge a future failure.
spread('hihat.topCut', (k) => k.hihat.topCut, 2.0);
spread('openhat.topCut', (k) => k.openhat.topCut, 2.0);

// --- Check 2e: the tom split (spec decision 32) ---
spread('lowtom.freqEnd', (k) => k.lowtom.freqEnd, 1.5);
spread('hitom.freqEnd', (k) => k.hitom.freqEnd, 1.6);
spread('hitom.decay', (k) => k.hitom.decay, 2.5);
// Calibrated against step 4's derived table (measured 1.571, 1.71, 3.00), per
// task 2, step 2: a new check gets its first value here, and is a Constraint 8
// floor from this commit on.

// --- Check 2f: the hi tom must not sit on the snare's note ---
// Without this cap a descending fill turns to mud: the hi tom lands on the
// same pitch as the snare body and the ear hears one instrument, not two.
for (const { name, kit } of kits) {
  const cap = 0.85 * kit.snare.bodyFreqEnd;
  report(
    `kit "${name}" hitom.freqEnd <= 0.85 * snare.bodyFreqEnd`,
    kit.hitom.freqEnd <= cap,
    `hitom.freqEnd=${kit.hitom.freqEnd}, cap=${cap.toFixed(1)}`,
  );
}

// --- Check 2g: the two new cymbal voices (spec decisions 33, 34) ---
// All eight factors are calibrated against the values authored for this
// commit (measured 2.67, 1.78, 2.08, 1.43, 6.0, 2.27, 1.83, 1.36) — task 2,
// step 2 states why that is not the relaxation Global Constraint 8 forbids,
// and they become protected floors the moment this commit lands.
spread('ride.ping', (k) => k.ride.ping, 2.0);
spread('ride.pingDecay', (k) => k.ride.pingDecay, 1.6);
spread('ride.washDecay', (k) => k.ride.washDecay, 1.8);
spread('ride.pingFilter', (k) => k.ride.pingFilter, 1.35);
spread('ride.metal', (k) => k.ride.metal, 3.0);
spread('bell.filter', (k) => k.bell.filter, 2.0);
spread('bell.decay', (k) => k.bell.decay, 1.6);
spread('bell.gain', (k) => k.bell.gain, 1.25);

/**
 * Check 2h: WITHIN one kit, two voices that could collapse into each other
 * must be measurably apart on the parameter that defines the difference
 * (spec decisions 32-34, ruling R6).
 *
 * This is a different question from PAIRWISE_PARAMS, which asks whether two
 * KITS differ. It is also why the new voices do NOT enter PAIRWISE_PARAMS:
 * that list is a max over its entries, so adding one can only raise every
 * pair's separation and make the floor easier to clear. This is a floor.
 *
 * Distance is in octaves, |log2(a/b)|, so it reads the same for a frequency
 * and for a decay.
 */
function withinKit(
  label: string,
  pick: (kit: DrumKit) => [number, number],
  minOctaves: number,
  minCount: number,
) {
  // Fails CLOSED, not open: NaN < Infinity and Infinity < Infinity are both
  // false, so an unmeasurable pair (an undefined field, a 0 numerator or
  // denominator, both zero, a negative value) used to be silently SKIPPED,
  // and if every kit were unmeasurable `worst` stayed at its Infinity seed
  // and cleared any floor. Skipping a non-finite ratio is still correct - it
  // is not a real measurement - but a `minCount` in the shape of
  // `spreadDefined`'s makes too few measurable pairs a FAIL instead of a
  // silent pass, the same way an emptied `kits` array now fails instead of
  // vacuously clearing the floor with `worst.d === Infinity`.
  const measured: { name: string; d: number; a: number; b: number }[] = [];
  for (const { name, kit } of kits) {
    const [a, b] = pick(kit);
    const d = Math.abs(Math.log2(a / b));
    if (!Number.isFinite(d)) continue;
    measured.push({ name, d, a, b });
  }
  if (measured.length < minCount) {
    report(
      `within-kit ${label}`,
      false,
      `only ${measured.length} of ${kits.length} kits produced a measurable ratio, need ${minCount}`,
    );
    return;
  }
  const worst = measured.reduce((w, m) => (m.d < w.d ? m : w));
  const failing = measured.filter((m) => m.d < minOctaves);
  const detail = failing.length === 0
    ? `closest kit is "${worst.name}" at ${worst.d.toFixed(3)} octaves (a=${worst.a}, b=${worst.b}), floor ${minOctaves}`
    : `${failing.length} kit(s) below the ${minOctaves} floor -- retune; do not lower the floor: ` +
      failing.map((f) => `"${f.name}" at ${f.d.toFixed(3)} (a=${f.a}, b=${f.b})`).join('; ');
  report(`within-kit ${label}`, failing.length === 0, detail);
}

// hitom vs lowtom: the split is vacuous if both toms are the same drum. The
// research ratio is 1.9-2.1x, but the snare cap of decision 32 pulls eight
// kits below it. Calibrated against the measured library, not chosen in
// advance: Warehouse is the closest at 0.799, a 6% margin over this floor,
// with 808 Vintage and Acoustic Studio right behind at 0.807 - three kits
// inside 8% of it. Warehouse is squeezed from the other side too: its
// hitom.freqEnd (160) sits within 0.4% of its own snare cap of 160.7 (Check
// 2f) and under 4% above lowtom.freqEnd, so it has almost no room left in
// either direction. From this commit it is a FLOOR: retune a kit to widen the
// gap, do not lower the number to dodge a future failure.
withinKit('hitom vs lowtom on freqEnd', (k) => [k.hitom.freqEnd, k.lowtom.freqEnd], 0.75, kits.length);

// ride vs crash: a ride is a DEFINED PING, a crash is a bloom that collapses.
// If a ride is ever implemented as a re-filtered crash, this is what catches
// it. Calibrated against the measured library, not chosen in advance:
// Lo-Fi Vinyl is the closest at 2.644 octaves. From this commit it is a
// FLOOR: do not lower it to dodge a future failure.
withinKit('ride vs crash on strike decay', (k) => [k.ride.pingDecay, k.crash.decay], 2.0, kits.length);

// bell vs hihat: the nearest neighbours in brightness, and per decision 34 the
// case most likely to PASS ON NUMBERS WHILE FAILING THE EAR - the bell's real
// separation from a hat is harmonic structure, and no parameter-spread
// assertion looks at that. A green line here is not a verdict; the listening
// pass (decision 42) is. Calibrated against the measured library, not chosen
// in advance: Acoustic Studio is the closest at 1.678 octaves. From this
// commit it is a FLOOR: do not lower it to dodge a future failure.
withinKit('bell vs hihat on filter', (k) => [k.bell.filter, k.hihat.filter], 1.5, kits.length);

// rimshot vs snare: the defining property is that a rimshot is nearly all
// tone and nearly no noise. Same code path, opposite balance. Calibrated
// against the measured library, not chosen in advance: Lo-Fi Vinyl is the
// closest at 1.322 octaves. From this commit it is a FLOOR: do not lower it
// to dodge a future failure.
withinKit('rimshot vs snare on noiseGain', (k) => [k.rimshot.noiseGain, k.snare.noiseGain], 1.2, kits.length);

// --- Check 3: pairwise nearest-neighbour separation (spec decision 19) ---
// An aggregate spread is satisfied by two extreme kits and says nothing about
// the ten in between: Club Standard and Warehouse were measurably twins and
// passed CI for exactly that reason. This is whole-kit, not per-voice - two
// kits may share a hat (four groups deliberately do, because one highpass over
// white noise buys about 2.5 hat characters) as long as something diverges.
const PAIRWISE_PARAMS: { label: string; pick: (kit: DrumKit) => number }[] = [
  { label: 'kick.freqStart', pick: (k) => k.kick.freqStart },
  { label: 'kick.freqEnd', pick: (k) => k.kick.freqEnd },
  { label: 'kick.pitchTime', pick: (k) => k.kick.pitchTime },
  { label: 'kick.decay', pick: (k) => k.kick.decay },
  { label: 'kick.gain', pick: (k) => k.kick.gain },
  { label: 'snare.bodyFreqStart', pick: (k) => k.snare.bodyFreqStart },
  { label: 'snare.bodyDecay', pick: (k) => k.snare.bodyDecay },
  { label: 'snare.noiseFilter', pick: (k) => k.snare.noiseFilter },
  { label: 'snare.noiseDecay', pick: (k) => k.snare.noiseDecay },
  { label: 'snare.reverbSend', pick: (k) => k.snare.reverbSend },
  { label: 'hihat.filter', pick: (k) => k.hihat.filter },
  { label: 'hihat.decay', pick: (k) => k.hihat.decay },
  { label: 'hihat.gain', pick: (k) => k.hihat.gain },
  { label: 'openhat.filter', pick: (k) => k.openhat.filter },
  { label: 'openhat.decay', pick: (k) => k.openhat.decay },
  { label: 'clap.filter', pick: (k) => k.clap.filter },
  { label: 'clap.decay', pick: (k) => k.clap.decay },
  { label: 'clap.reverbSend', pick: (k) => k.clap.reverbSend },
  { label: 'lowtom.freqEnd', pick: (k) => k.lowtom.freqEnd },
  { label: 'lowtom.decay', pick: (k) => k.lowtom.decay },
  { label: 'crash.filter', pick: (k) => k.crash.filter },
  { label: 'crash.decay', pick: (k) => k.crash.decay },
  { label: 'crash.reverbSend', pick: (k) => k.crash.reverbSend },
];

/**
 * Doublings on whichever single parameter separates the two kits most.
 * NEVER lower MIN_PAIRWISE_SEPARATION to make this green: the only legal
 * response to a failure is retuning a kit until the pair really does diverge.
 */
const MIN_PAIRWISE_SEPARATION = 0.8;

let closest = { sep: Infinity, pair: '', on: '' };
for (let i = 0; i < kits.length; i++) {
  for (let j = i + 1; j < kits.length; j++) {
    const a = kits[i];
    const b = kits[j];
    let sep = 0;
    let on = '';
    for (const { label, pick } of PAIRWISE_PARAMS) {
      const d = Math.abs(Math.log2(pick(a.kit) / pick(b.kit)));
      if (d > sep) {
        sep = d;
        on = label;
      }
    }
    const key = `${a.name} <-> ${b.name}`;
    if (sep < closest.sep) closest = { sep, pair: key, on };
    if (sep >= MIN_PAIRWISE_SEPARATION) continue;
    report(
      `pairwise ${key}`,
      false,
      `separation ${sep.toFixed(3)} < ${MIN_PAIRWISE_SEPARATION} (widest gap is ${on}); retune one kit until the pair diverges`,
    );
  }
}
report(
  'pairwise nearest-neighbour separation',
  closest.sep >= MIN_PAIRWISE_SEPARATION,
  `closest is ${closest.pair} at ${closest.sep.toFixed(3)} on ${closest.on}`,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

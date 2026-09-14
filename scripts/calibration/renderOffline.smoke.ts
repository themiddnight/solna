/**
 * Manual proof that the render harness produces real, non-silent audio through the
 * real engine. NOT a `bun test` file, on purpose: it loads `node-web-audio-api`, a
 * native addon the shared contract keeps off the `bun test` critical path.
 *
 * Run: bun run calibration:smoke
 */
import {
  CALIBRATION_SAMPLE_RATE,
  DRUM_KIT_RENDER_SECONDS,
  renderDrumKit,
  renderPreset,
} from './renderOffline.ts';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { dbToGain, toDecibels } from '@/utils/gainUnits';

let failures = 0;

function report(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!pass) failures += 1;
}

function peakOf(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let peak = 0;
  for (let offset = 44; offset + 1 < wav.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)) / 32768);
  }
  return peak;
}

const retroKit = await renderDrumKit('Retro Drive');
report(
  'a rendered kit is 5.0 s of stereo 16-bit audio',
  retroKit.byteLength === 44 + CALIBRATION_SAMPLE_RATE * DRUM_KIT_RENDER_SECONDS * 2 * 2,
  `${retroKit.byteLength} bytes`,
);
report('a rendered kit is not silent', peakOf(retroKit) > 0.01, `peak ${peakOf(retroKit).toFixed(3)}`);

// Reproducibility (Task 8b): the noise buffer and its read offset route through the
// seeded rng seam, reset at the start of every renderDrumKit/renderPreset call. The
// reference pattern's hihat is the worst case (pure noise, no tonal component to
// mask a drifting sample), and it sounds on every 8th note of the render.
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const trapKit1 = await renderDrumKit('Trap Beat');
const trapKit2 = await renderDrumKit('Trap Beat');
report(
  'rendering a kit twice back to back is byte-identical',
  bytesEqual(trapKit1, trapKit2),
  `${trapKit1.byteLength} bytes each`,
);

// Something else rendered in between must not shift the stream: the seed resets
// at the START of every call, so this render must reproduce trapKit1/2 exactly.
await renderDrumKit('808 Vintage');
const trapKit3 = await renderDrumKit('Trap Beat');
report(
  'rendering a kit after rendering another kit still reproduces the same bytes',
  bytesEqual(trapKit1, trapKit3),
  `${trapKit3.byteLength} bytes`,
);

const pad = SYNTH_PRESETS.find((p) => p.category === 'Pad');
if (!pad) throw new Error('Unreachable: SYNTH_PRESETS ships at least one Pad patch');
const padWav = await renderPreset(pad);
report(`a rendered pad preset (${pad.name}) is not silent`, peakOf(padWav) > 0.01, `peak ${peakOf(padWav).toFixed(3)}`);
// The uncalibrated pass neutralises `common.outputGainDb`, which is the field
// that otherwise holds a stacked patch down — a multi-voice unison pad summing
// two oscillators, a sub and noise per voice is exactly the case that clips
// without CALIBRATION_HEADROOM_DB, and this pad rendered a clamped 1.000 the
// first time it ran without it. A clamped peak reads as a plausible dBFS number
// several tenths low, so the clip has to be caught here rather than believed.
report(
  `the uncalibrated pass leaves headroom (${pad.name})`,
  peakOf(padWav) < 0.99,
  `peak ${peakOf(padWav).toFixed(3)}, clamped at 1.000 would mean clipping`,
);

const padWavAgain = await renderPreset(pad);
report(
  `a rendered preset that uses noise (${pad.name}) is now reproducible`,
  padWav.byteLength === padWavAgain.byteLength && padWav.every((byte, i) => byte === padWavAgain[i]),
  `${padWav.byteLength} bytes each`,
);

const pluck = SYNTH_PRESETS.find((p) => p.category === 'Pluck');
if (!pluck) throw new Error('Unreachable: SYNTH_PRESETS ships at least one Pluck patch');
const pluckWav = await renderPreset(pluck);
report(`a rendered pluck preset (${pluck.name}) is not silent`, peakOf(pluckWav) > 0.01, `peak ${peakOf(pluckWav).toFixed(3)}`);

// The kit must actually reach the engine. A `setDrumKit` that silently no-opped
// would render thirteen identical patterns and produce thirteen identical trims
// that all looked plausible — the exact failure this harness exists to catch.
const otherKit = await renderDrumKit('808 Vintage');
// The reference pattern is the same notes for both kits, so the only thing that
// can move the peak is the kit itself. Calibrated once, with headroom below the
// currently measured gap (Retro Drive 0.388 vs 808 Vintage 0.232, a gap of
// 0.156), and a floor from the commit that sets it — see CLAUDE.md's `spread()`
// convention. A future retune that narrows the two kits' levels has real room to
// move before this flaps.
const KIT_PEAK_DELTA_FLOOR = 0.01;
report(
  'two kits render the same reference pattern at different peaks',
  Math.abs(peakOf(otherKit) - peakOf(retroKit)) > KIT_PEAK_DELTA_FLOOR,
  `Retro Drive ${peakOf(retroKit).toFixed(3)} vs 808 Vintage ${peakOf(otherKit).toFixed(3)}`,
);

// The applied-gain half. `renderPreset(preset, true)` installs the patch with its
// authored `common.outputGainDb`; `false` neutralises that one field to 0 dB and
// changes nothing else. So the ratio between the two peaks is the whole of what
// the calibration now does, and it is checkable in process with no mock and no
// spawned child — the id -> name trim bridge this used to have to prove through a
// fresh module graph does not exist any more.
//
// The down sweep is the fixture: one sine, no noise, no unison, so its peak is a
// clean number rather than a stochastic one. `dbToGain` is imported rather than
// re-derived, so a change to the dB convention moves the expectation with it.
const sweep = SYNTH_PRESETS.find((p) => p.id === 'factory-fx-down-sweep');
if (!sweep) throw new Error('Unreachable: SYNTH_PRESETS ships factory-fx-down-sweep');
const neutralSweep = await renderPreset(sweep, false);
const gainedSweep = await renderPreset(sweep, true);
const expectedRatio = dbToGain(toDecibels(sweep.patch.common.outputGainDb));
const actualRatio = peakOf(gainedSweep) / peakOf(neutralSweep);
// A tight band: this is arithmetic on one gain node, not a loudness measurement.
// 3% absorbs 16-bit quantisation of the peak sample and nothing else — a patch
// whose gain silently failed to apply would read 1.0 here.
report(
  `a preset renders at its own common.outputGainDb (${sweep.name}, ${sweep.patch.common.outputGainDb} dB)`,
  Math.abs(actualRatio - expectedRatio) < 0.03 * expectedRatio,
  `peak ratio ${actualRatio.toFixed(4)}, expected ${expectedRatio.toFixed(4)}`,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

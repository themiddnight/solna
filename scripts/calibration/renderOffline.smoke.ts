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

// `renderPreset` resolves the trim gain caller-side via `synthTrimGainFor(preset.name)`,
// which is keyed by NAME but reads an index built from `PRESET_TRIMS`, which is keyed
// by preset ID (`src/audio/trims.ts`'s `TRIM_GAIN_BY_PRESET_NAME`). That id -> name
// bridge is never exercised by the checks above, because `PRESET_TRIMS` is still empty
// (Task 11 fills it) and both calls above use `applyTrim = false` regardless. Proving it
// resolves requires a fresh module graph with `@/data/trimTable` mocked BEFORE
// `renderOffline.ts` (and, transitively, `trims.ts`) is ever imported — `trims.ts` builds
// its name index once, at import time, so re-importing `./renderOffline.ts` in *this*
// process would just return the already-cached, already-real module. A spawned child
// process is what gives the mock a module graph of its own.
// bun-types is deliberately not a devDependency (see ffmpegPath.ts) so this
// declares the one Bun global this function needs, scoped to this module only.
declare const Bun: {
  spawnSync(cmd: string[], opts: { cwd: string }): { exitCode: number; stdout: { toString(): string }; stderr: { toString(): string } };
};

async function checkPresetTrimBridge(padPreset: { id: string; name: string }): Promise<void> {
  const trimDb = -6;
  const childScript = `
    import { mock } from 'bun:test';
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {},
      PRESET_TRIMS: { ${JSON.stringify(padPreset.id)}: { measuredDbfs: 0, trimDb: ${trimDb}, configHash: 'smoke-check' } },
    }));
    const { renderPreset } = await import(${JSON.stringify(new URL('./renderOffline.ts', import.meta.url).href)});
    const { SYNTH_PRESETS } = await import('@/data/synthPresets');
    const preset = SYNTH_PRESETS.find((p) => p.id === ${JSON.stringify(padPreset.id)});
    function peakOf(wav) {
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let peak = 0;
      for (let offset = 44; offset + 1 < wav.byteLength; offset += 2) {
        peak = Math.max(peak, Math.abs(view.getInt16(offset, true)) / 32768);
      }
      return peak;
    }
    const untrimmed = await renderPreset(preset, false);
    const trimmed = await renderPreset(preset, true);
    console.log(JSON.stringify({ ratio: peakOf(trimmed) / peakOf(untrimmed) }));
    process.exit(0);
  `;
  const child = Bun.spawnSync(['bun', '-e', childScript], { cwd: process.cwd() });
  if (child.exitCode !== 0) {
    report('preset trim resolves through the real id -> name bridge', false, child.stderr.toString().slice(0, 200));
    return;
  }
  const { ratio } = JSON.parse(child.stdout.toString().trim()) as { ratio: number };
  // Expected gain ratio for -6 dB is ~0.501. The band is wide (0.3-0.7, roughly
  // ±3.5 dB either side) because the pad carries noise, whose level is not yet
  // seeded/deterministic across runs (tracked separately, not this task's fix) —
  // this only needs to prove the trim landed at all, not measure it precisely.
  report(
    `preset trim resolves through the real id -> name bridge (${padPreset.name})`,
    ratio > 0.3 && ratio < 0.7,
    `untrimmed:trimmed peak ratio ${ratio.toFixed(3)}, expected ~0.501 for ${trimDb} dB`,
  );
}

await checkPresetTrimBridge(pad);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

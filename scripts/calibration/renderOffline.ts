/**
 * The render half of the calibration harness. It drives the REAL AudioEngine — the
 * same `triggerDrum` / `triggerSynthNoteOn` a player hits — against a
 * `node-web-audio-api` OfflineAudioContext, through the engine's own render seam,
 * `createRenderEngine(ctx)`: a throwaway instance bound to the caller's context with
 * the master chain built on it. That replaced the `makeEngine() as any; engine.ctx =
 * ctx; engine.setupMasterChain()` dance this file used to perform; the `as any` that
 * remains is for the private send nodes reached AFTER binding, not for constructing
 * an engine. Measuring anything else would measure a model of the engine rather than
 * the engine.
 *
 * Two departures from a live session, both deliberate:
 *  - the three parallel sends (reverb, delay, distortion) are zeroed, so the
 *    measurement is the DRY voice. A wet tail's level is a user setting; a voice's
 *    level is not. This is also why `reverbSend` is excluded from the config hash.
 *  - master volume sits at unity, and the compressor/limiter are forced OFF here
 *    regardless of `INITIAL_EFFECTS` — since DEV-383 the limiter defaults ON for a
 *    fresh session, but a trim measurement must isolate the dry, unshaped signal, so
 *    this harness hardcodes `rewireMasterDynamics(false, false)` rather than reading
 *    the store default. Its empty `stages` array routes `masterGain` straight past
 *    both analyser taps to the destination with neither node connected. So the
 *    render measures the fixed, always-in-circuit EQ (ahead of `masterGain`) with
 *    both dynamics stages disconnected, not "engaged but not meaningfully so" — a
 *    deliberate departure from a fresh session's actual default, kept so the
 *    committed trim table stays independent of whichever dynamics defaults ship.
 *    The ONE exception is the kit reference pattern (`renderDrumKit`), which runs
 *    at `CALIBRATION_HEADROOM_DB` below unity — see that constant's comment.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createRenderEngine } from '@/audio/engine';
import { applyPreset } from '@/audio/presetRegistry';
import { synthTrimGainFor } from '@/audio/trims';
import { withSeededRandom } from '@/audio/rng';
import { DRUM_KITS, type DrumType } from '@/data/drumKits';
import type { SynthPresetItem } from '@/data/synthPresets';
import { INITIAL_SYNTH_PARAMS } from '@/store/initialState';
import { dbToGain, toDbfs, toDecibels, type Dbfs } from '@/utils/gainUnits';
import { encodeWav } from '@/utils/encodeWav';
import { measureLoudness } from './measureLoudness.ts';
import { CALIBRATION_SEED } from './seededRandom.ts';

export const CALIBRATION_SAMPLE_RATE = 44100;
export const CALIBRATION_CHANNELS = 2;
/** Max velocity — the AC calibrates "at max velocity", not at DEFAULT_VELOCITY. */
export const CALIBRATION_VELOCITY = 1;

/** Where the first hit of a render lands. Late enough that the engine's own
 *  first-node setup never truncates it, early enough that two bars of pattern
 *  still finish with tail inside DRUM_KIT_RENDER_SECONDS. */
export const DRUM_FIRST_HIT_S = 0.25;

/**
 * The fixed reference pattern used to measure a whole KIT's level (DEV-387: drum
 * trims are per kit, not per voice — see the comment on `DRUM_TRIMS` in
 * src/data/trimTable.ts). One pattern, identical for every kit, because
 * comparability BETWEEN kits is the entire point: measuring each kit against a
 * pattern of its own would make "kit A is quieter than kit B" ambiguous between
 * "quieter kit" and "quieter pattern".
 *
 * A plain backbeat — kick on 1 and 3, snare on 2 and 4, closed hihat on every
 * 8th note — at 120 BPM (0.5 s/beat) over two bars:
 *  - Kick and snare are what a listener's ear locks onto as "how loud is this
 *    kit", and the backbeat is the shape every kit's kick/snare pair is voiced
 *    for. A single isolated hit, or an arrhythmic scatter, would not exercise
 *    the same perceived loudness a bar of real playback does.
 *  - Hihat is included, at the closed-hat density a real groove uses, because it
 *    is the voice `ebur128`'s rolling short-term window integrates continuously
 *    BETWEEN the sparser kick/snare hits — kick-and-snare alone would leave long
 *    silent gaps for the analyser to survive, where the eighth-note hat is what a
 *    resting kit actually sounds like.
 *  - Rimshot, clap, openhat, hitom, lowtom, ride, crash and bell are deliberately
 *    absent: they are accents layered ON TOP of a groove, not the pulse a kit's
 *    overall level is heard against, and leaving them out keeps the pattern —
 *    and therefore the number — identical for every kit regardless of which
 *    accent voices it even has.
 *  - Two bars at 120 BPM is 4.0 s of pattern. Started at DRUM_FIRST_HIT_S and
 *    rendered inside DRUM_KIT_RENDER_SECONDS = 5 s, the ebur128 3 s short-term
 *    gate clears with a full second of
 *    margin, and the last hit (t = 3.75 s, beat 4 of bar 2) still has 1.25 s of
 *    render left for its tail — no event is truncated by the render boundary.
 *
 * The kit this pattern represents least well is Warm Riddim, a reggae one-drop
 * (Carlton Barrett/King Tubby-referent) whose identity is a rimshot on 3 and NO
 * kick on beat 1 — this backbeat plays it in a shape it is explicitly not voiced
 * for, and never sounds the rimshot that actually carries it. Still fine: the
 * trim this produces is one scale factor applied to the whole kit, so the kit's
 * own internal balance (rimshot vs everything else) is untouched regardless of
 * what shape it was measured in, and no kit in the roster authors an accent
 * voice more than 2.3 dB above the mean of the pattern's own voices — so even a
 * pattern this kit "disagrees with" cannot mis-measure it by much.
 */
export const DRUM_KIT_RENDER_SECONDS = 5;
/**
 * `DRUM_KIT_RENDER_SECONDS = 5` is load-bearing for a SECOND reason beyond
 * clearing the 3 s gate: it protects the MEDIAN. The render yields 21 valid
 * short-term frames; the pattern plateau (hits still sounding, t up to ~3.75 s)
 * covers 13 of them, and `sorted[floor(21/2)]` = index 10 lands three frames
 * inside that plateau — a margin of 0.3 s. Raising this constant with the same
 * two-bar pattern would eventually put the post-hit decay tail's frames in the
 * majority and silently move every committed number by roughly a dB: shortening
 * the render "to save time" is exactly as dangerous, since it also moves how
 * many tail frames survive the gate. This constant and DRUM_KIT_BAR's length are
 * a matched pair; changing one without re-checking the other's plateau margin is
 * the trap.
 */
/**
 * The kit reference render peaks above full scale before the WAV encoder's ±1.0
 * clamp: uncalibrated, Retro Drive measured a float peak of 1.55, Tight Pocket
 * 1.32 (trim applied, 2.02). Nine drum voices are additive at the same sample,
 * and the backbeat overlaps kick/snare/hihat by design (see DRUM_KIT_BAR) — nine
 * simultaneous full-scale voices is exactly the case a single-voice calibration
 * default was never tuned against. Rather than raise the clamp (which would
 * change what a live session's own limiter-off master chain actually does) or
 * document the clipping and move on, the render runs `CALIBRATION_HEADROOM_DB`
 * quieter than the live default, and `generateTrimTable.ts` adds the same
 * number of dB back onto the measured `LUFS` reading before computing the trim.
 * `ebur128` correctly reports the loudness of what was RENDERED, so subtracting
 * headroom pre-render and adding it back post-measurement recovers the true,
 * unclipped level exactly — this is not an approximation. Measured cost of NOT
 * doing this: re-rendering six kits with headroom and correcting differs from
 * the clipped numbers by only 0.04 dB, below ffmpeg's own 0.1 dB readout, so no
 * committed number materially depended on the clip — but Task 12's
 * `verifyApplied` check for Tight Pocket, which re-measures WITH the trim
 * applied (the loudest case, 2.02 peak), reads 0.34 dB low purely from clipping
 * without this fix. 12 dB comfortably clears the largest observed pre-headroom
 * peak (Retro Drive 1.55 => ~3.8 dB over) with margin for the trimmed path too.
 */
export const CALIBRATION_HEADROOM_DB = 12;
/** 120 BPM. Fixed, not authored per kit: uniformity is what makes kit numbers
 *  comparable across the roster — one tempo for every kit, so a difference in
 *  the measured number is a difference in the kit and never in the pattern. */
export const DRUM_KIT_BEAT_S = 0.5;
export const DRUM_KIT_BAR_COUNT = 2;
export const DRUM_KIT_BEATS_PER_BAR = 4;

interface DrumKitPatternHit {
  voice: DrumType;
  /** Offset from the start of the bar, in beats (quarter notes); 0.5 = an
   *  off-beat 8th note. */
  beat: number;
}

/** One bar of the backbeat: kick on 1 & 3, snare on 2 & 4, closed hihat on every
 *  8th note (the four on-beat hits plus the four off-beat 8ths). */
export const DRUM_KIT_BAR: readonly DrumKitPatternHit[] = [
  { voice: 'kick', beat: 0 },
  { voice: 'hihat', beat: 0 },
  { voice: 'hihat', beat: 0.5 },
  { voice: 'snare', beat: 1 },
  { voice: 'hihat', beat: 1 },
  { voice: 'hihat', beat: 1.5 },
  { voice: 'kick', beat: 2 },
  { voice: 'hihat', beat: 2 },
  { voice: 'hihat', beat: 2.5 },
  { voice: 'snare', beat: 3 },
  { voice: 'hihat', beat: 3 },
  { voice: 'hihat', beat: 3.5 },
];

export const SYNTH_RENDER_SECONDS = 6.5;
export const SYNTH_FIRST_NOTE_S = 0.25;
export const SYNTH_NOTE_INTERVAL_S = 1.5;
/** Long enough that a pad with attack up to ~1.0 s reaches sustain inside the gate. */
export const SYNTH_NOTE_GATE_S = 1.3;
export const SYNTH_NOTE_COUNT = 4;
/** The preset's own `octave` shifts this, exactly as a player hears it. */
export const SYNTH_CALIBRATION_NOTE = 'C3';

/* eslint-disable @typescript-eslint/no-explicit-any -- constructing the engine goes
   through the supported createRenderEngine seam now, but the send gains it reaches
   afterwards (reverbGain and the dry-only loop's siblings) are still private, the
   same way src/audio/testFakes.ts reaches engine internals. */

interface Harness {
  engine: any;
  ctx: any;
}

function createHarness(seconds: number, headroomDb = 0): Harness {
  const ctx = new OfflineAudioContext(
    CALIBRATION_CHANNELS,
    Math.round(CALIBRATION_SAMPLE_RATE * seconds),
    CALIBRATION_SAMPLE_RATE,
  );
  const engine = createRenderEngine(ctx) as any;
  // Dry only. Zeroing the send gains is one line each and beats building a whole
  // neutral MasterEffects literal that would then need maintaining alongside the
  // real one. The `reverbSend` field is excluded from the config hash on the
  // strength of THIS loop actually zeroing `reverbGain` — a skipped, renamed or
  // unbuilt field must fail the render loudly, not silently leave a wet path in
  // the measurement while this comment keeps claiming it is dry.
  for (const send of ['reverbGain', 'delayGain', 'distortionGain']) {
    const node = engine[send];
    if (!node) {
      throw new Error(
        `createHarness: engine.${send} is missing after setupMasterChain(). The ` +
          'dry-only guarantee (and the reverbSend exclusion from the config hash ' +
          'it backs) depends on zeroing every parallel send node here — refusing ' +
          'to render rather than silently measuring a wet voice.',
      );
    }
    node.gain.value = 0;
  }
  // headroomDb = 0 for every render except the kit reference pattern: unity,
  // unchanged. See CALIBRATION_HEADROOM_DB for why the kit render needs this.
  engine.setMasterVolume(dbToGain(toDecibels(-headroomDb)));
  return { engine, ctx };
}

async function renderToWav(ctx: any): Promise<Uint8Array> {
  const buffer = await ctx.startRendering();
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  // The shared encoder returns a Blob; the harness writes bytes to a file, so
  // it adapts here rather than keeping a second implementation of the format.
  return new Uint8Array(await encodeWav(channels, CALIBRATION_SAMPLE_RATE).arrayBuffer());
}

/**
 * One render per KIT, playing `DRUM_KIT_BAR` twice through (DEV-387: drum trims
 * are per kit, not per voice — see the comment on `DRUM_TRIMS` in
 * src/data/trimTable.ts).
 *
 * `applyTrim` routes through the engine's OWN trim path — `setDrumKit`'s kit-name
 * argument — rather than folding a gain into velocity. That seam is the ONLY
 * thing that makes a render calibrated: `triggerDrum` runs `clampVelocity`, which
 * caps at 1, so a caller multiplying a boost into velocity would silently lose it
 * and measure the untrimmed kit believing otherwise. Withholding the name is what
 * makes a render uncalibrated, since `setDrumKit` resolves trims from the name and
 * an unnamed kit resolves to none.
 *
 * The generator renders with `applyTrim` false (uncalibrated, which is what a trim
 * is computed FROM); `verifyApplied.smoke.ts` renders with it true, to prove the
 * applied result lands inside the tolerance band.
 */
export async function renderDrumKit(kitName: string, applyTrim = false): Promise<Uint8Array> {
  const kit = DRUM_KITS[kitName];
  if (!kit) throw new Error(`No such drum kit: ${kitName}`);
  return withSeededRandom(CALIBRATION_SEED, async () => {
    // Same headroom whether or not the trim is applied — the trimmed path peaks
    // even hotter (Tight Pocket measured 2.02 pre-headroom), so applyTrim=true
    // needs the clamp-avoidance at least as much as the uncalibrated render.
    const { engine, ctx } = createHarness(DRUM_KIT_RENDER_SECONDS, CALIBRATION_HEADROOM_DB);
    engine.setDrumKit(kit, applyTrim ? kitName : undefined);
    for (let bar = 0; bar < DRUM_KIT_BAR_COUNT; bar += 1) {
      for (const hit of DRUM_KIT_BAR) {
        const at = DRUM_FIRST_HIT_S + (bar * DRUM_KIT_BEATS_PER_BAR + hit.beat) * DRUM_KIT_BEAT_S;
        engine.triggerDrum(hit.voice, CALIBRATION_VELOCITY, at);
      }
    }
    return renderToWav(ctx);
  });
}

/**
 * Resolves the trim gain caller-side, via `synthTrimGainFor(preset.name)` — the
 * same function production calls, so this is not a reimplementation, but it does
 * mean this function alone never proves the id ("PRESET_TRIMS` is keyed by preset
 * ID") -> name (what `synthTrimGainFor` is actually looked up by) bridge resolves
 * correctly end to end. `renderOffline.smoke.ts`'s preset-trim-bridge check covers
 * that, by mocking `@/data/trimTable` in a spawned child process (a fresh module
 * graph is required: `trims.ts` builds its name index once at import time).
 */
export async function renderPreset(preset: SynthPresetItem, applyTrim = false): Promise<Uint8Array> {
  const params = applyPreset(INITIAL_SYNTH_PARAMS, preset);
  return withSeededRandom(CALIBRATION_SEED, async () => {
    const { engine, ctx } = createHarness(SYNTH_RENDER_SECONDS);
    engine.setPresetTrim('calibration', applyTrim ? synthTrimGainFor(preset.name) : 1);
    for (let note = 0; note < SYNTH_NOTE_COUNT; note += 1) {
      const at = SYNTH_FIRST_NOTE_S + note * SYNTH_NOTE_INTERVAL_S;
      engine.triggerSynthNoteOn(SYNTH_CALIBRATION_NOTE, params, CALIBRATION_VELOCITY, at, 'calibration');
      engine.triggerSynthNoteOff(SYNTH_CALIBRATION_NOTE, params.release, at + SYNTH_NOTE_GATE_S, 'calibration');
    }
    return renderToWav(ctx);
  });
}

async function measureWav(bytes: Uint8Array, slug: string, label: string): Promise<Dbfs> {
  const dir = mkdtempSync(join(tmpdir(), 'solna-calibration-'));
  try {
    const wavPath = join(dir, `${slug}.wav`);
    writeFileSync(wavPath, bytes);
    // Awaited, not returned bare: ffmpeg reads the file asynchronously, and an
    // un-awaited return here would let `finally` delete the tmpdir (and the
    // WAV in it) before ffmpeg ever opens it — exactly the bug that shipped
    // in this function's first version, caught by every entry failing to
    // render with "ffmpeg exited 254" the first time this ran for real.
    return await measureLoudness(wavPath, label);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Renders `kitName`'s reference pattern, measures it, and returns the level the
 * kit ACTUALLY plays at. Every caller of `renderDrumKit` used to have to
 * remember to add `CALIBRATION_HEADROOM_DB` back to the raw measurement by
 * hand — Task 12 got this wrong on its first pass (every kit measured ~12 dB
 * low) and caught it only because the number was absurd; a subtler slip in the
 * same spot would have looked like a plausible measurement and gone straight
 * into the committed table. That compensation now lives HERE, once, so no
 * call site imports `CALIBRATION_HEADROOM_DB` or ever holds a raw attenuated
 * value — see that constant's comment for why the kit render needs headroom
 * at all (nine overlapping voices vs. the WAV encoder's +/-1.0 clamp).
 */
export async function measureDrumKit(kitName: string, applyTrim = false): Promise<Dbfs> {
  const wav = await renderDrumKit(kitName, applyTrim);
  const raw = await measureWav(wav, kitName.replace(/\W+/g, '-'), kitName);
  return toDbfs(raw + CALIBRATION_HEADROOM_DB);
}

/**
 * Same render+measure contract for a synth preset, with no compensation to
 * apply: `renderPreset` deliberately never attenuates. A preset plays ONE
 * voice at a time, not nine simultaneous ones, so it cannot stack the way the
 * kit reference pattern does. The hazard `CALIBRATION_HEADROOM_DB` exists for
 * is PEAK, not loudness, so the evidence for this asymmetry is a peak result,
 * not a loudness number: `verifyApplied.smoke.ts` renders `factory-cyber-drone`
 * — the largest boost in the committed table, +13.3 dB — WITH its trim applied
 * and measures no clipping. If a preset render ever needed headroom too, that
 * proof would fail before any number silently drifted. That asymmetry between
 * the two families is intentional and lives entirely inside these two
 * functions; a caller of either never needs to know it exists.
 */
export async function measurePreset(preset: SynthPresetItem, applyTrim = false): Promise<Dbfs> {
  const wav = await renderPreset(preset, applyTrim);
  return measureWav(wav, preset.id, preset.id);
}

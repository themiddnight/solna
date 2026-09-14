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
import { createRenderEngine, type AudioEngine } from '@/audio/engine';
import { withSeededRandom } from '@/audio/rng';
import { DRUM_KITS, type DrumType } from '@/data/drumKits';
import type { SynthPreset } from '@/data/synthPresets';
import type { ActiveSynth, EnginePatch } from '@/types/synth';
import { dbToGain, toDbfs, toDecibels, type Dbfs } from '@/utils/gainUnits';
import { encodeWav } from '@/utils/encodeWav';
import { measureLoudness } from './measureLoudness.ts';
import { CALIBRATION_SEED } from './seededRandom.ts';

export const CALIBRATION_SAMPLE_RATE = 44100;
const CALIBRATION_CHANNELS = 2;
/** Max velocity — the AC calibrates "at max velocity", not at DEFAULT_VELOCITY. */
const CALIBRATION_VELOCITY = 1;

/** Where the first hit of a render lands. Late enough that the engine's own
 *  first-node setup never truncates it, early enough that two bars of pattern
 *  still finish with tail inside DRUM_KIT_RENDER_SECONDS. */
const DRUM_FIRST_HIT_S = 0.25;

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
 * committed number materially depended on the clip — but the `verifyApplied`
 * check for Tight Pocket, which re-measures WITH the trim
 * applied (the loudest case, 2.02 peak), reads 0.34 dB low purely from clipping
 * without this fix. 12 dB comfortably clears the largest observed pre-headroom
 * peak (Retro Drive 1.55 => ~3.8 dB over) with margin for the trimmed path too.
 *
 * THE PRESET RENDER NEEDS IT TOO, and did not always. A preset used to be one
 * oscillator, a sub and a noise source on a flat shape whose calibration lived
 * outside it, so a single voice could not stack past full scale and this file
 * said so. An `EnginePatch` can: up to six unison voices, each with two
 * oscillators plus sub plus noise, and the uncalibrated pass neutralises
 * `common.outputGainDb` — which is precisely the field that would otherwise
 * hold it down. Warm PolyPad (four unison voices) rendered a clamped peak of
 * exactly 1.000 at 0 dB, i.e. clipped, the first time the neutralised pass ran.
 * So `renderPreset` takes the same headroom and `measurePreset` adds the same
 * number back, for the same reason and with the same exactness.
 *
 * 12 dB covers the APPLIED pass too, and that needed checking rather than
 * assuming: 26 of the library's 32 patches carry an attenuation, for which the
 * neutralised pass is the louder one, but six carry a boost (up to +10 dB on
 * Cyber Drone). Measured across all 32 at their committed gains, the highest
 * true pre-bus peak is 1.32 (Trance Pluck) and every other patch is under
 * 0.86 — so both passes clear the clamp with margin.
 */
export const CALIBRATION_HEADROOM_DB = 12;
/** 120 BPM. Fixed, not authored per kit: uniformity is what makes kit numbers
 *  comparable across the roster — one tempo for every kit, so a difference in
 *  the measured number is a difference in the kit and never in the pattern. */
const DRUM_KIT_BEAT_S = 0.5;
const DRUM_KIT_BAR_COUNT = 2;
const DRUM_KIT_BEATS_PER_BAR = 4;

interface DrumKitPatternHit {
  voice: DrumType;
  /** Offset from the start of the bar, in beats (quarter notes); 0.5 = an
   *  off-beat 8th note. */
  beat: number;
}

/** One bar of the backbeat: kick on 1 & 3, snare on 2 & 4, closed hihat on every
 *  8th note (the four on-beat hits plus the four off-beat 8ths). */
const DRUM_KIT_BAR: readonly DrumKitPatternHit[] = [
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

const SYNTH_FIRST_NOTE_S = 0.25;
const SYNTH_NOTE_COUNT = 4;

/**
 * The shortest note a preset is measured with. It used to be the ONLY note
 * length, fixed at 1.3 s with a comment reading "long enough that a pad with
 * attack up to ~1.0 s reaches sustain inside the gate" — a rule, stated on the
 * constant, that the re-authored library broke: Cyber Drone attacks over 1.6 s
 * and Noise Riser over 1.8, so a 1.3 s gate released both MID-ATTACK and
 * measured a level neither patch ever plays at. The first run of this pass read
 * Noise Riser at -36.1 dBFS and asked for +18.1 dB of correction, which is not
 * a quiet patch, it is an unmeasured one.
 *
 * `synthGateSeconds` below is that comment turned into the code: hold every
 * note until its own amp envelope has reached its sustain plateau, with this as
 * the floor so a short patch is measured exactly as it was before.
 */
const SYNTH_NOTE_GATE_FLOOR_S = 1.3;
/** Silence between the end of one gate and the start of the next note. */
const SYNTH_NOTE_SPACING_S = 0.2;
/** Tail after the last note's release, so nothing is truncated by the boundary. */
const SYNTH_RENDER_TAIL_S = 1;
/**
 * The shortest render, whatever the patch. `ebur128`'s short-term window is
 * 3 s and a median over too few frames is not a median, so a fast patch keeps
 * the 6.5 s render every committed number before this change was taken at.
 */
const SYNTH_RENDER_FLOOR_SECONDS = 6.5;

/**
 * How long ONE note is held for this patch.
 *
 * Per-patch rather than fixed, and that asymmetry with `DRUM_KIT_BAR` — which
 * is deliberately identical for every kit — is worth stating, because the two
 * look like the same decision and are not. A drum pattern is MUSIC the kit did
 * not write, so holding it constant is what makes two kits comparable. A note
 * length is not music; it is how long the key is down, and a patch whose
 * attack outlasts the gate is not being measured quietly, it is not being
 * measured at all. Holding every patch to its own sustain plateau is what
 * makes two PRESETS comparable — each is measured at the level it settles to.
 *
 * `attack + decay` is exactly where the plateau starts. Below the floor it is
 * the floor, so nothing shorter than the old fixed gate moves.
 *
 * It is a measurement rule only, and never was a workaround — it was briefly
 * recorded here as one, and that entry was WRONG in a way worth preserving as a
 * warning rather than deleting.
 *
 * The claim was that holding past the plateau kept the note-off clear of the
 * release defect (`releaseScheduledParamTo` used to let its own
 * `cancelScheduledValues` erase the ramp it interrupted), and that the patches
 * left exposed were the ones whose MOD envelope outlasted their amp envelope.
 * Both halves are false, and the second is exactly backwards. This function
 * returns `attack + decay` EXACTLY, the amp decay ramp ends at exactly that
 * time, and `cancelScheduledValues(at)` removes events at time **>= at**. So
 * the gate did not clear the ramp — it landed precisely ON it, and the amp
 * envelope of every patch reaching the floor was erased. Reading
 * `ampEnvelope` only is correct and stays; the tie was the whole mechanism.
 *
 * That rule predicts the damage exactly, which is why it is the one to believe:
 * 11 of the 32 presets have amp `attack + decay >= SYNTH_NOTE_GATE_FLOOR_S`,
 * and when the release was repaired precisely those 11 `measuredDbfs` entries
 * moved — zero misses, zero false positives. Glockenspiel (-5.3 dB) and Koto
 * (-4.4) were cited for the mod-envelope story and refute it outright: their
 * mod `attack + decay` are 0.501 s and 0.503 s against gates of 2.201 and
 * 1.603, far SHORTER than their amp envelopes, not longer.
 *
 * The defect is fixed at its source now and these numbers were regenerated on
 * the fix, so nothing here depends on the tie either way. It is recorded
 * because a boundary tie between a constant and a `>=` is invisible in both
 * files that create it, and because reasoning from the wrong cause is how the
 * gate rule nearly grew a mod-envelope term it does not need.
 */
function synthGateSeconds(patch: EnginePatch<'subtractive'>): number {
  const env = patch.synth.ampEnvelope;
  return Math.max(SYNTH_NOTE_GATE_FLOOR_S, env.attack + env.decay);
}

/** Gate plus spacing: where the next note starts. */
function synthNoteIntervalSeconds(patch: EnginePatch<'subtractive'>): number {
  return synthGateSeconds(patch) + SYNTH_NOTE_SPACING_S;
}

/** Long enough for four notes at this patch's own gate, plus its release tail. */
function synthRenderSeconds(patch: EnginePatch<'subtractive'>): number {
  const last = SYNTH_FIRST_NOTE_S + (SYNTH_NOTE_COUNT - 1) * synthNoteIntervalSeconds(patch);
  const end = last + synthGateSeconds(patch) + patch.synth.ampEnvelope.release + SYNTH_RENDER_TAIL_S;
  return Math.max(SYNTH_RENDER_FLOOR_SECONDS, end);
}
/** The patch's own oscillator tuning shifts this, exactly as a player hears it. */
const SYNTH_CALIBRATION_NOTE = 'C3';
/**
 * The bus a calibration render plays on. Any name works — the harness builds its
 * own engine and no bus fader is touched — but it must be ONE name, because
 * polyphony ducking is per bus and a render that spread its four notes over four
 * buses would measure a different level than one that did not.
 */
const CALIBRATION_SOURCE = 'calibration';
/**
 * Unity, as a dB. What `common.outputGainDb` is forced to for the uncalibrated
 * pass: a voice's peak is `velocityGain * dbToGain(outputGainDb) / sqrt(unison)`,
 * so 0 dB is the multiplier vanishing and the raw voicing being what is measured.
 */
const NEUTRAL_OUTPUT_GAIN_DB = 0;

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine's public surface
   is typed against the DOM's BaseAudioContext and node-web-audio-api implements the
   same spec with its own class objects, so the CONTEXT stays `any` at that seam; so
   do the send gain nodes the dry-only loop reaches, which are private the same way
   src/audio/testFakes.ts reaches engine internals. The ENGINE is not `any` any
   more — it used to be, and that cast silently swallowed the Task 10 voice-ID
   cutover: `triggerSynthNoteOn` grew two required arguments and
   `triggerSynthNoteOff` started taking a `VoiceId`, and this file went on passing
   the note NAME to a note-off that then matched nothing and released nothing. Four
   notes that never stop is not a small measurement error, and `bun run lint` covers
   scripts/calibration — so typing this field is what makes the compiler the thing
   that catches the next signature change. */

interface Harness {
  engine: AudioEngine;
  ctx: any;
}

function createHarness(seconds: number, headroomDb = 0): Harness {
  const ctx = new OfflineAudioContext(
    CALIBRATION_CHANNELS,
    Math.round(CALIBRATION_SAMPLE_RATE * seconds),
    CALIBRATION_SAMPLE_RATE,
  );
  const engine = createRenderEngine(ctx as unknown as BaseAudioContext);
  // Dry only. Zeroing the send gains is one line each and beats building a whole
  // neutral MasterEffects literal that would then need maintaining alongside the
  // real one. The `reverbSend` field is excluded from the config hash on the
  // strength of THIS loop actually zeroing `reverbGain` — a skipped, renamed or
  // unbuilt field must fail the render loudly, not silently leave a wet path in
  // the measurement while this comment keeps claiming it is dry.
  // One hop deeper than it used to be: the send gains moved onto `masterRack`
  // when the engine was split into subsystems, and this loop went on reading
  // `engine.reverbGain` and throwing — which is what the guard is FOR, and is
  // how the move was caught here rather than by a silently wet measurement.
  const rack = (engine as any).masterRack;
  for (const send of ['reverbGain', 'delayGain', 'distortionGain']) {
    const node = rack?.[send];
    if (!node) {
      throw new Error(
        `createHarness: masterRack.${send} is missing after setupMasterChain(). The ` +
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
 * Renders a preset by INSTALLING ITS PATCH — there is no trim lookup left on
 * either side of this call. `common.outputGainDb` travels inside the patch, so
 * the only difference between the two passes is which value that one field
 * carries: the authored one, or 0 dB.
 *
 * Neutralising it is what makes the uncalibrated pass measure the patch's raw
 * voicing, which is the number a calibration is computed FROM; an engine-side
 * override (the old `setPresetTrim(source, 1)`) could express the same thing
 * only because the gain used to live outside the patch. Rebuilding `common`
 * here rather than mutating `preset.patch` matters: `SYNTH_PRESETS` is a shared
 * module-level array, and a run that mutated it would leave every later render
 * in the same process measuring a library it had quietly edited.
 */
export async function renderPreset(preset: SynthPreset, applyOutputGain = false): Promise<Uint8Array> {
  // The preset's OWN complete patch. It used to be `applyPreset` over the
  // shared flat defaults, because an entry was a partial — so what a preset
  // measured as depended on a global. A complete library removes that variable
  // from the measurement entirely.
  const synth: ActiveSynth = {
    engine: preset.engine,
    patch: {
      ...preset.patch,
      common: {
        ...preset.patch.common,
        outputGainDb: applyOutputGain ? preset.patch.common.outputGainDb : NEUTRAL_OUTPUT_GAIN_DB,
      },
    },
    sourcePresetId: preset.id,
  };
  const release = preset.patch.synth.ampEnvelope.release;
  const gate = synthGateSeconds(preset.patch);
  const interval = synthNoteIntervalSeconds(preset.patch);
  return withSeededRandom(CALIBRATION_SEED, async () => {
    // Same headroom as the kit render, and for the same reason — see
    // CALIBRATION_HEADROOM_DB. `measurePreset` adds it straight back, and both
    // passes take it, so a peak RATIO between them is unaffected by it.
    const { engine, ctx } = createHarness(synthRenderSeconds(preset.patch), CALIBRATION_HEADROOM_DB);
    for (let note = 0; note < SYNTH_NOTE_COUNT; note += 1) {
      const at = SYNTH_FIRST_NOTE_S + note * interval;
      // The ID the engine hands back is the only thing that releases THIS
      // instance; the note name is not an address any more.
      const voiceId = engine.triggerSynthNoteOn(
        SYNTH_CALIBRATION_NOTE,
        synth,
        CALIBRATION_VELOCITY,
        at,
        CALIBRATION_SOURCE,
        1,
        'sequencer',
      );
      if (!voiceId) {
        throw new Error(
          `renderPreset(${preset.id}): triggerSynthNoteOn returned no voice id. The engine ` +
            'no-ops every setter before its context exists, so this means the harness ' +
            'context never bound — refusing to render four notes of silence.',
        );
      }
      engine.triggerSynthNoteOff(voiceId, release, at + gate);
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
 * Same render+measure contract for a synth preset, and — since the patch became
 * a complete `EnginePatch` — the same `CALIBRATION_HEADROOM_DB` compensation
 * the kit path takes. See that constant for why a single preset voice can now
 * stack past full scale when its own output gain is neutralised, and why
 * subtracting headroom before the render and adding it back after the
 * measurement recovers the true level exactly rather than approximately.
 *
 * It lives HERE, once, for the reason `measureDrumKit` records: a call site
 * that had to remember to add the number back got it wrong the first time, and
 * a subtler slip in the same place looks like a plausible measurement.
 *
 * `applyOutputGain` false is the pass a calibration is computed FROM: the patch
 * with `common.outputGainDb` neutralised, i.e. its raw voicing. True is the
 * patch exactly as a player hears it.
 */
export async function measurePreset(preset: SynthPreset, applyOutputGain = false): Promise<Dbfs> {
  const wav = await renderPreset(preset, applyOutputGain);
  const raw = await measureWav(wav, preset.id, preset.id);
  return toDbfs(raw + CALIBRATION_HEADROOM_DB);
}

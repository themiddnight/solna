/**
 * Resolving a Beat preset id into state. The catalogue itself is pure data
 * (`src/data/beatPresets.ts`, a leaf); everything that has to LOOK ONE UP lives
 * here, one layer above it, so the data file resolves nothing at module scope.
 *
 * Every function here hands back a fresh deep copy. Handing out the library
 * object would let the next knob edit write back into the factory table — the
 * same reason `applySynthPreset` clones.
 */
import { BEAT_PRESETS, BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '@/data/beatPresets';
import { MAX_STEPS_PER_BAR } from '@/utils/timeSignature';
import { DEFAULT_BUS_TRIM_DB, DEFAULT_FADER_DB } from './levelUnits';
import type {
  BeatMix,
  BeatParams,
  BeatPatch,
  BeatPattern,
  BeatVoiceId,
  BeatVoiceMix,
  FactoryBeatPreset,
} from '@/types';

/** Built once: a preset is resolved on every loop install and every reset. */
const BY_ID = new Map<string, FactoryBeatPreset>(
  BEAT_PRESETS.map((preset) => [preset.id, preset]),
);

export function beatPresetById(id: string): FactoryBeatPreset | undefined {
  return BY_ID.get(id);
}

/**
 * A complete `BeatParams` for `id`, falling back to the default preset when
 * nothing claims it. The fallback records the id it ACTUALLY resolved, never
 * the one that was asked for: a `basePresetId` naming a preset that does not
 * exist would make `Edited` and Reset All unanswerable.
 *
 * Note this is the preset path, where falling back is right because there is no
 * stored patch to keep. A STORED patch whose base cannot be resolved keeps its
 * own values and takes `basePresetId: null` instead — that is the sanitizer's
 * job, not this function's.
 */
/**
 * The `BeatPatch` half of a `BeatParams` — the sound, without the provenance.
 *
 * Field by field rather than a rest-spread: `BeatPatch` is exactly these three,
 * so a fourth one fails to compile HERE instead of being silently carried (or
 * silently dropped) by a spread, and `basePresetId` is dropped by not being
 * written. One function rather than three copies of the literal, because the
 * third caller (`isBeatPatchEdited`) feeds the result to `JSON.stringify` and
 * compares it against a preset's own `patch` — so its correctness depends on
 * key ORDER matching the other two constructions, a property no test asserts
 * and that a shared builder makes unrepresentable.
 */
export function beatPatchOf(params: BeatParams): BeatPatch {
  return {
    outputTrimDb: params.outputTrimDb,
    filter: params.filter,
    voices: params.voices,
  };
}

export function beatParamsFromPreset(id: string): BeatParams {
  const preset = beatPresetById(id) ?? beatPresetById(DEFAULT_BEAT_PRESET_ID)!;
  return structuredClone({ basePresetId: preset.id, ...preset.patch });
}

/** Silent rows at the widest meter's bar width, so a meter change only narrows
 *  the window a view can reach and never truncates what is stored. */
function emptyBeatPattern(): BeatPattern {
  const rows = {} as Record<BeatVoiceId, boolean[]>;
  for (const voice of BEAT_VOICE_IDS) rows[voice] = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
  return { rows };
}

/**
 * The beat a NEW project opens on, as STEP INDEXES rather than a row of 24
 * booleans — a four-on-the-floor kick under backbeat snare and clap, straight
 * eighths on the closed hat and one open hat lifting into beat four.
 *
 * It is carried over verbatim from `INITIAL_SEQUENCER_TRACKS`, the table this
 * model replaced, because it is shipped behaviour and not a new decision: an
 * empty grid on a fresh project means the first thing a new user hears after
 * pressing play is nothing at all. `beatPresets.test.ts` pins the indexes, so
 * a change to them is a change somebody chose.
 *
 * Indexes are into the STORED row, which is `MAX_STEPS_PER_BAR` wide: every
 * one of them is inside a 4/4 bar's sixteen, so the starter beat is fully
 * audible at the default meter and simply repeats sooner at a narrower one.
 */
const STARTER_BEAT_ONSETS: Partial<Record<BeatVoiceId, readonly number[]>> = {
  kick: [0, 4, 8, 12],
  snare: [4, 12],
  clap: [4, 12],
  hihat: [0, 2, 4, 6, 8, 10, 12, 14],
  openhat: [10],
};

function starterBeatPattern(): BeatPattern {
  const { rows } = emptyBeatPattern();
  for (const voice of BEAT_VOICE_IDS) {
    for (const step of STARTER_BEAT_ONSETS[voice] ?? []) rows[voice][step] = true;
  }
  return { rows };
}

/**
 * Unity PER-VOICE faders, nothing muted: a fresh Beat is audible exactly as
 * voiced. The BUS sits at `DEFAULT_BUS_TRIM_DB` (−6 dB), not unity — the same
 * headroom every source bus starts with, so the eleven voices summing into it
 * leave the limiter something to work with.
 */
function defaultBeatMix(): BeatMix {
  const voices = {} as Record<BeatVoiceId, BeatVoiceMix>;
  for (const voice of BEAT_VOICE_IDS) voices[voice] = { levelDb: DEFAULT_FADER_DB, muted: false };
  return { levelDb: DEFAULT_BUS_TRIM_DB, muted: false, voices };
}

/**
 * The three sibling fields a loop starts with. One function rather than three
 * constants because every call must own its own arrays — a shared row object
 * would make a step drawn in one loop appear in every other one.
 */
export function defaultBeatState(): { beatParams: BeatParams; beatPattern: BeatPattern; beatMix: BeatMix } {
  return {
    beatParams: beatParamsFromPreset(DEFAULT_BEAT_PRESET_ID),
    beatPattern: starterBeatPattern(),
    beatMix: defaultBeatMix(),
  };
}

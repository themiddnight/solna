/**
 * Backend-side mirror of the frontend's `resetLegacyLoudnessFields`
 * (`app/frontend/src/features/rooms/arrange/services/legacyLoudnessReset.ts`) — resets the same
 * four loudness fields a legacy (pre-epic, pre-`PROJECT_SCHEMA_VERSION`) project file may carry
 * in units this build no longer understands (linear gain, percent volume, a linear vocoder
 * multiplier), but against the backend's `ProjectData` types (`Track`, `Region`,
 * `EffectChainState`, and `synthStates`' generic `Record<string, unknown>` shape) instead of the
 * frontend's `SerializedProject`.
 *
 * WHY THIS EXISTS (DEV-295 final-review fix wave): Task 5 relaxed the backend's version gate
 * (`ProjectImportService.ts`) from strict-equality refusal to future-only refusal on the premise
 * that "nothing reads these loudness values without passing through the FE's
 * `deserializeProject` first" (plan Decision 4). That premise was false for the import/save
 * write path — the backend writes `projectData` verbatim into Redis, and a later backend-driven
 * save re-stamps the CURRENT `PROJECT_SCHEMA_VERSION` onto those un-reset values, permanently
 * laundering legacy-unit numbers as current-schema. This function runs at the import boundary
 * (`ProjectImportService.ts`, gated on `needsLegacyLoudnessReset(projectData.version)`) BEFORE
 * `arrangeRoomStateService.updateState(...)` is called, closing that write-path gap directly.
 *
 * Pure: never mutates `projectData`, always returns a new object. Does not deep-clone or drop
 * unmodeled/unknown keys — a legacy file may carry fields this build doesn't model, and they
 * must survive the round trip untouched. See DEV-295 plan for the full inventory of what is and
 * isn't in scope — deliberately only these four fields; everything else must round-trip
 * byte-identical (pan, isMuted, AudioRegion.gain, compressor/ducker/autowah/graphiceq other
 * parameters, muteCarrierInMix, instrumentParamsStates).
 */
import { DEFAULT_COMPANION_VOLUME_DB, DEFAULT_VOCODER_OUTPUT_GAIN_DB, DEFAULT_SYNTH_GAIN_DB } from '@jam-band/shared';
import { toDecibels, UNITY_DB } from '../models/ArrangeRoomState';
import type { EffectChainState, Region, Track } from '../models/ArrangeRoomState';
import type { ProjectData } from '../models/ProjectData';

/** Effect types whose "Output gain" parameter used to be a linear 1-12x multiplier (DEV-309). */
const VOCODER_EFFECT_TYPES: ReadonlySet<string> = new Set(['vocoder', 'vocoderext']);

const VOCODER_OUTPUT_GAIN_PARAM_NAME = 'Output gain';

function resetTrackVolume(track: Track): Track {
  return { ...track, volume: UNITY_DB };
}

/**
 * Covers both places a companion `config.volume` can live: a *live* companion region's `config`,
 * and the `companionMetadata.config` snapshot a converted `MidiRegion` carries. The snapshot is
 * not inert history — reverting the region restores it verbatim as live config, and duplicating
 * the region re-emits it on `region_add`, where a legacy percent value (0..100) fails the shared
 * `volume: -60..12` bound and the server drops the region. No other field of either `config` is
 * in scope (notably `config.isMuted`, which must survive untouched).
 */
function resetRegion(region: Region): Region {
  if (region.type === 'companion') {
    return {
      ...region,
      config: { ...region.config, volume: toDecibels(DEFAULT_COMPANION_VOLUME_DB) },
    };
  }
  if (region.type === 'midi' && region.companionMetadata) {
    return {
      ...region,
      companionMetadata: {
        ...region.companionMetadata,
        config: {
          ...region.companionMetadata.config,
          volume: toDecibels(DEFAULT_COMPANION_VOLUME_DB),
        },
      },
    };
  }
  return region;
}

/**
 * Scoped to `type === 'vocoder' | 'vocoderext'` AND `parameter.name === 'Output gain'` — matching
 * on name alone would corrupt an unrelated effect that happens to reuse the same parameter name.
 */
function resetEffectChain(chain: EffectChainState): EffectChainState {
  return {
    ...chain,
    effects: chain.effects.map((effect) => {
      if (!VOCODER_EFFECT_TYPES.has(effect.type)) {
        return effect;
      }
      return {
        ...effect,
        parameters: effect.parameters.map((parameter) =>
          parameter.name === VOCODER_OUTPUT_GAIN_PARAM_NAME
            ? { ...parameter, value: DEFAULT_VOCODER_OUTPUT_GAIN_DB }
            : parameter,
        ),
      };
    }),
  };
}

function resetEffectChains(effectChains: Record<string, EffectChainState>): Record<string, EffectChainState> {
  const reset: Record<string, EffectChainState> = {};
  for (const [key, chain] of Object.entries(effectChains)) {
    reset[key] = resetEffectChain(chain);
  }
  return reset;
}

/**
 * `synthStates` is a generic `Record<string, unknown>` per-track blob (no shared shape with the
 * FE's typed `SynthState`) — spreading it and overwriting `volume` stays within
 * `Record<string, unknown>` (assigning a `number` to a `volume` key of type `unknown` is always
 * valid), so no narrowing/casting is needed to reach it (TR-27).
 */
function resetSynthStates(
  synthStates: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const reset: Record<string, Record<string, unknown>> = {};
  for (const [key, state] of Object.entries(synthStates)) {
    reset[key] = { ...state, volume: DEFAULT_SYNTH_GAIN_DB };
  }
  return reset;
}

export function resetLegacyLoudnessFields(projectData: ProjectData): ProjectData {
  return {
    ...projectData,
    tracks: projectData.tracks.map(resetTrackVolume),
    regions: projectData.regions.map(resetRegion),
    effectChains: resetEffectChains(projectData.effectChains),
    synthStates: resetSynthStates(projectData.synthStates),
  };
}

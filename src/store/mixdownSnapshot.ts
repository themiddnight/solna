/**
 * The arrangement snapshot every export kind renders from.
 * Takes the state as an argument, like `playbackPlanSnapshots.ts` (R233).
 */
import type { MixdownBusState, MixdownLoop, MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import type { TrackSends } from '@/types';
import { getMeter } from '@/utils/timeSignature';
import { buildProjectContent, type ProjectContent } from './projectFormat';
import { faderDbToGain } from './levelUnits';
import { SOURCE_BUSES, type SourceBusLevels } from './sourceBuses';
import type { AppStore } from './types';

/** One linear row per source bus — for the song-level mixer and for each loop's own. */
function busRows(mixer: SourceBusLevels & { trackSends: TrackSends }): MixdownBusState[] {
  return SOURCE_BUSES.map((bus) => ({
    source: bus.source,
    gain: faderDbToGain(bus.selectLevelDb(mixer)),
    muted: bus.selectMuted(mixer),
    sends: mixer.trackSends[bus.source],
  }));
}

/**
 * The snapshot the renderer works from: the `.solna` CONTENT set plus the mix
 * and bus fields a project body deliberately excludes.
 *
 * Built from `buildProjectContent` rather than from raw state on purpose —
 * "what is exported" and "what is saved" are then the same idea of the song,
 * and a field added to a project body reaches the export without a second
 * edit here. The one addition is each loop's source-bus mixer, converted at
 * this store→audio boundary so song export follows the same per-loop mixer as
 * live arrangement playback.
 *
 * The dB→linear conversion happens HERE, once, and it goes through
 * `faderDbToGain` — the same boundary `engineSync.ts` crosses — so the bottom
 * of a fader is an exact 0 and a bus a user pulled all the way down exports
 * nothing.
 */
export function buildMixdownSnapshot(s: AppStore): MixdownSnapshot {
  // The raw mute flag, NOT isTrackAudible: solo is a session-only monitoring
  // gesture and must never reach the export, while mute is arrangement intent
  // and must.
  return buildMixdownSnapshotFromContent(buildProjectContent(s), busRows(s));
}

/**
 * The same snapshot from a project's CONTENT alone, for a caller that holds a
 * file rather than the store (the interop reader, `src/interop/`).
 *
 * `buses` is the song-level mixer, which is session state and not part of a
 * project body: the live export passes the store's rows, and a caller that
 * only walks the timeline passes `[]` — the walk never reads them.
 */
export function buildMixdownSnapshotFromContent(content: ProjectContent, buses: MixdownBusState[]): MixdownSnapshot {
  const loops: MixdownLoop[] = content.loops.map((loop) => ({
    ...loop,
    buses: busRows(loop),
    // One row per voice, in canonical order, with the voice's MUTE folded into
    // its gain — `muted ? 0 : faderDbToGain(levelDb)` is the same one-line rule
    // `engineSync.ts` applies live, written here because src/audio/ may not
    // read the store and so may not convert dB. The raw `beatMix` travels
    // beside it for the scheduling half of that same mute (see `MixdownLoop`).
    beatVoiceGains: BEAT_VOICE_IDS.map((voice) => {
      const { levelDb, muted } = loop.beatMix.voices[voice];
      return { voice, gain: muted ? 0 : faderDbToGain(levelDb) };
    }),
  }));

  return {
    bpm: content.bpm,
    meterId: content.meterId,
    stepsPerBar: getMeter(content.meterId).stepsPerBar,
    masterVolume: faderDbToGain(content.masterVolume),
    effects: content.effects,
    buses,
    // No arrangement-wide Beat: it belongs to a loop, and every loop row above
    // carries its own.
    loops,
  };
}

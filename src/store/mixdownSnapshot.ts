/**
 * The arrangement snapshot every export kind renders from.
 * Takes the state as an argument, like `playbackPlanSnapshots.ts` (R233).
 */
import type { MixdownLoop, MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { getMeter } from '@/utils/timeSignature';
import { buildProjectContent } from './projectFormat';
import { faderDbToGain } from './levelUnits';
import { SOURCE_BUSES } from './sourceBuses';
import type { AppStore } from './types';

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
  const content = buildProjectContent(s);
  const loops: MixdownLoop[] = content.loops.map((loop) => ({
    ...loop,
    buses: SOURCE_BUSES.map((bus) => ({
      source: bus.source,
      gain: faderDbToGain(bus.selectLevelDb(loop)),
      muted: bus.selectMuted(loop),
      sends: loop.trackSends[bus.source],
    })),
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
    // The raw mute flag, NOT isTrackAudible: solo is a session-only monitoring
    // gesture and must never reach the export, while mute is arrangement intent
    // and must.
    buses: SOURCE_BUSES.map((bus) => ({
      source: bus.source,
      gain: faderDbToGain(bus.selectLevelDb(s)),
      muted: bus.selectMuted(s),
      sends: s.trackSends[bus.source],
    })),
    // No arrangement-wide Beat: it belongs to a loop, and every loop row above
    // carries its own.
    loops,
  };
}

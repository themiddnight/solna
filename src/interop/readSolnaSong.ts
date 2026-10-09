/**
 * Reads a `.solna` file into the resolved song of `contract.ts`.
 *
 * Nothing here re-derives music: the file goes through the app's own
 * validator (`parseProjectFile`), the same snapshot the exports render from
 * (`buildMixdownSnapshotFromContent`) and the same pure walk the WAV and MIDI
 * exports perform (`buildSongTimeline`). This module only regroups that
 * timeline — by loop, by part, by pass — and converts seconds to beats.
 */
import { GM_DRUM_NOTE } from '@/audio/export/renderMidi';
import { songTrackVoice, type MixdownLoop } from '@/audio/playback/plan/songSnapshot';
import { buildSongTimeline, type SongTrack, type TimelineEvent } from '@/audio/playback/plan/songTimeline';
import { MIXDOWN_SEED, getRandomSource, mulberry32, setRandomSource } from '@/audio/rng';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { SCALES } from '@/data/scales';
import { chordSymbol, noteMidi } from '@/musicCore';
import { buildMixdownSnapshotFromContent } from '@/store/mixdownSnapshot';
import { parseProjectFile } from '@/store/projectFile';
import type { ProjectBody } from '@/store/projectFormat';
import { SOURCE_BUSES } from '@/store/sourceBuses';
import type { Loop } from '@/store/types';
import type { BeatVoiceId } from '@/types';
import {
  SOLNA_INTEROP_CONTRACT_VERSION,
  type SolnaDrumHit,
  type SolnaDrumVoice,
  type SolnaNote,
  type SolnaReadResult,
  type SolnaSong,
  type SolnaSongLoop,
  type SolnaSynthPart,
  type SolnaWarning,
} from './contract';

/** A 16th step is a quarter of a quarter-note beat, in every meter. */
const STEPS_PER_BEAT = 4;
const FALLBACK_SCALE_NAME = 'major';

/** The synth tracks in the mixer's display order. */
const SYNTH_TRACKS: ReadonlyArray<{ id: SongTrack; label: string }> = [
  { id: 'lead', label: 'Lead' },
  { id: 'fx', label: 'FX' },
  { id: 'chord', label: 'Chord' },
  { id: 'bass', label: 'Bass' },
  { id: 'pad', label: 'Pad' },
];

const DRUM_VOICE_LABELS: Record<BeatVoiceId, string> = {
  kick: 'Kick',
  snare: 'Snare',
  rimshot: 'Rim Shot',
  clap: 'Clap',
  hihat: 'Hi-Hat',
  openhat: 'Open Hat',
  hitom: 'Hi Tom',
  lowtom: 'Low Tom',
  ride: 'Ride',
  crash: 'Crash',
  bell: 'Bell',
};

export const SOLNA_DRUM_VOICES: SolnaDrumVoice[] = BEAT_VOICE_IDS.map((id) => ({
  id,
  label: DRUM_VOICE_LABELS[id],
  gmNote: GM_DRUM_NOTE[id],
}));

/** Float noise from the seconds→beats conversion ends here; a 1/32 triplet is still exact. */
const roundBeat = (beat: number): number => Math.round(beat * 1e6) / 1e6;

/**
 * The walk under the exports' own seed, so a random arp reads the same twice.
 * Synchronous on purpose (`withSeededRandom` is async): the previous source is
 * put back on every exit path.
 */
function seededTimeline(snapshot: Parameters<typeof buildSongTimeline>[0]): ReturnType<typeof buildSongTimeline> {
  const previous = getRandomSource();
  setRandomSource(mulberry32(MIXDOWN_SEED));
  try {
    return buildSongTimeline(snapshot);
  } finally {
    setRandomSource(previous);
  }
}

function meterOf(id: string, stepsPerBar: number): SolnaSong['meter'] {
  const [numerator, denominator] = id.split('/').map(Number);
  return { id, numerator, denominator, beatsPerBar: stepsPerBar / STEPS_PER_BEAT };
}

interface LoopSpan {
  startBeat: number;
  passBeats: number;
  repeatCount: number;
}

/** Which pass an event at `beat` belongs to, and where it sits inside that pass. */
function placeInPass(span: LoopSpan, beat: number): { passIndex: number; startBeat: number } {
  const relative = beat - span.startBeat;
  const passIndex = Math.min(span.repeatCount - 1, Math.max(0, Math.floor((relative + 1e-9) / span.passBeats)));
  return { passIndex, startBeat: roundBeat(Math.max(0, relative - passIndex * span.passBeats)) };
}

function emptyPasses<T>(repeatCount: number): T[][] {
  return Array.from({ length: repeatCount }, () => [] as T[]);
}

function synthPart(loop: MixdownLoop, content: Loop, track: SongTrack, repeatCount: number): SolnaSynthPart {
  const { params, source } = songTrackVoice(loop, track);
  const bus = SOURCE_BUSES.find((row) => row.source === source);
  return {
    muted: bus ? bus.selectMuted(content) : false,
    volumeDb: bus ? bus.selectLevelDb(content) : 0,
    patch: params.patch,
    passes: emptyPasses<SolnaNote>(repeatCount),
  };
}

function loopChords(content: Loop, beatsPerBar: number): SolnaSongLoop['chords'] {
  const chords: SolnaSongLoop['chords'] = [];
  let startBeat = 0;
  for (const chord of content.chords) {
    const durationBeats = Math.max(1, chord.bars || 1) * beatsPerBar;
    chords.push({ startBeat, durationBeats, symbol: chordSymbol(chord.root, chord.quality) ?? chord.root });
    startBeat += durationBeats;
  }
  return chords;
}

function loopKey(content: Loop, index: number, warnings: SolnaWarning[]): SolnaSongLoop['key'] {
  const scale = SCALES[content.scaleType];
  if (!scale) {
    warnings.push({
      code: 'unknown-scale',
      loopIndex: index,
      detail: `Scale "${content.scaleType}" is not in the scale table; read as ${FALLBACK_SCALE_NAME}.`,
    });
  }
  return { root: content.scaleRoot, scaleName: scale?.tonal ?? FALLBACK_SCALE_NAME };
}

function addEvent(loop: SolnaSongLoop, event: TimelineEvent, bpm: number): void {
  const toBeat = (sec: number): number => (sec * bpm) / 60;
  if (event.kind === 'drum') {
    const { passIndex, startBeat } = placeInPass(loop, toBeat(event.timeSec));
    const hit: SolnaDrumHit = { voiceId: event.voice, startBeat, velocity: event.velocity };
    loop.beat.passes[passIndex].push(hit);
    return;
  }
  const midi = noteMidi(event.noteName);
  // The MIDI export drops the same notes: nothing can be written for a pitch outside 0..127.
  if (midi === null || midi < 0 || midi > 127) return;
  const { passIndex, startBeat } = placeInPass(loop, toBeat(event.startSec));
  loop.synths[event.track].passes[passIndex].push({
    midi,
    startBeat,
    durationBeats: roundBeat(roundBeat(toBeat(event.endSec)) - roundBeat(toBeat(event.startSec))),
    velocity: event.velocity,
  });
}

function buildSong(body: ProjectBody, fileFormatVersion: number, warnings: SolnaWarning[]): SolnaSong {
  const { content } = body;
  // Song-level buses are session mix state, not project content, and the walk never reads them.
  const snapshot = buildMixdownSnapshotFromContent(content, []);
  const timeline = seededTimeline(snapshot);
  const meter = meterOf(snapshot.meterId, snapshot.stepsPerBar);

  const loops: SolnaSongLoop[] = timeline.passes.map((pass) => {
    const loop = snapshot.loops[pass.loopIndex];
    const loopContent = content.loops[pass.loopIndex];
    const repeatCount = Math.max(1, Math.round(pass.dwellSteps / pass.passSteps));
    return {
      index: pass.loopIndex,
      name: loopContent.name || loopContent.tempName,
      startBeat: pass.startStep / STEPS_PER_BEAT,
      passBeats: pass.passSteps / STEPS_PER_BEAT,
      repeatCount,
      key: loopKey(loopContent, pass.loopIndex, warnings),
      chords: loopChords(loopContent, meter.beatsPerBar),
      synths: Object.fromEntries(
        SYNTH_TRACKS.map(({ id }) => [id, synthPart(loop, loopContent, id, repeatCount)]),
      ),
      beat: {
        muted: loopContent.beatMix.muted,
        volumeDb: loopContent.beatMix.levelDb,
        passes: emptyPasses<SolnaDrumHit>(repeatCount),
      },
    };
  });

  for (const event of timeline.events) addEvent(loops[event.loopIndex], event, snapshot.bpm);

  return {
    contractVersion: SOLNA_INTEROP_CONTRACT_VERSION,
    formatVersion: fileFormatVersion,
    name: body.name,
    bpm: content.bpm,
    meter,
    masterVolumeDb: content.masterVolume,
    synthTracks: SYNTH_TRACKS.map(({ id, label }) => ({ id, label })),
    drumVoices: SOLNA_DRUM_VOICES,
    loops,
  };
}

/** The `formatVersion` a file carries. Only called after `parseProjectFile` accepted or version-refused it. */
function fileFormatVersion(text: string): number {
  return (JSON.parse(text) as { formatVersion: number }).formatVersion;
}

/**
 * A `.solna` file's text as a resolved song. Never throws: a file the app
 * would refuse to open is refused here the same way, and a newer file is
 * refused with its version rather than read on a guess.
 */
export function readSolnaSong(text: string): SolnaReadResult {
  const parsed = parseProjectFile(text);
  if (!parsed.ok) {
    return parsed.error === 'newer-version'
      ? { ok: false, reason: 'newer-version', formatVersion: fileFormatVersion(text) }
      : { ok: false, reason: 'malformed' };
  }
  const warnings: SolnaWarning[] = parsed.warnings.map((detail) => ({ code: 'file-warning', detail }));
  try {
    return { ok: true, song: buildSong(parsed.body, fileFormatVersion(text), warnings), warnings };
  } catch {
    // Sanitised content should always walk; a body that does not is not one this build can read.
    return { ok: false, reason: 'malformed' };
  }
}

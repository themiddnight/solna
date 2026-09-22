/**
 * The MIDI export: lane/drum/meter tables, the pure mappers that turn a
 * timeline event into a `MidiNote`, and `renderMidi`, the seeded walk that
 * writes the whole song as a Standard MIDI File.
 *
 * Built from the song timeline only (R296): nothing here re-derives an arp, a
 * chord rhythm, a strum or a hold — `walkSongTimeline` (`../playback/plan/songTimeline`)
 * already resolved every note and drum hit, and this file only converts that
 * resolved event into MIDI's units (ticks, a 0..127 velocity, a channel and a
 * note number). It imports only TYPES from `./renderMixdown` (never a value —
 * that file pulls in `createRenderEngine` — and never the engine module
 * itself, directly or otherwise): the MIDI export must run where
 * `OfflineAudioContext` does not exist.
 */
import {
  planArrangement,
  walkSongTimeline,
  type ArrangementPlan,
  type SongTrack,
  type TimelineEvent,
} from '../playback/plan/songTimeline';
import { songTrackVoice, type MixdownSnapshot } from '../playback/plan/songSnapshot';
import { MIXDOWN_SEED, withSeededRandom, yieldPreservingRandomStream } from '../rng';
import { encodeSmf, type SmfEvent, type SmfFile, type SmfTrack } from './smfWriter';
import type { MixdownFailureReason, MixdownProgressReporter } from './renderMixdown';
import { noteMidi } from '@/musicCore';
import type { BeatVoiceId } from '@/types';
import type { MeterId } from '@/utils/timeSignature';

export const MIDI_PPQ = 480;

// GM channel 10, zero-based on the wire.
const GM_DRUM_CHANNEL = 9;

export type MidiLane = SongTrack | 'beat';

/** Track order, track name and wire channel (§6); every `SongTrack` plus `'beat'`, once each. */
export const MIDI_LANES: readonly { lane: MidiLane; name: string; channel: number }[] = [
  { lane: 'chord', name: 'Chord', channel: 0 },
  { lane: 'bass', name: 'Bass', channel: 1 },
  { lane: 'pad', name: 'Pad', channel: 2 },
  { lane: 'lead', name: 'Lead', channel: 3 },
  { lane: 'fx', name: 'FX', channel: 4 },
  { lane: 'beat', name: 'Beat', channel: GM_DRUM_CHANNEL },
];

/** GM percussion key note per Beat voice (§6); `bell` is Cowbell 56, not Ride Bell (F16). */
export const GM_DRUM_NOTE: Readonly<Record<BeatVoiceId, number>> = {
  kick: 36,
  snare: 38,
  rimshot: 37,
  clap: 39,
  hihat: 42,
  openhat: 46,
  hitom: 48,
  lowtom: 45,
  ride: 51,
  crash: 49,
  bell: 56,
};

/** `FF 58` fields per meter (§5.2); no meter string is parsed. */
export const MIDI_TIME_SIGNATURE: Readonly<
  Record<MeterId, { numerator: number; denominatorPow2: number; clocksPerClick: number }>
> = {
  '4/4': { numerator: 4, denominatorPow2: 2, clocksPerClick: 24 },
  '3/4': { numerator: 3, denominatorPow2: 2, clocksPerClick: 24 },
  '5/4': { numerator: 5, denominatorPow2: 2, clocksPerClick: 24 },
  '6/8': { numerator: 6, denominatorPow2: 3, clocksPerClick: 36 },
  '12/8': { numerator: 12, denominatorPow2: 3, clocksPerClick: 36 },
  '7/8': { numerator: 7, denominatorPow2: 3, clocksPerClick: 12 },
};

export interface MidiNote {
  lane: MidiLane;
  channel: number;
  note: number;
  velocity: number;
  startTick: number;
  endTick: number;
}

/** `Math.round(sec * bpm / 60 * MIDI_PPQ)` — a 16th is 120 ticks, a 1/32 is 60. */
export function secondsToTicks(sec: number, bpm: number): number {
  return Math.round(((sec * bpm) / 60) * MIDI_PPQ);
}

/** Linear 0..1 → 1..127; `v <= 0` drops the note (silent in the WAV, §5.3). */
export function midiVelocity(v: number): number | null {
  if (v <= 0) return null;
  return Math.min(127, Math.max(1, Math.round(v * 127)));
}

/**
 * A timeline event is exported iff the WAV would make it audible by routing
 * (§7): the loop's own bus row for the event's source, never the song-level
 * `snapshot.buses` (F9). A drum additionally needs its `beatVoiceGains` entry
 * to be above zero (per-voice mute folded into it).
 */
export function eventAudible(snapshot: MixdownSnapshot, e: TimelineEvent): boolean {
  const loop = snapshot.loops[e.loopIndex];
  const source = e.kind === 'note' ? songTrackVoice(loop, e.track).source : 'sequencer';
  const row = loop.buses.find((b) => b.source === source);
  const busAudible = !row || (!row.muted && row.gain > 0);
  if (!busAudible) return false;
  if (e.kind === 'drum') {
    const voiceGain = loop.beatVoiceGains.find((g) => g.voice === e.voice)?.gain ?? 1;
    return voiceGain > 0;
  }
  return true;
}

/**
 * No channel ever sounds two instances of one pitch (§5.3): grouped by
 * `(channel, note)`, sorted by `startTick` (stable); a same-tick duplicate
 * merges into the kept note (`velocity` and `endTick` both take the max), and
 * a note starting before the kept one ends cuts the kept one's `endTick` at
 * the new start. Returns new objects in `(startTick, channel, note)` order;
 * the input array and its notes are never mutated.
 */
export function resolveNoteOverlaps(notes: MidiNote[]): MidiNote[] {
  const groups = new Map<string, MidiNote[]>();
  for (const note of notes) {
    const key = `${note.channel}:${note.note}`;
    const group = groups.get(key);
    if (group) group.push(note);
    else groups.set(key, [note]);
  }

  const result: MidiNote[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.startTick - b.startTick);
    let kept: MidiNote | null = null;
    for (const note of sorted) {
      if (kept && note.startTick === kept.startTick) {
        kept.velocity = Math.max(kept.velocity, note.velocity);
        kept.endTick = Math.max(kept.endTick, note.endTick);
        continue;
      }
      if (kept && note.startTick < kept.endTick) {
        kept.endTick = note.startTick;
      }
      kept = { ...note };
      result.push(kept);
    }
  }

  return result.sort(
    (a, b) => a.startTick - b.startTick || a.channel - b.channel || a.note - b.note,
  );
}

function metaText(type: number, text: string): SmfEvent {
  return { tick: 0, kind: 'meta', type, data: new TextEncoder().encode(text) };
}

/** 24-bit big-endian, for `FF 51 03` tempo. */
function u24(value: number): Uint8Array {
  return Uint8Array.from([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
}

function conductorTrack(snapshot: MixdownSnapshot, title: string, songEndTick: number): SmfTrack {
  const timeSignature = MIDI_TIME_SIGNATURE[snapshot.meterId];
  const microsPerQuarter = Math.round(60_000_000 / snapshot.bpm);
  const events: SmfEvent[] = [
    metaText(0x03, title),
    {
      tick: 0,
      kind: 'meta',
      type: 0x58,
      data: Uint8Array.from([
        timeSignature.numerator,
        timeSignature.denominatorPow2,
        timeSignature.clocksPerClick,
        8,
      ]),
    },
    { tick: 0, kind: 'meta', type: 0x51, data: u24(microsPerQuarter) },
  ];
  return { events, endTick: songEndTick };
}

function laneTrack(lane: (typeof MIDI_LANES)[number], notes: MidiNote[], songEndTick: number): SmfTrack {
  const events: SmfEvent[] = [metaText(0x03, lane.name)];
  let endTick = songEndTick;
  for (const note of notes) {
    if (note.lane !== lane.lane) continue;
    events.push({
      tick: note.startTick,
      kind: 'noteOn',
      channel: lane.channel,
      note: note.note,
      velocity: note.velocity,
    });
    events.push({ tick: note.endTick, kind: 'noteOff', channel: lane.channel, note: note.note });
    endTick = Math.max(endTick, note.endTick);
  }
  return { events, endTick };
}

/**
 * The whole song as an SMF format-1 file (§5): a conductor track (title, time
 * signature, tempo) plus all six lane tracks, always in `MIDI_LANES` order.
 * `notes` are taken as given — the caller has already resolved overlaps.
 */
export function songMidiFile(
  snapshot: MixdownSnapshot,
  notes: MidiNote[],
  title: string,
  plan: ArrangementPlan,
): SmfFile {
  const songEndTick = (plan.totalSteps * MIDI_PPQ) / 4;
  const tracks: SmfTrack[] = [
    conductorTrack(snapshot, title, songEndTick),
    ...MIDI_LANES.map((lane) => laneTrack(lane, notes, songEndTick)),
  ];
  return { ppq: MIDI_PPQ, tracks };
}

/**
 * Steps between progress reports, cooperative yields and abort checks — the
 * same cadence as the WAV renderer's scheduling walk.
 */
const MIDI_YIELD_INTERVAL_STEPS = 200;

type MidiRenderResult = { ok: true; blob: Blob } | { ok: false; reason: MixdownFailureReason };

const CANCELLED: MidiRenderResult = { ok: false, reason: { kind: 'cancelled' } };

/** One audible timeline event as a `MidiNote`, or `null` when it is dropped (§5.3, §8). */
function midiNoteFor(snapshot: MixdownSnapshot, e: TimelineEvent): MidiNote | null {
  if (!eventAudible(snapshot, e)) return null;
  const lane: MidiLane = e.kind === 'note' ? e.track : 'beat';
  const note = e.kind === 'note' ? noteMidi(e.noteName) : GM_DRUM_NOTE[e.voice];
  if (note === null || note < 0 || note > 127) return null;
  const velocity = midiVelocity(e.velocity);
  if (velocity === null) return null;
  const startTick = secondsToTicks(e.kind === 'note' ? e.startSec : e.timeSec, snapshot.bpm);
  const endTick =
    e.kind === 'note'
      ? Math.max(startTick + 1, secondsToTicks(e.endSec, snapshot.bpm))
      : startTick + MIDI_PPQ / 4;
  const channel = MIDI_LANES.find((entry) => entry.lane === lane)!.channel;
  return { lane, channel, note, velocity, startTick, endTick };
}

/**
 * Drains the song walk into `MidiNote`s, reporting, yielding and checking the
 * signal every `MIDI_YIELD_INTERVAL_STEPS` steps. Returns `null` when cancelled.
 */
async function collectMidiNotes(
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
  report: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<MidiNote[] | null> {
  const notes: MidiNote[] = [];
  for (const item of walkSongTimeline(snapshot, plan)) {
    if (item.kind === 'pass') continue;
    if (item.kind === 'stepEnd') {
      if ((item.step + 1) % MIDI_YIELD_INTERVAL_STEPS !== 0) continue;
      report({ phase: 'rendering', percent: Math.floor((100 * (item.step + 1)) / plan.totalSteps) });
      await yieldPreservingRandomStream();
      if (signal?.aborted) return null;
      continue;
    }
    const note = midiNoteFor(snapshot, item);
    if (note) notes.push(note);
  }
  return notes;
}

/**
 * The song as a Standard MIDI File (§8): the song timeline walked under
 * `MIXDOWN_SEED`, so two exports of one song are byte-identical. Never throws —
 * a failure is a `render-failed` result — and never touches an audio context.
 *
 * Arp `'random'` notes are deterministic per export but may differ from the
 * WAV's: the WAV interleaves engine draws (noise offsets, sample-and-hold
 * buffers) with the arp's on the same seeded stream, and the MIDI walk makes
 * only the arp's (spec §9 R2, ADR-0036).
 */
export async function renderMidi(
  snapshot: MixdownSnapshot,
  title: string,
  onProgress?: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<MidiRenderResult> {
  const report: MixdownProgressReporter = (progress) => {
    try {
      onProgress?.(progress);
    } catch {
      // A progress observer never fails the export.
    }
  };
  try {
    if (signal?.aborted) return CANCELLED;
    if (snapshot.loops.length === 0) return { ok: false, reason: { kind: 'empty-arrangement' } };
    report({ phase: 'preparing' });

    const plan = planArrangement(snapshot);
    const notes = await withSeededRandom(MIXDOWN_SEED, () => collectMidiNotes(snapshot, plan, report, signal));
    if (notes === null) return CANCELLED;

    report({ phase: 'encoding' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) return CANCELLED;
    const bytes = encodeSmf(songMidiFile(snapshot, resolveNoteOverlaps(notes), title, plan));
    return { ok: true, blob: new Blob([bytes], { type: 'audio/midi' }) };
  } catch (err) {
    return { ok: false, reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) } };
  }
}

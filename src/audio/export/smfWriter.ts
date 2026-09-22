/**
 * Pure SMF (Standard MIDI File) format-1 encoder. Knows the file format,
 * nothing about songs. A thrown writer is a `render-failed` outcome for the
 * caller, never a corrupt file: validation always precedes byte emission.
 */

export type SmfEvent =
  | { tick: number; kind: 'noteOn'; channel: number; note: number; velocity: number } // wire channel 0..15
  | { tick: number; kind: 'noteOff'; channel: number; note: number } // 0x8n, release velocity 64
  | { tick: number; kind: 'meta'; type: number; data: Uint8Array }; // FF type len(VLQ) data

export interface SmfTrack {
  events: SmfEvent[];
  endTick: number;
} // absolute ticks, any order

export interface SmfFile {
  ppq: number;
  tracks: SmfTrack[];
} // always format 1

const MTHD = [0x4d, 0x54, 0x68, 0x64];
const MTRK = [0x4d, 0x54, 0x72, 0x6b];
const EOT_META_TYPE = 0x2f;
const RANK: Record<SmfEvent['kind'], number> = { meta: 0, noteOff: 1, noteOn: 2 };

export function writeVlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new RangeError(`VLQ out of range: ${value}`);
  }
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function validateTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`tick out of range: ${tick}`);
}

function validateChannel(channel: number): void {
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
    throw new RangeError(`channel out of range: ${channel}`);
  }
}

function validateNote(note: number): void {
  if (!Number.isInteger(note) || note < 0 || note > 127) throw new RangeError(`note out of range: ${note}`);
}

function validateEvent(event: SmfEvent): void {
  validateTick(event.tick);
  if (event.kind === 'noteOn') {
    validateChannel(event.channel);
    validateNote(event.note);
    if (!Number.isInteger(event.velocity) || event.velocity < 1 || event.velocity > 127) {
      throw new RangeError(`noteOn velocity out of range: ${event.velocity}`);
    }
  } else if (event.kind === 'noteOff') {
    validateChannel(event.channel);
    validateNote(event.note);
  } else {
    if (!Number.isInteger(event.type) || event.type < 0 || event.type > 127) {
      throw new RangeError(`meta type out of range: ${event.type}`);
    }
  }
}

function encodeEvent(event: SmfEvent): number[] {
  if (event.kind === 'noteOn') {
    return [0x90 | event.channel, event.note, event.velocity];
  }
  if (event.kind === 'noteOff') {
    return [0x80 | event.channel, event.note, 0x40];
  }
  return [0xff, event.type, ...writeVlq(event.data.length), ...event.data];
}

function encodeTrack(track: SmfTrack): number[] {
  for (const event of track.events) validateEvent(event);
  const sorted = track.events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.tick - b.event.tick || RANK[a.event.kind] - RANK[b.event.kind] || a.index - b.index)
    .map((entry) => entry.event);

  const body: number[] = [];
  let lastTick = 0;
  for (const event of sorted) {
    body.push(...writeVlq(event.tick - lastTick), ...encodeEvent(event));
    lastTick = event.tick;
  }
  const eotTick = Math.max(track.endTick, lastTick);
  body.push(...writeVlq(eotTick - lastTick), 0xff, EOT_META_TYPE, 0x00);

  return [...MTRK, ...u32(body.length), ...body];
}

function validatePpq(ppq: number): void {
  if (!Number.isInteger(ppq) || ppq < 1 || ppq > 0x7fff) throw new RangeError(`ppq out of range: ${ppq}`);
}

export function encodeSmf(file: SmfFile): Uint8Array {
  validatePpq(file.ppq);
  const header = [...MTHD, ...u32(6), ...u16(1), ...u16(file.tracks.length), ...u16(file.ppq)];
  const trackBytes = file.tracks.flatMap((track) => encodeTrack(track));
  return Uint8Array.from([...header, ...trackBytes]);
}

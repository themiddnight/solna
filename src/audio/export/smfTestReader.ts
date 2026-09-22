/**
 * Test-only SMF reader. Parses the bytes `smfWriter.ts` produces back into a
 * structured form so tests can assert on musical content instead of raw hex.
 * Excluded from the production Knip graph (see `knip.json`).
 */

export interface ReadNote {
  channel: number;
  note: number;
  velocity: number;
  startTick: number;
  endTick: number;
}

export interface ReadTrack {
  name: string | null;
  metas: { tick: number; type: number; data: Uint8Array }[];
  notes: ReadNote[];
  endTick: number;
}

export interface ReadSmf {
  format: number;
  ppq: number;
  tracks: ReadTrack[];
}

interface Cursor {
  bytes: Uint8Array;
  pos: number;
}

function readByte(cursor: Cursor): number {
  return cursor.bytes[cursor.pos++];
}

function readU16(cursor: Cursor): number {
  return (readByte(cursor) << 8) | readByte(cursor);
}

function readU32(cursor: Cursor): number {
  return ((readByte(cursor) << 24) | (readByte(cursor) << 16) | (readByte(cursor) << 8) | readByte(cursor)) >>> 0;
}

function readVlq(cursor: Cursor): number {
  let value = 0;
  let byte: number;
  do {
    byte = readByte(cursor);
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return value;
}

function readChunkType(cursor: Cursor): string {
  const type = new TextDecoder().decode(cursor.bytes.slice(cursor.pos, cursor.pos + 4));
  cursor.pos += 4;
  return type;
}

interface PendingNote {
  velocity: number;
  startTick: number;
}

function pairNoteOn(pending: Map<string, PendingNote[]>, channel: number, note: number, velocity: number, tick: number): void {
  const key = `${channel}:${note}`;
  const queue = pending.get(key) ?? [];
  queue.push({ velocity, startTick: tick });
  pending.set(key, queue);
}

function pairNoteOff(pending: Map<string, PendingNote[]>, channel: number, note: number, tick: number): ReadNote | null {
  const key = `${channel}:${note}`;
  const queue = pending.get(key);
  const started = queue?.shift();
  if (!started) return null;
  return { channel, note, velocity: started.velocity, startTick: started.startTick, endTick: tick };
}

function parseTrack(bytes: Uint8Array, length: number, start: number): ReadTrack {
  const cursor: Cursor = { bytes, pos: start };
  const end = start + length;
  const pending = new Map<string, PendingNote[]>();
  const track: ReadTrack = { name: null, metas: [], notes: [], endTick: 0 };
  let lastTick = 0;

  while (cursor.pos < end) {
    const tick = lastTick + readVlq(cursor);
    lastTick = tick;
    const status = readByte(cursor);
    if ((status & 0x80) === 0) throw new Error(`running status not supported at byte ${cursor.pos - 1}`);
    const high = status & 0xf0;

    if (high === 0x90) {
      const channel = status & 0x0f;
      const note = readByte(cursor);
      const velocity = readByte(cursor);
      if (velocity === 0) {
        const paired = pairNoteOff(pending, channel, note, tick);
        if (paired) track.notes.push(paired);
      } else {
        pairNoteOn(pending, channel, note, velocity, tick);
      }
    } else if (high === 0x80) {
      const channel = status & 0x0f;
      const note = readByte(cursor);
      readByte(cursor); // release velocity, unused
      const paired = pairNoteOff(pending, channel, note, tick);
      if (paired) track.notes.push(paired);
    } else if (status === 0xff) {
      const type = readByte(cursor);
      const dataLength = readVlq(cursor);
      const data = bytes.slice(cursor.pos, cursor.pos + dataLength);
      cursor.pos += dataLength;
      if (type === 0x2f) {
        track.endTick = tick;
      } else {
        if (type === 0x03 && track.name === null) track.name = new TextDecoder().decode(data);
        track.metas.push({ tick, type, data });
      }
    } else {
      throw new Error(`unknown status byte: 0x${status.toString(16)}`);
    }
  }
  return track;
}

export function readSmf(bytes: Uint8Array): ReadSmf {
  const cursor: Cursor = { bytes, pos: 0 };
  readChunkType(cursor); // 'MThd'
  readU32(cursor); // header length, always 6
  const format = readU16(cursor);
  const trackCount = readU16(cursor);
  const ppq = readU16(cursor);

  const tracks: ReadTrack[] = [];
  for (let i = 0; i < trackCount; i++) {
    readChunkType(cursor); // 'MTrk'
    const length = readU32(cursor);
    tracks.push(parseTrack(bytes, length, cursor.pos));
    cursor.pos += length;
  }
  return { format, ppq, tracks };
}

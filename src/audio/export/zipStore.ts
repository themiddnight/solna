/**
 * A store-only ZIP writer for the stems export (R311, ADR-0038): method 0 (no
 * compression), CRC-32, UTF-8 names, no data descriptor, no ZIP64. One
 * consumer (`renderStems.ts`), so it stays beside the feature (R276), like
 * `smfWriter.ts`. WAV PCM barely compresses, and a store-only archive keeps
 * the payload by reference: the returned chunk list holds each entry's own
 * `Uint8Array`, so the archive costs headers, never a second copy of the audio.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 10;
/** Host 0 (MS-DOS), spec version 2.0. */
const VERSION_MADE_BY = 20;
/** Bit 11: the name is UTF-8 (`TextEncoder` bytes). */
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const MAX_ENTRIES = 0xffff;
const MAX_U32 = 0xffffffff;

/** IEEE 802.3, reflected polynomial 0xEDB88320, built once at module load. */
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (init 0xFFFFFFFF, final XOR 0xFFFFFFFF). `seed` continues a previous result. */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time from the Date's LOCAL fields; clamped to the format's 1980–2107 range. */
export function dosDateTime(date: Date): { date: number; time: number } {
  const year = date.getFullYear();
  if (year < 1980) return { date: (1 << 5) | 1, time: 0 };
  if (year > 2107) return { date: (127 << 9) | (12 << 5) | 31, time: (23 << 11) | (59 << 5) | 29 };
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

/** No ZIP64: a size or offset past 32 bits is an error, never a corrupt archive. */
export function assertZip32(value: number, field: string): void {
  if (value > MAX_U32) {
    throw new RangeError(`ZIP ${field} ${value} exceeds 4 GiB; ZIP64 is not supported`);
  }
}

interface EntryRecord {
  name: Uint8Array;
  size: number;
  crc: number;
  date: number;
  time: number;
  offset: number;
}

function localHeader(r: EntryRecord): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(LOCAL_HEADER_BYTES + r.name.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LOCAL_SIGNATURE, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, FLAG_UTF8, true);
  view.setUint16(8, METHOD_STORED, true);
  view.setUint16(10, r.time, true);
  view.setUint16(12, r.date, true);
  view.setUint32(14, r.crc, true);
  view.setUint32(18, r.size, true); // compressed = uncompressed: stored
  view.setUint32(22, r.size, true);
  view.setUint16(26, r.name.byteLength, true);
  // 28: extra length 0
  bytes.set(r.name, LOCAL_HEADER_BYTES);
  return bytes;
}

function centralHeader(r: EntryRecord): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(CENTRAL_HEADER_BYTES + r.name.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, CENTRAL_SIGNATURE, true);
  view.setUint16(4, VERSION_MADE_BY, true);
  view.setUint16(6, VERSION_NEEDED, true);
  view.setUint16(8, FLAG_UTF8, true);
  view.setUint16(10, METHOD_STORED, true);
  view.setUint16(12, r.time, true);
  view.setUint16(14, r.date, true);
  view.setUint32(16, r.crc, true);
  view.setUint32(20, r.size, true);
  view.setUint32(24, r.size, true);
  view.setUint16(28, r.name.byteLength, true);
  // 30 extra, 32 comment, 34 disk start, 36 internal attrs, 38 external attrs: all 0
  view.setUint32(42, r.offset, true);
  bytes.set(r.name, CENTRAL_HEADER_BYTES);
  return bytes;
}

function endOfCentralDirectory(count: number, cdSize: number, cdOffset: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(EOCD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, EOCD_SIGNATURE, true);
  // 4, 6: this disk and the CD's disk are 0
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, cdSize, true);
  view.setUint32(16, cdOffset, true);
  // 20: comment length 0
  return bytes;
}

/**
 * The archive as an ordered chunk list, ready for `new Blob(chunks)`. Entries
 * keep the given order. Throws `RangeError` past the format's 16/32-bit limits.
 */
export function encodeZipStore(entries: readonly ZipEntry[], modified: Date): Uint8Array<ArrayBuffer>[] {
  if (entries.length > MAX_ENTRIES) {
    throw new RangeError(`ZIP holds at most ${MAX_ENTRIES} entries; got ${entries.length}`);
  }
  const { date, time } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.byteLength;
    assertZip32(size, 'entry size');
    assertZip32(offset, 'local header offset');
    const record: EntryRecord = { name, size, crc: crc32(entry.data), date, time, offset };
    chunks.push(localHeader(record), entry.data);
    central.push(centralHeader(record));
    offset += LOCAL_HEADER_BYTES + name.byteLength + size;
  }
  const cdSize = central.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  assertZip32(offset, 'central directory offset');
  assertZip32(cdSize, 'central directory size');
  chunks.push(...central, endOfCentralDirectory(entries.length, cdSize, offset));
  return chunks;
}

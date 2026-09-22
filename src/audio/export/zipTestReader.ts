/**
 * Test-only ZIP reader: EOCD → central directory → local headers, checking
 * every field `zipStore.ts` writes (signatures, stored method, sizes, offsets,
 * names) and recomputing each CRC. Excluded from the production Knip graph by
 * name, like `smfTestReader.ts`.
 */
import { crc32 } from './zipStore';

export interface ZipReadEntry {
  name: string;
  data: Uint8Array;
}

const EOCD_BYTES = 22;
const CENTRAL_BYTES = 46;
const LOCAL_BYTES = 30;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`zip: ${message}`);
}

/** The chunk list `encodeZipStore` returns, as one byte array. */
export function concatZipChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function readLocal(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  expected: { name: string; crc: number; size: number },
): Uint8Array {
  const { name, crc, size } = expected;
  check(view.getUint32(offset, true) === 0x04034b50, `${name}: local header signature`);
  check(view.getUint16(offset + 8, true) === 0, `${name}: local method is not stored`);
  check(view.getUint32(offset + 14, true) === crc, `${name}: local CRC differs from the directory`);
  check(view.getUint32(offset + 18, true) === size, `${name}: local compressed size`);
  check(view.getUint32(offset + 22, true) === size, `${name}: local size`);
  const nameLength = view.getUint16(offset + 26, true);
  const localName = new TextDecoder().decode(bytes.subarray(offset + LOCAL_BYTES, offset + LOCAL_BYTES + nameLength));
  check(localName === name, `${name}: local name is ${localName}`);
  const start = offset + LOCAL_BYTES + nameLength + view.getUint16(offset + 28, true);
  const data = bytes.slice(start, start + size);
  check(crc32(data) === crc, `${name}: CRC mismatch`);
  return data;
}

export function readZip(bytes: Uint8Array): ZipReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.byteLength - EOCD_BYTES;
  check(view.getUint32(eocd, true) === 0x06054b50, 'end-of-central-directory signature');
  const count = view.getUint16(eocd + 10, true);
  check(view.getUint16(eocd + 8, true) === count, 'entries on disk differ from the total');
  const cdOffset = view.getUint32(eocd + 16, true);
  check(cdOffset + view.getUint32(eocd + 12, true) === eocd, 'central directory does not end at the EOCD');
  const entries: ZipReadEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    check(view.getUint32(p, true) === 0x02014b50, 'central header signature');
    check(view.getUint16(p + 10, true) === 0, 'method is not stored');
    const size = view.getUint32(p + 24, true);
    check(view.getUint32(p + 20, true) === size, 'compressed size differs from size');
    const nameLength = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + CENTRAL_BYTES, p + CENTRAL_BYTES + nameLength));
    const crc = view.getUint32(p + 16, true);
    entries.push({ name, data: readLocal(bytes, view, view.getUint32(p + 42, true), { name, crc, size }) });
    p += CENTRAL_BYTES + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

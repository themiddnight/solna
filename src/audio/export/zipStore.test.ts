import { describe, expect, test } from 'bun:test';
import { assertZip32, crc32, dosDateTime, encodeZipStore, type ZipEntry } from './zipStore';
import { concatZipChunks, readZip } from './zipTestReader';

const SEPT_22 = new Date(2026, 8, 22, 12, 34, 56);

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(new TextEncoder().encode(text));
}

function hex(chunks: readonly Uint8Array[]): string {
  return Array.from(concatZipChunks(chunks), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `a.txt` = "hi" at SEPT_22: local header (30) + name (5) + data (2), central
 * record (46) + name (5), EOCD (22) = 110 bytes. CRC-32("hi") = 0xD8932AAC,
 * DOS time 0x645C, date 0x5D36, flags 0x0800, method 0, version needed 10,
 * made by 20, local header offset 0, CD size 51 at offset 37.
 */
const GOLDEN_HEX =
  '504b03040a00000800005c64365dac2a93d8020000000200000005000000612e7478746869' +
  '504b010214000a00000800005c64365dac2a93d802000000020000000500000000000000' +
  '00000000000000000000612e747874' +
  '504b0506000000000100010033000000250000000000';

describe('crc32', () => {
  test('matches the IEEE 802.3 check values', () => {
    expect(crc32(ascii(''))).toBe(0x00000000);
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(ascii('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  test('a seed continues a running CRC', () => {
    const a = ascii('The quick brown ');
    const b = ascii('fox jumps over the lazy dog');
    expect(crc32(b, crc32(a))).toBe(crc32(ascii('The quick brown fox jumps over the lazy dog')));
  });
});

describe('dosDateTime', () => {
  test('packs the local fields, seconds halved', () => {
    expect(dosDateTime(SEPT_22)).toEqual({ date: 0x5d36, time: 0x645c });
  });

  test('clamps before 1980 to 1980-01-01 00:00:00 and after 2107 to 2107-12-31 23:59:58', () => {
    expect(dosDateTime(new Date(1979, 5, 1, 10, 0, 0))).toEqual({ date: 0x0021, time: 0x0000 });
    expect(dosDateTime(new Date(2108, 0, 1, 0, 0, 0))).toEqual({ date: 0xff9f, time: 0xbf7d });
  });
});

describe('encodeZipStore', () => {
  test('one stored entry encodes to the exact bytes of every field', () => {
    const chunks = encodeZipStore([{ name: 'a.txt', data: ascii('hi') }], SEPT_22);
    expect(concatZipChunks(chunks).byteLength).toBe(110);
    expect(hex(chunks)).toBe(GOLDEN_HEX);
  });

  test('an empty archive is a bare end-of-central-directory record', () => {
    expect(hex(encodeZipStore([], SEPT_22))).toBe(`504b0506${'00'.repeat(18)}`);
  });

  test('the payload is passed by reference, not copied', () => {
    const data = ascii('payload');
    const chunks = encodeZipStore([{ name: 'p.bin', data }], SEPT_22);
    expect(chunks.some((chunk) => chunk === data)).toBe(true);
  });

  test('more than 65 535 entries throws a RangeError', () => {
    const entries: ZipEntry[] = Array.from({ length: 65_536 }, () => ({ name: 'e', data: new Uint8Array(0) }));
    expect(() => encodeZipStore(entries, SEPT_22)).toThrow(RangeError);
  });

  test('assertZip32 accepts the 32-bit maximum and rejects one past it', () => {
    expect(() => assertZip32(0xffffffff, 'entry size')).not.toThrow();
    expect(() => assertZip32(0x1_0000_0000, 'entry size')).toThrow(RangeError);
  });

  test('round trip: three random entries come back with their names, order and bytes', () => {
    const entries: ZipEntry[] = ['one.wav', 'two.wav', 'three.wav'].map((name, i) => ({
      name,
      data: crypto.getRandomValues(new Uint8Array(1000 + i * 777)),
    }));
    const read = readZip(concatZipChunks(encodeZipStore(entries, SEPT_22)));
    expect(read.map((entry) => entry.name)).toEqual(['one.wav', 'two.wav', 'three.wav']);
    read.forEach((entry, i) => expect(entry.data).toEqual(entries[i].data));
  });
});

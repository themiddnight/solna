import { describe, expect, test } from 'bun:test';
import { encodeSmf, writeVlq, type SmfEvent, type SmfFile, type SmfTrack } from './smfWriter';
import { readSmf, type ReadNote, type ReadTrack } from './smfTestReader';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/** Runs `fn`, returning the thrown value (or undefined) — `toThrow`'s local
 * type shim only accepts a string/RegExp/Error instance, not a constructor,
 * so asserting the specific error class goes through `toBeInstanceOf`. */
function catchError(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('writeVlq', () => {
  test('encodes the spec table', () => {
    expect(writeVlq(0)).toEqual([0x00]);
    expect(writeVlq(127)).toEqual([0x7f]);
    expect(writeVlq(128)).toEqual([0x81, 0x00]);
    expect(writeVlq(480)).toEqual([0x83, 0x60]);
    expect(writeVlq(8192)).toEqual([0xc0, 0x00]);
    expect(writeVlq(0x3fff)).toEqual([0xff, 0x7f]);
    expect(writeVlq(0x4000)).toEqual([0x81, 0x80, 0x00]);
    expect(writeVlq(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });

  test('throws outside 0..0x0FFFFFFF', () => {
    expect(catchError(() => writeVlq(-1))).toBeInstanceOf(RangeError);
    expect(catchError(() => writeVlq(0x10000000))).toBeInstanceOf(RangeError);
    expect(catchError(() => writeVlq(1.5))).toBeInstanceOf(RangeError);
  });
});

describe('encodeSmf', () => {
  const tempoTrack: SmfTrack = {
    endTick: 0,
    events: [{ tick: 0, kind: 'meta', type: 0x51, data: new Uint8Array([0x07, 0xa1, 0x20]) }],
  };
  const noteEvents: SmfEvent[] = [
    { tick: 0, kind: 'noteOn', channel: 0, note: 60, velocity: 100 },
    { tick: 0, kind: 'meta', type: 0x03, data: new Uint8Array([0x41]) },
    { tick: 480, kind: 'noteOn', channel: 0, note: 62, velocity: 90 },
    { tick: 480, kind: 'noteOff', channel: 0, note: 60 },
    { tick: 960, kind: 'noteOff', channel: 0, note: 62 },
  ];
  const file: SmfFile = {
    ppq: 480,
    tracks: [tempoTrack, { endTick: 1920, events: noteEvents }],
  };
  const GOLDEN = [
    '4D546864 00000006 0001 0002 01E0',
    '4D54726B 0000000B', '00 FF 51 03 07 A1 20', '00 FF 2F 00',
    '4D54726B 0000001C', '00 FF 03 01 41', '00 90 3C 64', '83 60 80 3C 40',
    '00 90 3E 5A', '83 60 80 3E 40', '87 40 FF 2F 00',
  ].join(' ').replace(/\s+/g, '');

  test('a two-track file encodes to the golden bytes', () => {
    expect(hex(encodeSmf(file))).toBe(GOLDEN);
  });

  test('EOT lands on the last event when endTick is earlier', () => {
    const earlyEnd: SmfFile = {
      ppq: 480,
      tracks: [
        {
          endTick: 0,
          events: [
            { tick: 0, kind: 'noteOn', channel: 0, note: 60, velocity: 100 },
            { tick: 480, kind: 'noteOff', channel: 0, note: 60 },
          ],
        },
      ],
    };
    const bytes = hex(encodeSmf(earlyEnd));
    expect(bytes.endsWith('836080' + '3C40' + '00FF2F00')).toBe(true);
  });

  test('throws instead of writing a corrupt file', () => {
    const base = (events: SmfFile['tracks'][0]['events']): SmfFile => ({
      ppq: 480,
      tracks: [{ endTick: 0, events }],
    });
    expect(catchError(() => encodeSmf(base([{ tick: 0, kind: 'noteOn', channel: 16, note: 60, velocity: 100 }])))).toBeInstanceOf(RangeError);
    expect(catchError(() => encodeSmf(base([{ tick: 0, kind: 'noteOn', channel: 0, note: 128, velocity: 100 }])))).toBeInstanceOf(RangeError);
    expect(catchError(() => encodeSmf(base([{ tick: 0, kind: 'noteOn', channel: 0, note: 60, velocity: 0 }])))).toBeInstanceOf(RangeError);
    expect(catchError(() => encodeSmf(base([{ tick: 0, kind: 'noteOn', channel: 0, note: 60, velocity: 128 }])))).toBeInstanceOf(RangeError);
    expect(catchError(() => encodeSmf(base([{ tick: -1, kind: 'noteOn', channel: 0, note: 60, velocity: 100 }])))).toBeInstanceOf(RangeError);
  });

  test('the test reader parses what the writer wrote', () => {
    const bytes = encodeSmf(file);
    const parsed = readSmf(bytes);
    expect(parsed.format).toBe(1);
    expect(parsed.ppq).toBe(480);
    const track: ReadTrack = parsed.tracks[1];
    expect(track.name).toBe('A');
    const expectedNotes: ReadNote[] = [
      { channel: 0, note: 60, velocity: 100, startTick: 0, endTick: 480 },
      { channel: 0, note: 62, velocity: 90, startTick: 480, endTick: 960 },
    ];
    expect(track.notes).toEqual(expectedNotes);
    expect(track.endTick).toBe(1920);
  });
});

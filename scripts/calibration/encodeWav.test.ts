import { describe, expect, test } from 'bun:test';
import { encodeWav } from './encodeWav.ts';

const ascii = (bytes: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...bytes.slice(from, from + len));

describe('encodeWav', () => {
  test('writes the RIFF/WAVE/fmt /data chunk ids ffmpeg looks for', () => {
    const wav = encodeWav([new Float32Array(4)], 44100);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
  });

  test('declares the channel count and sample rate it was given', () => {
    const view = new DataView(encodeWav([new Float32Array(4), new Float32Array(4)], 48000).buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  test('declares PCM format 1, and the byte rate and block align ffmpeg derives from it', () => {
    // 2 channels x 48000 Hz x 2 bytes/sample = 192000 byte rate;
    // 2 channels x 2 bytes/sample = 4 byte block align.
    const view = new DataView(encodeWav([new Float32Array(4), new Float32Array(4)], 48000).buffer);
    expect(view.getUint16(20, true)).toBe(1); // format code: 1 = PCM
    expect(view.getUint32(28, true)).toBe(192000); // byte rate
    expect(view.getUint16(32, true)).toBe(4); // block align
  });

  test('is 44 header bytes plus two bytes per sample per channel, and the RIFF/data sizes agree', () => {
    const wav = encodeWav([new Float32Array(100), new Float32Array(100)], 44100);
    expect(wav.length).toBe(44 + 400);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(4, true)).toBe(36 + 400); // RIFF chunk size: file size - 8
    expect(view.getUint32(40, true)).toBe(400); // data chunk size
  });

  test('interleaves channels, so a hard-left signal is not written into both', () => {
    const left = new Float32Array([1, 1]);
    const right = new Float32Array([0, 0]);
    const view = new DataView(encodeWav([left, right], 44100).buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
  });

  test('clamps out-of-range samples instead of wrapping them to the opposite polarity', () => {
    const view = new DataView(encodeWav([new Float32Array([2, -2])], 44100).buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  test('round-trips a known signal: decoding the PCM data back recovers each sample', () => {
    const signal = new Float32Array([0, 0.5, -0.5, 0.25, -1, 1]);
    const wav = encodeWav([signal], 44100);
    const view = new DataView(wav.buffer);
    const decoded: number[] = [];
    for (let frame = 0; frame < signal.length; frame += 1) {
      decoded.push(view.getInt16(44 + frame * 2, true) / 0x8000);
    }
    // The 16-bit quantization step is 1/32768 ~= 3.05e-5; a tolerance of 1e-4
    // is under 4 LSB, tight enough to notice a real precision loss (e.g. an
    // accidental 8-bit truncation, which would be off by ~1/256) while still
    // covering the asymmetric +1/-1 scale factors encodeWav uses.
    for (let i = 0; i < signal.length; i += 1) {
      expect(decoded[i]).toBeCloseTo(signal[i] ?? 0, 4);
    }
  });

  test('throws on an empty channel list rather than emitting a 0-channel file', () => {
    expect(() => encodeWav([], 44100)).toThrow(/at least one channel/);
  });

  test('throws when channels have mismatched lengths rather than truncating or zero-filling', () => {
    const short = new Float32Array(4);
    const long = new Float32Array(8);
    expect(() => encodeWav([short, long], 44100)).toThrow(/same length/);
  });
});

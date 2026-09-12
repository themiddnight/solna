import { describe, expect, test } from 'bun:test';
import { encodeWav, encodeWavBytes } from './encodeWav';

/** Reads back the samples a 16-bit PCM WAV carries, in channel order. */
function decodePcm16(wav: Uint8Array, channel: number, channelCount: number, frame: number): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const offset = 44 + (frame * channelCount + channel) * 2;
  return view.getInt16(offset, true);
}

describe('encodeWavBytes', () => {
  test('writes a RIFF/WAVE header with a fmt and a data chunk', () => {
    const wav = encodeWavBytes([new Float32Array(4)], 44100);
    const view = new DataView(wav.buffer);
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
  });

  test('declares PCM, the channel count, the sample rate and 16 bits', () => {
    const view = new DataView(encodeWavBytes([new Float32Array(4), new Float32Array(4)], 48000).buffer);
    expect(view.getUint16(20, true)).toBe(1); // format 1 = PCM
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  test('byte rate and block align follow from the channel count', () => {
    const view = new DataView(encodeWavBytes([new Float32Array(4), new Float32Array(4)], 48000).buffer);
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 2);
    expect(view.getUint16(32, true)).toBe(4);
  });

  test('is 44 header bytes plus 2 bytes per sample, and the sizes agree', () => {
    const wav = encodeWavBytes([new Float32Array(100), new Float32Array(100)], 44100);
    const view = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(44 + 100 * 2 * 2);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8); // RIFF size
    expect(view.getUint32(40, true)).toBe(100 * 2 * 2); // data size
  });

  test('interleaves channels frame by frame, little-endian', () => {
    const left = new Float32Array([1, 0, -1, 0]);
    const right = new Float32Array([0, 0.5, 0, -0.5]);
    const wav = encodeWavBytes([left, right], 44100);
    expect(decodePcm16(wav, 0, 2, 0)).toBe(0x7fff);
    expect(decodePcm16(wav, 1, 2, 0)).toBe(0);
    expect(decodePcm16(wav, 0, 2, 1)).toBe(0);
    // Positives scale by 0x7fff and negatives by 0x8000, and `setInt16`
    // truncates toward zero rather than rounding — so +0.5 lands a half-LSB
    // low (0.5 * 0x7fff = 16383.5 -> 16383) while -0.5 lands exactly on
    // -0x4000. Asserting the real values is what keeps this test an assertion
    // about the encoder the calibration harness already measured against.
    expect(decodePcm16(wav, 1, 2, 1)).toBe(16383);
    expect(decodePcm16(wav, 0, 2, 2)).toBe(-0x8000);
    expect(decodePcm16(wav, 1, 2, 3)).toBe(-0x4000);
  });

  test('clamps past +/-1 instead of wrapping', () => {
    const view = new DataView(encodeWavBytes([new Float32Array([2, -2])], 44100).buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  test('round-trips a signal back to within one quantization step', () => {
    const signal = new Float32Array([0, 0.25, -0.25, 0.5, -0.5, 0.999, -0.999]);
    const wav = encodeWavBytes([signal], 44100);
    for (let i = 0; i < signal.length; i += 1) {
      // Asymmetric scale factors: +1 maps to 0x7fff, -1 to -0x8000.
      const expected = signal[i] < 0 ? (signal[i] * 0x8000) / 0x8000 : (signal[i] * 0x7fff) / 0x7fff;
      expect(decodePcm16(wav, 0, 1, i) / (signal[i] < 0 ? 0x8000 : 0x7fff)).toBeCloseTo(expected, 4);
    }
  });

  test('an empty channel array throws', () => {
    expect(() => encodeWavBytes([], 44100)).toThrow(/at least one channel/);
  });

  test('mismatched channel lengths throw', () => {
    const short = new Float32Array(4);
    const long = new Float32Array(8);
    expect(() => encodeWavBytes([short, long], 44100)).toThrow(/same length/);
  });
});

describe('encodeWav', () => {
  test('returns a Blob of the same bytes, typed as audio/wav', async () => {
    const channels = [new Float32Array([0.5, -0.5]), new Float32Array([0.25, -0.25])];
    const blob = encodeWav(channels, 44100);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 2 * 2 * 2);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toEqual(encodeWavBytes(channels, 44100));
  });
});

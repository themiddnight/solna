/**
 * Rendered `AudioBuffer` channels -> a 16-bit PCM WAV, because a file is what
 * the user asked for and `startRendering()` returns Float32 channel data.
 *
 * 16-bit is deliberate and not a shortcut: the quantization floor is about
 * -96 dBFS while a Solna mix sits near -18 dBFS, so the encoding contributes
 * nothing measurable. The calibration harness measured against this same
 * argument for a year.
 *
 * Live in src/utils/ rather than scripts/ because it is no longer only a
 * harness concern: it is above data/, reachable from both src/audio/ and
 * src/components/, and free of DOM events — this function does not download
 * anything, it only encodes.
 */
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * The 44-byte RIFF/WAVE header, little-endian samples, clamped to +/-1.
 *
 * The return type names `ArrayBuffer` rather than the bare `Uint8Array` it
 * would default to: a plain `Uint8Array` is `Uint8Array<ArrayBufferLike>`, and
 * `BlobPart` requires a view over a non-shared `ArrayBuffer`, so the wide form
 * does not type-check at `encodeWav`'s `new Blob`. Narrowing is the honest fix
 * — the buffer is always freshly allocated here, never a SharedArrayBuffer —
 * where a cast at the Blob would silence a real distinction.
 */
export function encodeWavBytes(channels: Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const channelCount = channels.length;
  if (channelCount === 0) {
    throw new Error('encodeWav requires at least one channel; got an empty array.');
  }
  const frameCount = channels[0].length;
  for (const [index, channel] of channels.entries()) {
    if (channel.length !== frameCount) {
      throw new Error(
        `encodeWav requires every channel to have the same length; channel 0 has ` +
          `${frameCount} frames but channel ${index} has ${channel.length}.`,
      );
    }
  }
  const dataBytes = frameCount * channelCount * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, channelCount * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel][frame];
      // Clamp, never wrap: a sample past +1 wrapping to -32768 would turn an
      // over-hot voice into a measurement that reads plausible.
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}

/**
 * The download-shaped wrapper. `Blob` rather than `Uint8Array` because that is
 * what `downloadBlob` and `ProjectSaveResult.destination: 'download'` take;
 * the harness adapts with `new Uint8Array(await blob.arrayBuffer())` instead of
 * keeping a second implementation.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  return new Blob([encodeWavBytes(channels, sampleRate)], { type: 'audio/wav' });
}

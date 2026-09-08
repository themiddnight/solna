/**
 * Rendered `AudioBuffer` channels -> a 16-bit PCM WAV, because ffmpeg reads files
 * and `OfflineAudioContext.startRendering()` returns Float32 channel data.
 *
 * 16-bit is deliberate and not a shortcut: the quantization floor is about
 * -96 dBFS and every calibration measurement sits near -18 dBFS, so the encoding
 * contributes nothing measurable to a number that is reported to 0.1 dB.
 */
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  if (channelCount === 0) {
    throw new Error('encodeWav requires at least one channel; got an empty array.');
  }
  const frameCount = channels[0]?.length ?? 0;
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
      const sample = channels[channel]?.[frame] ?? 0;
      // Clamp, never wrap: a sample past +1 wrapping to -32768 would turn an
      // over-hot voice into a measurement that reads plausible.
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}

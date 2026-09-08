// Real ffmpeg per-frame lines look like:
//   t: 3.09998    TARGET:-23 LUFS    M: -17.2 S: -18.2     I: -18.3 LUFS       LRA:  20.1 LU
// M: (momentary) always precedes S: (short-term) — a hand-written fixture that
// assumed the opposite order previously let this parser ship broken against real
// ffmpeg output.
const SHORT_TERM_LINE = /S:\s*(-?\d+(?:\.\d+)?)/;

/**
 * EBU R128 short-term loudness is a rolling 3-second window: ffmpeg reports a fixed
 * sentinel (-120.7 LUFS, "gate not open yet") for every frame until 3s of audio has
 * accumulated, regardless of actual signal level. Filtering on VALUE (not the frame's
 * `t:` timestamp) is robust to ffmpeg's frame quantization — frames land at 0.0999792,
 * 0.1999792, ..., 2.99998, never exactly on a 0.1s boundary, so a `t >= 3` cutoff
 * clips early. A clip shorter than 3s never clears this floor and produces zero valid
 * readings: a real finding (widen the pattern), not a value to interpolate around.
 */
const SHORT_TERM_GATE_SENTINEL_FLOOR_LUFS = -100;

/**
 * Parses ffmpeg's `-af ebur128` stderr, extracting every valid short-term (S:, 3s
 * window) LUFS reading — chosen over integrated (I:, whole-clip) so a calibration
 * pattern's transient attack is not averaged away.
 */
export function parseEbur128Output(stderr: string): { shortTermLufs: number[] } {
  const shortTermLufs: number[] = [];
  for (const line of stderr.split('\n')) {
    const match = SHORT_TERM_LINE.exec(line);
    const captured = match?.[1];
    if (captured === undefined) continue;
    const value = Number.parseFloat(captured);
    if (value > SHORT_TERM_GATE_SENTINEL_FLOOR_LUFS) shortTermLufs.push(value);
  }
  return { shortTermLufs };
}

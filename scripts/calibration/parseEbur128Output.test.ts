import { describe, expect, test } from 'bun:test';
import { parseEbur128Output } from './parseEbur128Output.ts';

// Real ffmpeg `-af ebur128` output, verified against an actual run: `M:` precedes
// `S:` on every line, and every `S:` reading before t=3s is the ~-120.7 LUFS
// "gate not open yet" sentinel (EBU R128's 3-second short-term window).
const SAMPLE_FFMPEG_STDERR = `
[Parsed_ebur128_0 @ 0x7f9] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 1.09998    TARGET:-23 LUFS    M: -15.4 S:-120.7     I: -15.4 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 2.99998    TARGET:-23 LUFS    M: -24.5 S: -18.2     I: -18.3 LUFS       LRA:  20.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 3.09998    TARGET:-23 LUFS    M: -17.2 S: -18.2     I: -18.3 LUFS       LRA:  20.1 LU
[Parsed_ebur128_0 @ 0x7f9] t: 3.19998    TARGET:-23 LUFS    M: -15.7 S: -18.1     I: -18.2 LUFS       LRA:  20.1 LU
[Parsed_ebur128_0 @ 0x7f9] Summary:

  Integrated loudness:
    I:         -18.1 LUFS
    Threshold: -28.2 LUFS
`;

describe('parseEbur128Output', () => {
  test('extracts every valid short-term (S:) reading, in order, once the 3s gate opens', () => {
    expect(parseEbur128Output(SAMPLE_FFMPEG_STDERR).shortTermLufs).toEqual([-18.2, -18.2, -18.1]);
  });

  test('drops every reading before the gate opens (the -120.7 sentinel)', () => {
    const { shortTermLufs } = parseEbur128Output(SAMPLE_FFMPEG_STDERR);
    expect(shortTermLufs.every((value) => value > -100)).toBe(true);
  });

  test('filters on VALUE, not on the t: timestamp — a 2.99998 frame past the gate is kept', () => {
    // ffmpeg's frames never land on an exact 3.0 boundary, so a `t >= 3` cutoff
    // would discard this reading. Keeping it is the whole point of the value gate.
    expect(parseEbur128Output(SAMPLE_FFMPEG_STDERR).shortTermLufs[0]).toBe(-18.2);
  });

  test('returns an empty array for a clip shorter than the gate, not a bogus sentinel reading', () => {
    const shortClip = `
[Parsed_ebur128_0 @ 0x7f9] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 1.99998    TARGET:-23 LUFS    M: -15.4 S:-120.7     I: -15.4 LUFS       LRA:   0.0 LU
`;
    expect(parseEbur128Output(shortClip).shortTermLufs).toEqual([]);
  });

  test('returns an empty array for output with no ebur128 frame lines, rather than throwing', () => {
    expect(parseEbur128Output('no relevant output here').shortTermLufs).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { parseEbur128Output } from "../parseEbur128Output";

// Real ffmpeg `-af ebur128` output, verified against an actual run (M: precedes S: on every
// line; every S: reading before t=3s is the ~-120 LUFS "gate not open yet" sentinel, per the
// EBU R128 spec's 3-second short-term window).
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

  Loudness range:
    LRA:         0.4 LU
    Threshold: -38.0 LUFS
    LRA low:   -18.2 LUFS
    LRA high:  -17.9 LUFS
`;

describe("parseEbur128Output", () => {
  it("extracts every valid short-term (S:) reading, in order, once the 3s EBU gate opens", () => {
    const { shortTermLufs } = parseEbur128Output(SAMPLE_FFMPEG_STDERR);
    expect(shortTermLufs).toEqual([-18.2, -18.2, -18.1]);
  });

  it("drops every reading before the 3s short-term gate opens (the -120.7 sentinel)", () => {
    const { shortTermLufs } = parseEbur128Output(SAMPLE_FFMPEG_STDERR);
    expect(shortTermLufs.every((value) => value > -100)).toBe(true);
  });

  it("returns an empty array for a clip shorter than the 3s gate, rather than a bogus sentinel reading", () => {
    const shortClip = `
[Parsed_ebur128_0 @ 0x7f9] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x7f9] t: 1.99998    TARGET:-23 LUFS    M: -15.4 S:-120.7     I: -15.4 LUFS       LRA:   0.0 LU
`;
    expect(parseEbur128Output(shortClip).shortTermLufs).toEqual([]);
  });

  it("returns an empty array for output with no ebur128 frame lines, rather than throwing", () => {
    expect(parseEbur128Output("no relevant output here").shortTermLufs).toEqual([]);
  });
});

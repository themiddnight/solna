import { describe, expect, test } from 'bun:test';
import { medianShortTermLufs } from './measureLoudness.ts';

const frame = (short: number) =>
  `[Parsed_ebur128_0 @ 0x7f9] t: 3.09998  TARGET:-23 LUFS  M: -17.2 S: ${short}  I: -18.3 LUFS  LRA: 20.1 LU`;

describe('medianShortTermLufs', () => {
  test('returns the median of an odd number of readings', () => {
    const stderr = [frame(-20), frame(-14), frame(-17)].join('\n');
    expect(medianShortTermLufs(stderr, 'kick')).toBe(-17);
  });

  test('takes the MEDIAN, so one anomalous frame cannot skew a committed default', () => {
    // The mean of these five is -21.6; the median is -18. A single wild frame is
    // exactly what a mean would let through into a shipped number.
    const stderr = [frame(-18), frame(-18.2), frame(-17.9), frame(-18.1), frame(-36)].join('\n');
    expect(medianShortTermLufs(stderr, 'kick')).toBe(-18.1);
  });

  test('an even number of readings picks the UPPER-middle, not the average of the two middles', () => {
    // Sorted: -22, -19, -16, -12. The two middle values are -19 and -16; their
    // average is -17.5, which is the tempting "improvement" this test exists to
    // catch — averaging would silently move every regenerated trim in the
    // committed table with nothing failing. The upper-middle element is -16.
    const stderr = [frame(-12), frame(-22), frame(-16), frame(-19)].join('\n');
    expect(medianShortTermLufs(stderr, 'kick')).toBe(-16);
  });

  test('throws a message naming the label and the 3s gate when there are no valid readings', () => {
    expect(() => medianShortTermLufs(frame(-120.7), 'Trap Beat/crash')).toThrow(
      /Trap Beat\/crash.*EBU R128 3s short-term gate/s,
    );
  });

  test('the no-readings message also names genuine silence, not only a duration bug', () => {
    expect(() => medianShortTermLufs('', 'Trap Beat/crash')).toThrow(/genuinely silent/);
  });
});

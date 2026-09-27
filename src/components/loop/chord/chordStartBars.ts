/** Returns the one-based start bar for every chord in a progression. */
export function chordStartBars(chords: readonly { bars?: number }[]): number[] {
  const starts: number[] = [];
  let nextStart = 1;
  for (const chord of chords) {
    starts.push(nextStart);
    nextStart += chord.bars || 1;
  }
  return starts;
}

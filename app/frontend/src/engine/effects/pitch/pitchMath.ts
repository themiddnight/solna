/** Pure pitch math for pitch-aware effects. No Web Audio, no Tonal, no feature imports. */

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Snap a frequency to the nearest MIDI note whose pitch class is set in the 12-bit scaleMask. */
export function quantizeFreqToScale(freq: number, scaleMask: number): number {
  if (freq <= 0 || (scaleMask & 0xfff) === 0) return freq;
  const nearest = Math.round(freqToMidi(freq));
  for (let d = 0; d <= 6; d++) {
    const candidates = d === 0 ? [nearest] : [nearest - d, nearest + d];
    for (const midi of candidates) {
      const pc = ((midi % 12) + 12) % 12;
      if ((scaleMask & (1 << pc)) !== 0) return midiToFreq(midi);
    }
  }
  return freq;
}

/** Ascending pitch classes present in the scale, starting from pitch class 0. */
function scalePcs(scaleMask: number): number[] {
  const pcs: number[] = [];
  for (let pc = 0; pc < 12; pc++) if ((scaleMask & (1 << pc)) !== 0) pcs.push(pc);
  return pcs;
}

/**
 * Frequency of a diatonic scale degree above baseFreq, snapped into scaleMask first.
 * 1 = unison, 3/5 = walk (degree-1) scale steps up (scale-aware major/minor thirds etc.),
 * 8 = exact +12 semitones (correct in any scale, unlike "7 scale steps").
 */
export function diatonicDegreeFreq(baseFreq: number, scaleMask: number, degree: number): number {
  const snappedMidi = Math.round(freqToMidi(quantizeFreqToScale(baseFreq, scaleMask)));
  if (degree <= 1) return midiToFreq(snappedMidi);
  if (degree === 8) return midiToFreq(snappedMidi + 12);

  const pcs = scalePcs(scaleMask);
  if (pcs.length === 0) return midiToFreq(snappedMidi);
  const basePc = ((snappedMidi % 12) + 12) % 12;
  let idx = pcs.indexOf(basePc);
  if (idx < 0) idx = 0; // base not in scale (shouldn't happen post-snap)

  let midi = snappedMidi;
  for (let s = 0; s < degree - 1; s++) {
    const cur = pcs[idx % pcs.length];
    idx++;
    const next = pcs[idx % pcs.length];
    if (cur === undefined || next === undefined) break; // unreachable: pcs is non-empty, but satisfies noUncheckedIndexedAccess
    let delta = next - cur;
    if (delta <= 0) delta += 12; // wrapped past the octave
    midi += delta;
  }
  return midiToFreq(midi);
}

/** Static drone carrier = tonic at a low base octave. */
export function droneCarrierFreq(keyRoot: number, baseMidi = 48): number {
  return midiToFreq(baseMidi + (keyRoot % 12));
}

/** Follow carrier = the sung pitch snapped into the scale. */
export function followCarrierFreq(detectedFreq: number, scaleMask: number): number {
  return quantizeFreqToScale(detectedFreq, scaleMask);
}
